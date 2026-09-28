"""Offline safety tests; no source/Pi connections and no application row logging.

Run: python -m unittest discover -s infra/raspberry-pi/tests -v
Install infra/raspberry-pi/requirements.txt in a virtual environment first.
"""

from contextlib import ExitStack
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch


SPEC = importlib.util.spec_from_file_location("migrate", Path(__file__).resolve().parents[1] / "migrate.py")
migrate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(migrate)


def schema(table):
    return [{"name": name, "type": kind, "nullable": nullable, "default": migrate.EXPECTED_DEFAULTS[table][name],
             "generated": "", "identity": ""}
            for name, (kind, nullable) in sorted(migrate.EXPECTED_COLUMNS[table].items())]


def triggers(table):
    if table not in ("users", "user_preferences", "devices"):
        return []
    return [{"name": f"update_{table}_updated_at", "type": 19, "enabled": "O", "function_schema": "public",
             "function_name": "update_updated_at_column",
             "definition": f"CREATE TRIGGER update_{table}_updated_at BEFORE UPDATE ON public.{table} FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()",
             "function_language": "plpgsql", "function_security_definer": False, "function_settings": None,
             "function_volatility": "v", "function_strict": False, "function_parallel": "u", "function_return_type": "trigger",
             "function_body_sha256": hashlib.sha256(b"BEGIN NEW.updated_at = now(); RETURN NEW; END;").hexdigest()}]


def header(table):
    return (",".join(sorted(migrate.EXPECTED_COLUMNS[table])) + "\n").encode("utf-8")


def make_bundle(directory):
    manifest = {"application": "esp32-eink", "format_version": 1, "tables": {}, "excluded_public_tables": []}
    for table in migrate.TABLES:
        data = header(table)
        (directory / f"{table}.csv").write_bytes(data)
        manifest["tables"][table] = {
            "file": f"{table}.csv", "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "row_count": 0,
            "columns": schema(table), "constraints": copy.deepcopy(migrate.EXPECTED_CONSTRAINTS[table]), "triggers": triggers(table),
        }
    write_manifest(directory, manifest)
    return manifest


def write_manifest(directory, manifest):
    raw = migrate.canonical_json(manifest)
    (directory / "manifest.json").write_bytes(raw)
    (directory / "manifest.sha256").write_text(hashlib.sha256(raw).hexdigest() + "\n", encoding="ascii")


