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
    result = [{"name": f"update_{table}_updated_at", "type": 19, "enabled": "O", "function_schema": "public",
             "function_name": "update_updated_at_column",
             "definition": f"CREATE TRIGGER update_{table}_updated_at BEFORE UPDATE ON public.{table} FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()",
             "function_language": "plpgsql", "function_security_definer": False, "function_settings": None,
             "function_volatility": "v", "function_strict": False, "function_parallel": "u", "function_return_type": "trigger",
             "function_body_sha256": hashlib.sha256(b"BEGIN NEW.updated_at = now(); RETURN NEW; END;").hexdigest()}]
    if table == "devices":
        result.insert(0, {
            "name": "clear_device_display_on_transfer", "type": 17, "enabled": "O", "function_schema": "public",
            "function_name": "clear_device_display_on_transfer",
            "definition": "CREATE TRIGGER clear_device_display_on_transfer AFTER UPDATE OF user_id ON public.devices FOR EACH ROW WHEN (old.user_id IS DISTINCT FROM new.user_id) EXECUTE FUNCTION clear_device_display_on_transfer()",
            "function_language": "plpgsql", "function_security_definer": True, "function_settings": ["search_path=public"],
            "function_volatility": "v", "function_strict": False, "function_parallel": "u", "function_return_type": "trigger",
            "function_body_sha256": hashlib.sha256(b"BEGIN DELETE FROM public.device_displays WHERE device_id = NEW.id; RETURN NEW; END;").hexdigest(),
        })
    return result


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
    def test_pre019_delivery_schema_is_rejected(self):
        fields = [field for field in schema("device_delivery") if not field["name"].startswith("refresh_")]
        with self.assertRaises(migrate.MigrationError):
            migrate.check_schema("device_delivery", fields)

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
            if column["name"] in ("layout", "display_profile", "display_schedule"):
                column["default"] = "NULL::jsonb"
        migrate.check_schema("user_preferences", fields)

    def test_current_table_allowlist_and_dependency_order(self):
        self.assertEqual(migrate.TABLES, (
            "users", "user_preferences", "api_keys", "devices", "firmware_versions", "api_usage",
            "custom_webhooks", "device_delivery", "device_displays", "orders",
        ))
        self.assertEqual(migrate.PRIMARY_KEYS["custom_webhooks"], ("user_id",))
        self.assertEqual(migrate.PRIMARY_KEYS["device_delivery"], ("device_id",))
        self.assertEqual(migrate.PRIMARY_KEYS["device_displays"], ("device_id",))
        self.assertLess(migrate.TABLES.index("devices"), migrate.TABLES.index("device_delivery"))
        self.assertLess(migrate.TABLES.index("devices"), migrate.TABLES.index("device_displays"))

    def test_new_tables_preserve_credentials_and_telemetry_without_synthetic_ids(self):
        expected = {
            "custom_webhooks": {"user_id", "token_hash", "token_created_at", "rows", "observed_at", "received_at"},
            "device_delivery": {"device_id", "owner_id", "token_hash", "rotated_at", "revoked_at", "last_seen_at",
                                "firmware_version", "battery_percent", "rssi", "last_applied_hash",
                                "refresh_request_id", "refresh_requested_at", "refresh_applied_at"},
            "device_displays": {"device_id", "owner_id", "layout", "display_schedule", "active_layout_id", "display_profile",
                                "display_timezone", "refresh_interval_minutes", "revision", "updated_at"},
        }
        for table, fields in expected.items():
            self.assertEqual(set(migrate.EXPECTED_COLUMNS[table]), fields)
            self.assertEqual(set(migrate.EXPECTED_DEFAULTS[table]), fields)
            self.assertNotIn("id", fields)
            self.assertIsNone(migrate.EXPECTED_DEFAULTS[table][migrate.PRIMARY_KEYS[table][0]])

    def test_new_preference_fields_and_nullability_are_required(self):
        required = {"news_source", "news_feed_url", "news_item_limit", "show_custom_text", "custom_text",
                    "show_custom_image", "show_calendar", "calendar_timezone", "calendar_days", "calendar_item_limit",
                    "show_custom_webhook", "custom_webhook_ttl_minutes", "display_timezone", "energy_price_settings"}
        optional = {"display_profile", "custom_image", "display_schedule"}
        for name in required | optional:
            with self.subTest(column=name):
                fields = schema("user_preferences")
                self.assertEqual(next(field["nullable"] for field in fields if field["name"] == name), name in optional)
                with self.assertRaisesRegex(migrate.MigrationError, "missing columns"):
                    migrate.check_schema("user_preferences", [field for field in fields if field["name"] != name])

    def test_display_timezone_default_must_be_copenhagen(self):
        fields = schema("user_preferences")
        zone = next(field for field in fields if field["name"] == "display_timezone")
        self.assertEqual(zone["default"], "'Europe/Copenhagen'::text")
        zone["default"] = "'UTC'::text"
        with self.assertRaises(migrate.MigrationError):
            migrate.check_schema("user_preferences", fields)

    def test_energy_price_settings_default_must_preserve_spot_mode(self):
        fields = schema("user_preferences")
        settings = next(field for field in fields if field["name"] == "energy_price_settings")
        self.assertEqual(settings["default"], "'{\"mode\": \"spot\"}'::jsonb")
        settings["default"] = None
        with self.assertRaises(migrate.MigrationError):
            migrate.check_schema("user_preferences", fields)

    def test_every_tracked_check_is_required_and_bounds_cannot_be_weakened(self):
        self.assertEqual({table: len(checks) for table, checks in migrate.EXPECTED_CHECKS.items()},
                         {"user_preferences": 8, "custom_webhooks": 2, "device_delivery": 4, "device_displays": 7})
        for table in migrate.EXPECTED_CHECKS:
            for index, constraint in enumerate(migrate.EXPECTED_CONSTRAINTS[table]):
                if constraint["type"] != "c":
                    continue
                with self.subTest(table=table, definition=constraint["definition"]):
                    constraints = copy.deepcopy(migrate.EXPECTED_CONSTRAINTS[table])
                    constraints.pop(index)
                    with self.assertRaisesRegex(migrate.MigrationError, "Constraint drift"):
                        migrate.check_relations(table, constraints, triggers(table))
                    constraints = copy.deepcopy(migrate.EXPECTED_CONSTRAINTS[table])
                    constraints[index]["definition"] += " NOT VALID"
                    with self.assertRaisesRegex(migrate.MigrationError, "Constraint drift"):
                        migrate.check_relations(table, constraints, triggers(table))
        for table, before, after in (("user_preferences", "<= 1440", "<= 14400"),
                                     ("custom_webhooks", "<= 12", "<= 120"),
                                     ("device_delivery", "<= 100::", "<= 1000::"),
                                     ("device_displays", "<= 1440", "<= 14400")):
            constraints = copy.deepcopy(migrate.EXPECTED_CONSTRAINTS[table])
            for constraint in constraints:
                constraint["definition"] = constraint["definition"].replace(before, after)
            with self.assertRaisesRegex(migrate.MigrationError, "Constraint drift"):
                migrate.check_relations(table, constraints, triggers(table))

    def test_new_table_defaults_and_both_delivery_foreign_keys_are_required(self):
        for table, name in (("custom_webhooks", "rows"), ("device_delivery", "rotated_at")):
            fields = schema(table)
            next(field for field in fields if field["name"] == name)["default"] = None
            with self.assertRaisesRegex(migrate.MigrationError, "incompatible default"):
                migrate.check_schema(table, fields)
        for key in ("device_id", "owner_id"):
            constraints = [c for c in migrate.EXPECTED_CONSTRAINTS["device_delivery"]
                           if not c["definition"].startswith(f"FOREIGN KEY ({key})")]
            with self.assertRaisesRegex(migrate.MigrationError, "Constraint drift"):
                migrate.check_relations("device_delivery", constraints, [])

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

    def test_transfer_reset_trigger_cannot_be_removed_or_weakened(self):
        with self.assertRaisesRegex(migrate.MigrationError, "Trigger drift"):
            migrate.check_relations("devices", migrate.EXPECTED_CONSTRAINTS["devices"], triggers("devices")[1:])
        for changes in ({"type": 19}, {"enabled": "D"}, {"function_security_definer": False},
                        {"function_settings": None}, {"function_body_sha256": hashlib.sha256(b"RETURN NEW;").hexdigest()},
                        {"definition": triggers("devices")[0]["definition"].replace("IS DISTINCT FROM", "=")}):
            value = triggers("devices")
            value[0].update(changes)
            with self.assertRaisesRegex(migrate.MigrationError, "Trigger drift"):
                migrate.check_relations("devices", migrate.EXPECTED_CONSTRAINTS["devices"], value)

    def test_device_display_defaults_and_owner_foreign_keys_are_required(self):
        for name in ("display_timezone", "refresh_interval_minutes", "revision", "updated_at"):
            fields = schema("device_displays")
            next(field for field in fields if field["name"] == name)["default"] = None
            with self.assertRaisesRegex(migrate.MigrationError, "incompatible default"):
                migrate.check_schema("device_displays", fields)
        for key in ("device_id, owner_id", "owner_id"):
            constraints = [item for item in migrate.EXPECTED_CONSTRAINTS["device_displays"]
                           if not item["definition"].startswith(f"FOREIGN KEY ({key})")]
            with self.assertRaisesRegex(migrate.MigrationError, "Constraint drift"):
                migrate.check_relations("device_displays", constraints, [])

    def test_owner_foreign_key_cannot_be_weakened_to_device_only(self):
        constraints = copy.deepcopy(migrate.EXPECTED_CONSTRAINTS["device_displays"])
        owner_key = next(item for item in constraints if item["definition"].startswith("FOREIGN KEY (device_id, owner_id)"))
        owner_key["definition"] = "FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE"
        with self.assertRaisesRegex(migrate.MigrationError, "Constraint drift"):
            migrate.check_relations("device_displays", constraints, [])
        constraints = [item for item in migrate.EXPECTED_CONSTRAINTS["devices"] if item["definition"] != "UNIQUE (id, user_id)"]
        with self.assertRaisesRegex(migrate.MigrationError, "Constraint drift"):
            migrate.check_relations("devices", constraints, triggers("devices"))


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
        with self.assertRaisesRegex(migrate.MigrationError, "10 CSV"):
            migrate.load_bundle(self.directory)

    def test_extra_file_rejected(self):
        (self.directory / "auth.csv").touch()
        with self.assertRaisesRegex(migrate.MigrationError, "10 CSV"):
            migrate.load_bundle(self.directory)

    def test_manifest_cannot_select_external_file(self):
        self.manifest["tables"]["api_keys"]["file"] = "../secrets.csv"
        write_manifest(self.directory, self.manifest)
        with self.assertRaisesRegex(migrate.MigrationError, "Unexpected filename"):
            migrate.load_bundle(self.directory)

    def test_legacy_seven_table_bundle_is_rejected(self):
        for table in ("custom_webhooks", "device_delivery", "device_displays"):
            self.manifest["tables"].pop(table)
            (self.directory / f"{table}.csv").unlink()
        write_manifest(self.directory, self.manifest)
        with self.assertRaisesRegex(migrate.MigrationError, "10 CSV"):
            migrate.load_bundle(self.directory)

    def test_pre018_nine_table_bundle_is_rejected(self):
        self.manifest["tables"].pop("device_displays")
        (self.directory / "device_displays.csv").unlink()
        write_manifest(self.directory, self.manifest)
        with self.assertRaisesRegex(migrate.MigrationError, "10 CSV"):
            migrate.load_bundle(self.directory)

    def test_webhook_and_delivery_data_are_checksummed(self):
        for table in ("custom_webhooks", "device_delivery", "device_displays"):
            with self.subTest(table=table):
                path = self.directory / f"{table}.csv"
                original = path.read_bytes()
                path.write_bytes(original + b"changed token hash or telemetry\n")
                with self.assertRaisesRegex(migrate.MigrationError, "checksum/size"):
                    migrate.load_bundle(self.directory)
                path.write_bytes(original)

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
        self.assertEqual(self.mocks["copy_in"].call_count, 10)
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
            self.assertEqual(count.call_count, 10)

    def test_nonempty_new_table_blocks_import(self):
        for table in ("custom_webhooks", "device_delivery", "device_displays"):
            with patch.object(migrate, "count_rows", side_effect=lambda conn, current: int(current == table)):
                with self.assertRaisesRegex(migrate.MigrationError, table):
                    migrate.check_empty_target(MagicMock())

    def test_incoming_foreign_key_guard_includes_new_tables_in_both_allowlists(self):
        conn = MagicMock()
        conn.execute.return_value.fetchall.return_value = []
        self.assertEqual(migrate.external_incoming_foreign_keys(conn), [])
        self.assertEqual(conn.execute.call_args.args[1], (list(migrate.TABLES), list(migrate.TABLES)))

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