class SchemaTests(unittest.TestCase):
    def test_repository_schema_accepted(self):
        for table in migrate.TABLES:
            migrate.check_schema(table, schema(table))
            migrate.check_relations(table, migrate.EXPECTED_CONSTRAINTS[table], triggers(table))

    def test_missing_extra_type_nullable_and_default_drift_rejected(self):
        mutations = {
            "missing": lambda fields: fields.pop(),
            "extra": lambda fields: fields.append({"name": "screen_profile_id", "type": "uuid", "nullable": True}),
            "type": lambda fields: fields[0].update(type="timestamp without time zone"),
            "nullable": lambda fields: fields[0].update(nullable=False),
            "default": lambda fields: fields[0].update(default=None),
            "identity": lambda fields: fields[0].update(identity="a"),
            "duplicate": lambda fields: fields.append(fields[0].copy()),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                fields = schema("users")
                mutate(fields)
                with self.assertRaises(migrate.MigrationError):
                    migrate.check_schema("users", fields)

    def test_pgcrypto_schema_and_explicit_null_are_equivalent(self):
        fields = schema("user_preferences")
        for column in fields:
            if column["name"] == "id":
                column["default"] = "extensions.gen_random_uuid()"
            if column["name"] == "layout":
                column["default"] = "NULL::jsonb"
        migrate.check_schema("user_preferences", fields)

    def test_missing_upsert_unique_constraint_rejected(self):
        constraints = [c for c in migrate.EXPECTED_CONSTRAINTS["api_keys"] if c["type"] != "u"]
        with self.assertRaisesRegex(migrate.MigrationError, "Constraint drift"):
            migrate.check_relations("api_keys", constraints, [])

    def test_insertion_trigger_rejected(self):
        extra = triggers("users")
        extra[0]["type"] = 7  # BEFORE INSERT ROW would modify imported timestamps.
        with self.assertRaisesRegex(migrate.MigrationError, "Trigger drift"):
            migrate.check_relations("users", migrate.EXPECTED_CONSTRAINTS["users"], extra)

    def test_trigger_conditions_and_function_code_or_security_drift_rejected(self):
        for changes in ({"definition": triggers("users")[0]["definition"].replace("BEFORE UPDATE", "BEFORE UPDATE OF id")},
                        {"function_body_sha256": hashlib.sha256(b"malicious code").hexdigest()},
                        {"function_security_definer": True}, {"function_settings": ["search_path=other"]}):
            value = triggers("users")
            value[0].update(changes)
            with self.assertRaisesRegex(migrate.MigrationError, "drift"):
                migrate.check_relations("users", migrate.EXPECTED_CONSTRAINTS["users"], value)


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.manifest = make_bundle(self.directory)

    def test_valid_bundle(self):
        self.assertEqual(migrate.load_bundle(self.directory), self.manifest)

    def test_changed_ciphertext_or_any_row_byte_rejected(self):
        with (self.directory / "api_keys.csv").open("ab") as stream:
            stream.write(b"modified ciphertext\n")
        with self.assertRaisesRegex(migrate.MigrationError, "checksum/size"):
            migrate.load_bundle(self.directory)

    def test_manifest_tamper_rejected(self):
        with (self.directory / "manifest.json").open("ab") as stream:
            stream.write(b" ")
        with self.assertRaisesRegex(migrate.MigrationError, "Manifest checksum"):
            migrate.load_bundle(self.directory)

    def test_incomplete_bundle_rejected(self):
        (self.directory / ".incomplete").touch()
        with self.assertRaisesRegex(migrate.MigrationError, "incomplete"):
            migrate.load_bundle(self.directory)

    def test_missing_table_file_rejected(self):
        (self.directory / "orders.csv").unlink()
        with self.assertRaisesRegex(migrate.MigrationError, "seven CSV"):
            migrate.load_bundle(self.directory)

    def test_extra_file_rejected(self):
        (self.directory / "auth.csv").touch()
        with self.assertRaisesRegex(migrate.MigrationError, "seven CSV"):
            migrate.load_bundle(self.directory)

    def test_manifest_cannot_select_external_file(self):
        self.manifest["tables"]["api_keys"]["file"] = "../secrets.csv"
        write_manifest(self.directory, self.manifest)
        with self.assertRaisesRegex(migrate.MigrationError, "Unexpected filename"):
            migrate.load_bundle(self.directory)

    def test_manifest_cannot_omit_table_or_add_auth_table(self):
        for mutation in ("omit", "extra"):
            with self.subTest(mutation=mutation):
                value = copy.deepcopy(self.manifest)
                if mutation == "omit":
                    value["tables"].pop("api_keys")
                else:
                    value["tables"]["auth.users"] = value["tables"]["users"]
                write_manifest(self.directory, value)
                with self.assertRaisesRegex(migrate.MigrationError, "allowlist"):
                    migrate.load_bundle(self.directory)

    def test_invalid_count_rejected(self):
        for value in (-1, True, "0"):
            self.manifest["tables"]["users"]["row_count"] = value
            write_manifest(self.directory, self.manifest)
            with self.assertRaisesRegex(migrate.MigrationError, "row count"):
                migrate.load_bundle(self.directory)

    def test_unknown_version_rejected(self):
        self.manifest["format_version"] = 99
        write_manifest(self.directory, self.manifest)
        with self.assertRaisesRegex(migrate.MigrationError, "version"):
            migrate.load_bundle(self.directory)

    def test_export_never_overwrites_existing_directory(self):
        with self.assertRaises(FileExistsError):
            migrate.export_bundle(MagicMock(), self.directory)
        self.assertEqual(migrate.load_bundle(self.directory), self.manifest)


class UniqueIndexGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.manifest = make_bundle(self.directory)
        self.conn = MagicMock()
        self.conn.execute.return_value.fetchone.return_value = ("fixture-timestamp", "17")
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        for name in ("prepare_transaction", "lock_tables", "check_target_identity"):
            self.stack.enter_context(patch.object(migrate, name))
        self.stack.enter_context(patch.object(migrate, "inventory", return_value=list(migrate.TABLES)))
        self.stack.enter_context(patch.object(migrate, "external_incoming_foreign_keys", return_value=[]))
        self.stack.enter_context(patch.object(migrate, "read_schema", side_effect=lambda conn, table: schema(table)))
        self.stack.enter_context(patch.object(migrate, "read_constraints", side_effect=lambda conn, table: migrate.EXPECTED_CONSTRAINTS[table]))
        self.stack.enter_context(patch.object(migrate, "read_triggers", side_effect=lambda conn, table: triggers(table)))
        self.stack.enter_context(patch.object(migrate, "read_standalone_unique_indexes",
                                            side_effect=lambda conn, table: ["unique_lower_email"] if table == "users" else []))
        self.stack.enter_context(patch.object(migrate, "count_rows", return_value=0))

    def test_inspection_reports_standalone_unique_index_drift(self):
        report = migrate.inspect_source(self.conn)
        self.assertEqual(report["tables"]["users"]["standalone_unique_indexes"], ["unique_lower_email"])
        self.assertEqual(len(report["schema_drift"]), 1)
        self.assertIn("Standalone unique index drift in users", report["schema_drift"][0])

    def test_export_refuses_unique_index_before_copy_and_keeps_incomplete_marker(self):
        output = self.directory / "export"
        with patch.object(migrate, "copy_out") as copy_out:
            with self.assertRaisesRegex(migrate.MigrationError, "Standalone unique index drift"):
                migrate.export_bundle(self.conn, output)
            copy_out.assert_not_called()
        self.assertTrue((output / ".incomplete").exists())
        self.assertFalse((output / "manifest.json").exists())

    def test_target_unique_index_refuses_import_before_copy(self):
        with patch.object(migrate, "copy_in") as copy_in:
            with self.assertRaisesRegex(migrate.MigrationError, "Standalone unique index drift"):
                migrate.import_bundle(self.conn, self.directory)
            copy_in.assert_not_called()
        self.assertEqual(self.conn.transaction.return_value.__exit__.call_args.args[0], migrate.MigrationError)

    def test_target_unique_index_refuses_verification(self):
        with patch.object(migrate, "verify_rows") as verify_rows:
            with self.assertRaisesRegex(migrate.MigrationError, "Standalone unique index drift"):
                migrate.verify_bundle(self.conn, self.directory)
            verify_rows.assert_not_called()


class TransactionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.manifest = make_bundle(self.directory)
        self.conn = MagicMock()
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.mocks = {}
        for name in ("prepare_transaction", "check_target_identity", "lock_tables", "compare_target_schema",
                     "check_empty_target", "copy_in", "verify_rows"):
            self.mocks[name] = self.stack.enter_context(patch.object(migrate, name))
        self.mocks["verify_rows"].return_value = {table: 0 for table in migrate.TABLES}

    def test_single_transaction_users_first_verify_before_commit(self):
        events = []
        self.mocks["copy_in"].side_effect = lambda conn, table, path: events.append(table)
        self.mocks["verify_rows"].side_effect = lambda *args: events.append("verify") or {}
        self.conn.transaction.return_value.__exit__.side_effect = lambda *args: events.append("commit") or False
        migrate.import_bundle(self.conn, self.directory)
        self.assertEqual(events, [*migrate.TABLES, "verify", "commit"])
        self.conn.transaction.assert_called_once()
        self.mocks["lock_tables"].assert_called_once_with(self.conn, writing=True)
        self.mocks["prepare_transaction"].assert_called_once_with(self.conn, readonly=False)

    def test_nonempty_target_aborts_before_copy(self):
        self.mocks["check_empty_target"].side_effect = migrate.MigrationError("nonempty")
        with self.assertRaises(migrate.MigrationError):
            migrate.import_bundle(self.conn, self.directory)
        self.mocks["copy_in"].assert_not_called()
        self.assertEqual(self.conn.transaction.return_value.__exit__.call_args.args[0], migrate.MigrationError)

    def test_wrong_database_aborts_before_lock_or_copy(self):
        self.mocks["check_target_identity"].side_effect = migrate.MigrationError("wrong database")
        with self.assertRaises(migrate.MigrationError):
            migrate.import_bundle(self.conn, self.directory)
        self.mocks["lock_tables"].assert_not_called()
        self.mocks["copy_in"].assert_not_called()

    def test_schema_drift_aborts_before_copy(self):
        self.mocks["compare_target_schema"].side_effect = migrate.MigrationError("drift")
        with self.assertRaises(migrate.MigrationError):
            migrate.import_bundle(self.conn, self.directory)
        self.mocks["copy_in"].assert_not_called()

    def test_copy_error_escapes_transaction_for_rollback(self):
        self.mocks["copy_in"].side_effect = [None, migrate.MigrationError("FK error")]
        with self.assertRaisesRegex(migrate.MigrationError, "FK error"):
            migrate.import_bundle(self.conn, self.directory)
        self.mocks["verify_rows"].assert_not_called()
        self.assertEqual(self.conn.transaction.return_value.__exit__.call_args.args[0], migrate.MigrationError)

    def test_content_mismatch_rolls_back_after_copy(self):
        self.mocks["verify_rows"].side_effect = migrate.MigrationError("checksum")
        with self.assertRaisesRegex(migrate.MigrationError, "checksum"):
            migrate.import_bundle(self.conn, self.directory)
        self.assertEqual(self.mocks["copy_in"].call_count, 7)
        self.assertEqual(self.conn.transaction.return_value.__exit__.call_args.args[0], migrate.MigrationError)

    def test_corrupt_bundle_does_not_open_transaction(self):
        (self.directory / "devices.csv").write_bytes(b"broken")
        with self.assertRaises(migrate.MigrationError):
            migrate.import_bundle(self.conn, self.directory)
        self.conn.transaction.assert_not_called()


class GuardAndCLITests(unittest.TestCase):
    def test_identity_checks_database_and_role(self):
        for identity in (("investor", "eink_admin"), ("eink", "postgres")):
            conn = MagicMock()
            conn.execute.return_value.fetchone.return_value = identity
            with self.assertRaisesRegex(migrate.MigrationError, "dedicated database"):
                migrate.check_target_identity(conn)

    def test_identity_requires_exact_marker(self):
        for marker in ([], [(True, "investor", 1)], [(True, "esp32-eink", 2)]):
            conn = MagicMock()
            conn.execute.return_value.fetchone.side_effect = [("eink", "eink_admin"), ("migration_control.target_identity",)]
            conn.execute.return_value.fetchall.return_value = marker
            with self.assertRaisesRegex(migrate.MigrationError, "identity marker"):
                migrate.check_target_identity(conn)

    def test_identity_rejects_unexpected_target_tables(self):
        conn = MagicMock()
        conn.execute.return_value.fetchone.side_effect = [("eink", "eink_admin"), ("migration_control.target_identity",)]
        conn.execute.return_value.fetchall.return_value = [(True, "esp32-eink", 1)]
        with patch.object(migrate, "inventory", return_value=[*migrate.TABLES, "investor_transactions"]):
            with self.assertRaisesRegex(migrate.MigrationError, "unexpected public tables"):
                migrate.check_target_identity(conn)

    def test_empty_guard_checks_every_table(self):
        with patch.object(migrate, "count_rows", side_effect=lambda conn, table: int(table == "orders")) as count:
            with self.assertRaisesRegex(migrate.MigrationError, "orders"):
                migrate.check_empty_target(MagicMock())
            self.assertEqual(count.call_count, 7)

    def test_source_connection_forces_tls_and_readonly_inspection(self):
        with patch.object(migrate.psycopg, "connect") as connect, patch.object(migrate, "inspect_source", return_value={"schema_drift": []}), patch("sys.stdout", new=io.StringIO()):
            self.assertEqual(migrate.main(["inspect", "--service", "supabase_source"]), 0)
            self.assertEqual(connect.call_args.kwargs["sslmode"], "verify-full")
            self.assertNotIn("password", connect.call_args.kwargs)

    def test_inspect_drift_returns_nonzero(self):
        with patch.object(migrate.psycopg, "connect"), patch.object(migrate, "inspect_source", return_value={"schema_drift": ["extra column"]}), patch("sys.stdout", new=io.StringIO()):
            self.assertEqual(migrate.main(["inspect", "--service", "supabase_source"]), 2)

    def test_service_disallows_connection_string_injection(self):
        with patch("sys.stderr", new=io.StringIO()), patch.object(migrate.psycopg, "connect") as connect:
            with self.assertRaises(SystemExit):
                migrate.main(["inspect", "--service", "foo password=leak"])
            connect.assert_not_called()

    def test_database_exception_does_not_print_row_or_credentials(self):
        stderr = io.StringIO()
        with patch.object(migrate.psycopg, "connect", side_effect=migrate.psycopg.OperationalError("password=secret; failing row personal@email")), patch("sys.stderr", new=stderr):
            self.assertEqual(migrate.main(["inspect", "--service", "supabase_source"]), 1)
        self.assertNotIn("secret", stderr.getvalue())
        self.assertNotIn("personal@email", stderr.getvalue())

    def test_canonical_session_rejects_rls_truncation(self):
        conn = MagicMock()
        migrate.prepare_transaction(conn, readonly=True)
        statements = [call.args[0] for call in conn.execute.call_args_list]
        self.assertIn("SET LOCAL row_security = off", statements)
        self.assertIn("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY", statements)
        self.assertIn("SET LOCAL TIME ZONE 'UTC'", statements)


if __name__ == "__main__":
    unittest.main()