class CopyAndVerificationTests(unittest.TestCase):
    def test_copy_orders_complete_rows_by_each_actual_primary_key(self):
        for table, key in (("users", "id"), ("custom_webhooks", "user_id"), ("device_delivery", "device_id"), ("device_displays", "device_id")):
            conn = MagicMock()
            copy_call = conn.cursor.return_value.__enter__.return_value.copy
            copy_call.return_value.__enter__.return_value.__iter__.return_value = iter([b"first", b"second"])
            stream = io.BytesIO()
            digest, size = migrate.copy_out(conn, table, stream)
            command = copy_call.call_args.args[0].as_string()
            self.assertIn(f'ORDER BY "{key}"', command)
            for name in migrate.EXPECTED_COLUMNS[table]:
                self.assertIn(f'"{name}"', command)
            self.assertEqual(stream.getvalue(), b"firstsecond")
            self.assertEqual((digest, size), (hashlib.sha256(b"firstsecond").hexdigest(), 11))

    def test_verify_detects_new_table_content_change_even_with_matching_count(self):
        for changed_table in ("custom_webhooks", "device_delivery", "device_displays"):
            with tempfile.TemporaryDirectory() as directory:
                manifest = make_bundle(Path(directory))
                def copied(conn, table):
                    item = manifest["tables"][table]
                    return ("0" * 64 if table == changed_table else item["sha256"], item["bytes"])
                with patch.object(migrate, "count_rows", return_value=0), patch.object(migrate, "copy_out", side_effect=copied):
                    with self.assertRaisesRegex(migrate.MigrationError, f"checksum mismatch for {changed_table}"):
                        migrate.verify_rows(MagicMock(), manifest)


if __name__ == "__main__":
    unittest.main()
