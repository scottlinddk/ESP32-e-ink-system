#!/usr/bin/env python3
"""Copy only the ten e-ink application tables; never copy Supabase internals.

Connection secrets belong in libpq service/password files, never command arguments.
Exports contain encrypted API keys and personal data: keep the entire bundle private.
The source is always read-only and uses certificate/hostname verification.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import sys
from typing import Any

import psycopg
from psycopg import sql


FORMAT_VERSION = 1
APPLICATION = "esp32-eink"
TARGET_DATABASE = "eink"
TARGET_ROLE = "eink_admin"
# Parents precede their children (device delivery/display rows reference devices).
TABLES = ("users", "user_preferences", "api_keys", "devices", "firmware_versions", "api_usage",
          "custom_webhooks", "device_delivery", "device_displays", "orders")
# Stable complete-row checksums require the actual primary key, not an assumed id.
PRIMARY_KEYS = {table: ("id",) for table in TABLES}
PRIMARY_KEYS.update({"custom_webhooks": ("user_id",), "device_delivery": ("device_id",), "device_displays": ("device_id",)})


def columns(required: dict[str, str], optional: dict[str, str]) -> dict[str, tuple[str, bool]]:
    return {**{k: (v, False) for k, v in required.items()}, **{k: (v, True) for k, v in optional.items()}}


TS = "timestamp with time zone"
# The final schema after all tracked migrations through 019_device_refresh.
# Do not automatically repair a live source.
EXPECTED_COLUMNS = {
    "users": columns({"id": "uuid", "email": "text"}, {"display_name": "text", "created_at": TS, "updated_at": TS}),
    "user_preferences": columns({
        "id": "uuid", "user_id": "uuid", "news_source": "text", "news_feed_url": "text",
        "news_item_limit": "integer", "show_custom_text": "boolean", "custom_text": "text",
        "show_custom_image": "boolean", "show_calendar": "boolean", "calendar_timezone": "text",
        "calendar_days": "integer", "calendar_item_limit": "integer", "show_custom_webhook": "boolean",
        "custom_webhook_ttl_minutes": "integer", "display_timezone": "text", "energy_price_settings": "jsonb",
    }, {
        "show_energy_price": "boolean", "show_weather": "boolean", "show_news": "boolean",
        "show_air_quality": "boolean", "energy_price_location": "text", "weather_location": "text",
        "news_language": "text", "refresh_interval_minutes": "integer", "created_at": TS,
        "updated_at": TS, "layout": "jsonb", "show_monta": "boolean", "show_zaptec": "boolean",
        "monta_fields": "jsonb", "zaptec_fields": "jsonb", "show_notion": "boolean",
        "display_profile": "jsonb", "custom_image": "jsonb", "display_schedule": "jsonb",
    }),
    "api_keys": columns({"id": "uuid", "user_id": "uuid", "provider": "text", "api_key": "text"}, {"created_at": TS}),
    "devices": columns({"id": "uuid", "user_id": "uuid", "device_id": "text"}, {
        "device_name": "text", "license_key": "text", "firmware_version": "text", "last_seen_at": TS,
        "created_at": TS, "updated_at": TS, "ble_name": "text",
    }),
    "firmware_versions": columns({"id": "uuid", "user_id": "uuid", "version": "text", "download_path": "text"}, {
        "checksum": "text", "release_notes": "text", "active": "boolean", "created_at": TS,
    }),
    "api_usage": columns({"id": "uuid", "user_id": "uuid"}, {"endpoint": "text", "called_at": TS}),
    "custom_webhooks": columns({"user_id": "uuid", "rows": "jsonb"}, {
        "token_hash": "text", "token_created_at": TS, "observed_at": TS, "received_at": TS,
    }),
    "device_delivery": columns({"device_id": "uuid", "owner_id": "uuid", "rotated_at": TS}, {
        "token_hash": "text", "revoked_at": TS, "last_seen_at": TS, "firmware_version": "text",
        "battery_percent": "double precision", "rssi": "integer", "last_applied_hash": "text",
        "refresh_request_id": "uuid", "refresh_requested_at": TS, "refresh_applied_at": TS,
    }),
    "device_displays": columns({
        "device_id": "uuid", "owner_id": "uuid", "display_timezone": "text",
        "refresh_interval_minutes": "integer", "revision": "integer", "updated_at": TS,
    }, {"layout": "jsonb", "display_schedule": "jsonb", "active_layout_id": "text", "display_profile": "jsonb"}),
    "orders": columns({"id": "uuid", "user_id": "uuid"}, {
        "stripe_charge_id": "text", "amount_cents": "integer", "status": "text", "created_at": TS,
    }),
}

# Missing defaults can break backend inserts even when all migrated rows match.
EXPECTED_DEFAULTS: dict[str, dict[str, str | None]] = {
    table: {name: None for name in fields} for table, fields in EXPECTED_COLUMNS.items()
}
for _table, _fields in EXPECTED_DEFAULTS.items():
    if "id" in _fields:
        _fields["id"] = "gen_random_uuid()"
    for _name in ("created_at", "updated_at", "called_at"):
        if _name in _fields:
            _fields[_name] = "now()"
EXPECTED_DEFAULTS["user_preferences"].update({
    "display_timezone": "'Europe/Copenhagen'::text",
    "energy_price_settings": "'{\"mode\": \"spot\"}'::jsonb",
    "show_energy_price": "true", "show_weather": "true", "show_news": "true", "show_air_quality": "false",
    "energy_price_location": "'DK1'::text", "weather_location": "'55.3,10.4'::text", "news_language": "'da'::text",
    "refresh_interval_minutes": "30", "show_monta": "false", "show_zaptec": "false", "show_notion": "false",
    "monta_fields": "'[\"charger_status\", \"active_session\"]'::jsonb",
    "zaptec_fields": "'[\"charger_status\", \"active_session\"]'::jsonb",
    "news_source": "'newsapi'::text", "news_feed_url": "''::text", "news_item_limit": "3",
    "show_custom_text": "false", "custom_text": "''::text", "show_custom_image": "false",
    "show_calendar": "false", "calendar_timezone": "'Europe/Copenhagen'::text", "calendar_days": "7",
    "calendar_item_limit": "5", "show_custom_webhook": "false", "custom_webhook_ttl_minutes": "60",
})
EXPECTED_DEFAULTS["devices"].update({"device_name": "'My Display'::text", "firmware_version": "'1.0.0'::text"})
EXPECTED_DEFAULTS["firmware_versions"]["active"] = "true"
EXPECTED_DEFAULTS["orders"]["status"] = "'pending'::text"
EXPECTED_DEFAULTS["custom_webhooks"]["rows"] = "'[]'::jsonb"
EXPECTED_DEFAULTS["device_delivery"]["rotated_at"] = "now()"
EXPECTED_DEFAULTS["device_displays"].update({
    "display_timezone": "'Europe/Copenhagen'::text", "refresh_interval_minutes": "30", "revision": "1",
})

# PostgreSQL's pretty constraint definitions, including every tracked CHECK.
# Keep casts, bounds, regexes and boolean grouping exact: removing them while
# normalizing can accidentally accept a different integrity rule.
EXPECTED_CHECKS = {
    "user_preferences": (
        "CHECK (news_source = ANY (ARRAY['newsapi'::text, 'rss'::text]))",
        "CHECK (length(news_feed_url) <= 2048)",
        "CHECK (news_item_limit >= 1 AND news_item_limit <= 10)",
        "CHECK (char_length(custom_text) <= 2000)",
        "CHECK (custom_image IS NULL OR jsonb_typeof(custom_image) = 'object'::text AND octet_length(custom_image::text) <= 45000)",
        "CHECK (calendar_days >= 1 AND calendar_days <= 30)",
        "CHECK (calendar_item_limit >= 1 AND calendar_item_limit <= 10)",
        "CHECK (custom_webhook_ttl_minutes >= 1 AND custom_webhook_ttl_minutes <= 1440)",
    ),
    "custom_webhooks": (
        "CHECK (token_hash IS NULL OR token_hash ~ '^[a-f0-9]{64}$'::text)",
        "CHECK (jsonb_typeof(rows) = 'array'::text AND jsonb_array_length(rows) <= 12 AND octet_length(rows::text) <= 16000)",
    ),
    "device_delivery": (
        "CHECK (token_hash IS NULL OR token_hash ~ '^[0-9a-f]{64}$'::text)",
        "CHECK (battery_percent >= 0::double precision AND battery_percent <= 100::double precision)",
        "CHECK (rssi >= '-150'::integer AND rssi <= 0)",
        "CHECK (last_applied_hash IS NULL OR last_applied_hash ~ '^[0-9a-f]{64}$'::text)",
    ),
    "device_displays": (
        "CHECK (layout IS NULL OR jsonb_typeof(layout) = 'object'::text)",
        "CHECK (display_schedule IS NULL OR jsonb_typeof(display_schedule) = 'object'::text)",
        "CHECK (active_layout_id IS NULL OR active_layout_id ~ '^[A-Za-z0-9_-]{1,48}$'::text)",
        "CHECK (display_profile IS NULL OR jsonb_typeof(display_profile) = 'object'::text)",
        "CHECK (length(display_timezone) >= 1 AND length(display_timezone) <= 64)",
        "CHECK (refresh_interval_minutes >= 1 AND refresh_interval_minutes <= 1440)",
        "CHECK (revision > 0)",
    ),
}

EXPECTED_CONSTRAINTS: dict[str, list[dict[str, str]]] = {}
for _table in TABLES:
    _constraints = [{"type": "p", "definition": f"PRIMARY KEY ({', '.join(PRIMARY_KEYS[_table])})"}]
    if _table in ("device_delivery", "device_displays"):
        _constraints.extend([
            {"type": "f", "definition": "FOREIGN KEY (device_id, owner_id) REFERENCES devices(id, user_id) ON UPDATE CASCADE ON DELETE CASCADE" if _table == "device_displays" else "FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE"},
            {"type": "f", "definition": "FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE"},
        ])
    elif _table != "users":
        _constraints.append({"type": "f", "definition": "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"})
    for _key in {"users": ["email"], "user_preferences": ["user_id"], "api_keys": ["user_id, provider"],
                 "devices": ["device_id", "license_key", "id, user_id"], "custom_webhooks": ["token_hash"]}.get(_table, []):
        _constraints.append({"type": "u", "definition": f"UNIQUE ({_key})"})
    _constraints.extend({"type": "c", "definition": definition} for definition in EXPECTED_CHECKS.get(_table, ()))
    EXPECTED_CONSTRAINTS[_table] = sorted(_constraints, key=lambda item: (item["type"], item["definition"]))


def normalize_default(value: str | None) -> str | None:
    if value is None or re.fullmatch(r"NULL(?:::[a-z ]+)?", value):
        return None
    # Supabase may install pgcrypto into extensions; the built-in UUID function
    # is equivalent. Do not loosen arbitrary defaults or execute their content.
    if re.fullmatch(r"(?:(?:public|extensions|pg_catalog)\.)?gen_random_uuid\(\)", value):
        return "gen_random_uuid()"
    return value


class MigrationError(Exception):
    """A deliberately safe-to-display error: never include row data or passwords."""


def canonical_json(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=True) + "\n").encode("utf-8")


def sha256_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def check_schema(table: str, metadata: list[dict[str, Any]]) -> None:
    if table not in EXPECTED_COLUMNS:
        raise MigrationError("Table is outside the fixed application allowlist.")
    expected = EXPECTED_COLUMNS[table]
    actual = {column["name"]: column for column in metadata}
    if len(actual) != len(metadata):
        raise MigrationError(f"Schema drift in {table}: duplicate column metadata.")
    missing, extra = sorted(expected.keys() - actual.keys()), sorted(actual.keys() - expected.keys())
    problems = []
    if missing:
        problems.append("missing columns " + ", ".join(missing))
    if extra:
        problems.append("extra columns " + ", ".join(extra))
    for name in sorted(expected.keys() & actual.keys()):
        column = actual[name]
        kind, nullable = expected[name]
        if column.get("type") != kind or column.get("nullable") is not nullable:
            problems.append(f"incompatible type/nullability for {name}")
        if column.get("generated", "") or column.get("identity", ""):
            problems.append(f"generated/identity column {name} is unsupported")
        if normalize_default(column.get("default")) != EXPECTED_DEFAULTS[table][name]:
            problems.append(f"incompatible default for {name}")
    if problems:
        raise MigrationError(f"Schema drift in {table}: {'; '.join(problems)}. Reconcile explicitly before migrating.")


def prepare_transaction(conn: Any, *, readonly: bool) -> None:
    conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ" + (", READ ONLY" if readonly else ", READ WRITE"))
    # A low-privilege source must fail rather than silently export only RLS-visible rows.
    conn.execute("SET LOCAL row_security = off")
    conn.execute("SET LOCAL search_path = public, pg_catalog")
    conn.execute("SET LOCAL TIME ZONE 'UTC'")
    conn.execute("SET LOCAL DateStyle = 'ISO, YMD'")
    conn.execute("SET LOCAL IntervalStyle = 'postgres'")
    conn.execute("SET LOCAL extra_float_digits = 3")
    conn.execute("SET LOCAL bytea_output = 'hex'")
    conn.execute("SET LOCAL client_encoding = 'UTF8'")
    conn.execute("SET LOCAL lock_timeout = '10s'")
    conn.execute("SET LOCAL statement_timeout = '30min'")


def lock_tables(conn: Any, *, writing: bool) -> None:
    names = sql.SQL(", ").join(sql.Identifier("public", table) for table in TABLES)
    mode = sql.SQL("ACCESS EXCLUSIVE" if writing else "ACCESS SHARE")
    conn.execute(sql.SQL("LOCK TABLE {} IN {} MODE").format(names, mode))


def inventory(conn: Any) -> list[str]:
    return [row[0] for row in conn.execute(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
    ).fetchall()]


def read_schema(conn: Any, table: str) -> list[dict[str, Any]]:
    rows = conn.execute("""
        SELECT a.attname, format_type(a.atttypid, a.atttypmod), NOT a.attnotnull,
               a.attgenerated, a.attidentity, pg_get_expr(d.adbin, d.adrelid)
        FROM pg_attribute a
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = %s::regclass AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attname
    """, (f"public.{table}",)).fetchall()
    return [dict(zip(("name", "type", "nullable", "generated", "identity", "default"), row)) for row in rows]


def read_constraints(conn: Any, table: str) -> list[dict[str, str]]:
    rows = conn.execute("""
        SELECT contype, pg_get_constraintdef(oid, true)
        FROM pg_constraint WHERE conrelid = %s::regclass
        AND contype IN ('p', 'u', 'f', 'c', 'x')
        ORDER BY contype, pg_get_constraintdef(oid, true)
    """, (f"public.{table}",)).fetchall()
    return [{"type": row[0], "definition": row[1]} for row in rows]


def read_standalone_unique_indexes(conn: Any, table: str) -> list[str]:
    # CREATE UNIQUE INDEX enforces integrity without adding a pg_constraint row.
    # A foreign key may reference that index; only its owning PRIMARY KEY/UNIQUE
    # (or exclusion) constraint makes it part of the constraints checked above.
    rows = conn.execute("""
        SELECT idx.relname
        FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid
        WHERE i.indrelid = %s::regclass AND i.indisunique
          AND NOT EXISTS (
              SELECT 1 FROM pg_constraint con
              WHERE con.conindid = i.indexrelid AND con.contype IN ('p', 'u', 'x')
          )
        ORDER BY idx.relname
    """, (f"public.{table}",)).fetchall()
    return [row[0] for row in rows]


def check_unique_indexes(table: str, indexes: list[str]) -> None:
    if indexes:
        raise MigrationError(f"Standalone unique index drift in {table}: " + ", ".join(indexes) +
                             ". Reconcile these integrity rules explicitly before migrating.")


def read_triggers(conn: Any, table: str) -> list[dict[str, Any]]:
    rows = conn.execute("""
        SELECT t.tgname, t.tgtype, t.tgenabled, n.nspname, p.proname,
               pg_get_triggerdef(t.oid, true), l.lanname, p.prosecdef, p.proconfig,
               p.provolatile, p.proisstrict, p.proparallel, format_type(p.prorettype, NULL), p.prosrc
        FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
        JOIN pg_namespace n ON n.oid = p.pronamespace
        JOIN pg_language l ON l.oid = p.prolang
        WHERE t.tgrelid = %s::regclass AND NOT t.tgisinternal ORDER BY t.tgname
    """, (f"public.{table}",)).fetchall()
    fields = ("name", "type", "enabled", "function_schema", "function_name", "definition", "function_language",
              "function_security_definer", "function_settings", "function_volatility", "function_strict",
              "function_parallel", "function_return_type", "function_body")
    result = []
    for row in rows:
        item = dict(zip(fields, row))
        # Inspect can identify drift without printing arbitrary function source.
        item["function_body_sha256"] = hashlib.sha256(" ".join(item.pop("function_body").split()).encode("utf-8")).hexdigest()
        result.append(item)
    return result


def check_relations(table: str, constraints: list[dict[str, Any]], triggers: list[dict[str, Any]]) -> None:
    if constraints != EXPECTED_CONSTRAINTS[table]:
        raise MigrationError(f"Constraint drift in {table}: expected repository primary/unique/foreign keys and checks exactly.")
    expected_name = f"update_{table}_updated_at" if table in ("users", "user_preferences", "devices") else None
    expected_names = ([expected_name] if expected_name else []) + (["clear_device_display_on_transfer"] if table == "devices" else [])
    if sorted(trigger.get("name", "") for trigger in triggers) != sorted(expected_names):
        raise MigrationError(f"Trigger drift in {table}: reconcile missing or extra triggers explicitly.")
    for trigger in triggers:
        if trigger.get("name") == "clear_device_display_on_transfer":
            expected = {
                "type": 17, "enabled": "O", "function_schema": "public", "function_name": "clear_device_display_on_transfer",
                "function_language": "plpgsql", "function_security_definer": True, "function_settings": ["search_path=public"],
                "function_volatility": "v", "function_strict": False, "function_parallel": "u", "function_return_type": "trigger",
                "function_body_sha256": hashlib.sha256(b"BEGIN DELETE FROM public.device_displays WHERE device_id = NEW.id; RETURN NEW; END;").hexdigest(),
            }
            definition = re.sub(r"\bpublic\.", "", trigger.get("definition", ""))
            expected_definition = ("CREATE TRIGGER clear_device_display_on_transfer AFTER UPDATE OF user_id ON devices "
                                   "FOR EACH ROW WHEN (old.user_id IS DISTINCT FROM new.user_id) EXECUTE FUNCTION clear_device_display_on_transfer()")
            if definition != expected_definition or any(trigger.get(key) != value for key, value in expected.items()):
                raise MigrationError("Trigger drift in devices: expected the repository ownership-reset function and condition exactly.")
            continue
        if (trigger.get("name"), trigger.get("type"), trigger.get("enabled"), trigger.get("function_schema"), trigger.get("function_name")) != (
            expected_name, 19, "O", "public", "update_updated_at_column"
        ):
            raise MigrationError(f"Trigger drift in {table}: expected the repository BEFORE UPDATE timestamp trigger only.")
        definition = re.sub(r"\bpublic\.", "", trigger.get("definition", ""))
        if definition != f"CREATE TRIGGER {expected_name} BEFORE UPDATE ON {table} FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()":
            raise MigrationError(f"Trigger definition drift in {table}: unexpected event, condition, arguments or update columns.")
        expected_function = {"function_language": "plpgsql", "function_security_definer": False,
                             "function_settings": None, "function_volatility": "v", "function_strict": False,
                             "function_parallel": "u", "function_return_type": "trigger",
                             "function_body_sha256": hashlib.sha256(b"BEGIN NEW.updated_at = now(); RETURN NEW; END;").hexdigest()}
        if any(trigger.get(key) != value for key, value in expected_function.items()):
            raise MigrationError(f"Trigger function drift in {table}: expected the repository timestamp function exactly.")


def external_incoming_foreign_keys(conn: Any) -> list[dict[str, str]]:
    rows = conn.execute("""
        SELECT ns.nspname, src.relname, con.conname, dst.relname,
               pg_get_constraintdef(con.oid, true)
        FROM pg_constraint con
        JOIN pg_class src ON src.oid = con.conrelid
        JOIN pg_namespace ns ON ns.oid = src.relnamespace
        JOIN pg_class dst ON dst.oid = con.confrelid
        JOIN pg_namespace nd ON nd.oid = dst.relnamespace
        WHERE con.contype = 'f' AND nd.nspname = 'public' AND dst.relname = ANY(%s)
          AND NOT (ns.nspname = 'public' AND src.relname = ANY(%s))
        ORDER BY ns.nspname, src.relname, con.conname
    """, (list(TABLES), list(TABLES))).fetchall()
    return [dict(zip(("schema", "table", "constraint", "referenced_table", "definition"), row)) for row in rows]


def count_rows(conn: Any, table: str) -> int:
    return conn.execute(sql.SQL("SELECT count(*) FROM {}").format(sql.Identifier("public", table))).fetchone()[0]


def copy_out(conn: Any, table: str, stream: Any = None) -> tuple[str, int]:
    # Lexical column order is independent of historical ALTER TABLE ordering.
    names = sql.SQL(", ").join(map(sql.Identifier, sorted(EXPECTED_COLUMNS[table])))
    keys = sql.SQL(", ").join(map(sql.Identifier, PRIMARY_KEYS[table]))
    command = sql.SQL("COPY (SELECT {} FROM {} ORDER BY {}) TO STDOUT WITH (FORMAT CSV, HEADER TRUE, ENCODING 'UTF8')").format(
        names, sql.Identifier("public", table), keys
    )
    digest, size = hashlib.sha256(), 0
    with conn.cursor() as cursor, cursor.copy(command) as copy:
        for chunk in copy:
            digest.update(chunk)
            size += len(chunk)
            if stream is not None:
                stream.write(chunk)
    return digest.hexdigest(), size


def copy_in(conn: Any, table: str, path: Path) -> None:
    names = sql.SQL(", ").join(map(sql.Identifier, sorted(EXPECTED_COLUMNS[table])))
    command = sql.SQL("COPY {} ({}) FROM STDIN WITH (FORMAT CSV, HEADER TRUE, ENCODING 'UTF8')").format(
        sql.Identifier("public", table), names
    )
    with path.open("rb") as stream, conn.cursor() as cursor, cursor.copy(command) as copy:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            copy.write(chunk)


def check_target_identity(conn: Any) -> None:
    if conn.execute("SELECT current_database(), current_user").fetchone() != (TARGET_DATABASE, TARGET_ROLE):
        raise MigrationError(f"Target must be dedicated database {TARGET_DATABASE}, connected as {TARGET_ROLE}.")
    if not conn.execute("SELECT to_regclass('migration_control.target_identity')").fetchone()[0]:
        raise MigrationError("Target identity marker is missing. Use the dedicated stack initialization.")
    rows = conn.execute("SELECT singleton, application, format_version FROM migration_control.target_identity").fetchall()
    if rows != [(True, APPLICATION, FORMAT_VERSION)]:
        raise MigrationError("Target identity marker does not match this application.")
    extras = sorted(set(inventory(conn)) - set(TABLES))
    if extras:
        raise MigrationError("Dedicated target contains unexpected public tables: " + ", ".join(extras))


def check_empty_target(conn: Any) -> None:
    nonempty = [table for table in TABLES if count_rows(conn, table)]
    if nonempty:
        raise MigrationError("Import requires empty target tables; found rows in " + ", ".join(nonempty) + ". No data was deleted.")


def inspect_source(conn: Any) -> dict[str, Any]:
    with conn.transaction():
        prepare_transaction(conn, readonly=True)
        all_tables = inventory(conn)
        missing = sorted(set(TABLES) - set(all_tables))
        if missing:
            raise MigrationError("Source is missing required tables: " + ", ".join(missing))
        lock_tables(conn, writing=False)
        details = {}
        drift = []
        incoming = external_incoming_foreign_keys(conn)
        if incoming:
            drift.append("Excluded tables reference application tables; review dependencies before export.")
        for table in TABLES:
            metadata = read_schema(conn, table)
            constraints, triggers = read_constraints(conn, table), read_triggers(conn, table)
            unique_indexes = read_standalone_unique_indexes(conn, table)
            try:
                check_schema(table, metadata)
                check_relations(table, constraints, triggers)
                check_unique_indexes(table, unique_indexes)
            except MigrationError as error:
                drift.append(str(error))
            details[table] = {"row_count": count_rows(conn, table), "columns": metadata, "constraints": constraints,
                              "triggers": triggers, "standalone_unique_indexes": unique_indexes}
        # Do not print potentially signed or private download URLs.
        storage_references = None
        if any(c["name"] == "download_path" and c["type"] == "text" for c in details["firmware_versions"]["columns"]):
            storage_references = conn.execute("""SELECT count(*) FROM public.firmware_versions
                WHERE download_path ILIKE '%supabase%' OR download_path LIKE '%/storage/v1/%'""").fetchone()[0]
        return {"application": APPLICATION, "tables": details,
                "excluded_public_tables": sorted(set(all_tables) - set(TABLES)), "external_incoming_foreign_keys": incoming,
                "firmware_supabase_url_candidates": storage_references, "schema_drift": drift}


def export_bundle(conn: Any, output: Path) -> dict[str, Any]:
    # Reserve the name exclusively. A manifest is published last; failed exports
    # retain .incomplete and can never be loaded. Never replace an existing bundle.
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    os.chmod(output, 0o700)
    (output / ".incomplete").touch(mode=0o600, exist_ok=False)
    with conn.transaction():
        prepare_transaction(conn, readonly=True)
        all_tables = inventory(conn)
        missing = sorted(set(TABLES) - set(all_tables))
        if missing:
            raise MigrationError("Source is missing required tables: " + ", ".join(missing))
        lock_tables(conn, writing=False)
        if external_incoming_foreign_keys(conn):
            raise MigrationError("Excluded tables reference application tables; review these dependencies explicitly before export.")
        timestamp, version = conn.execute("SELECT transaction_timestamp()::text, current_setting('server_version')").fetchone()
        manifest: dict[str, Any] = {
            "application": APPLICATION, "format_version": FORMAT_VERSION,
            "exported_at_utc": timestamp, "source_postgresql_version": version,
            "excluded_public_tables": sorted(set(all_tables) - set(TABLES)), "tables": {},
        }
        for table in TABLES:
            metadata = read_schema(conn, table)
            check_schema(table, metadata)
            constraints, triggers = read_constraints(conn, table), read_triggers(conn, table)
            check_relations(table, constraints, triggers)
            check_unique_indexes(table, read_standalone_unique_indexes(conn, table))
            path = output / f"{table}.csv"
            with path.open("xb") as stream:
                os.chmod(path, 0o600)
                digest, size = copy_out(conn, table, stream)
                stream.flush()
                os.fsync(stream.fileno())
            manifest["tables"][table] = {
                "file": path.name, "sha256": digest, "bytes": size, "row_count": count_rows(conn, table),
                "columns": metadata, "constraints": constraints, "triggers": triggers,
            }
    encoded = canonical_json(manifest)
    for name, data in (("manifest.json", encoded), ("manifest.sha256", (hashlib.sha256(encoded).hexdigest() + "\n").encode("ascii"))):
        path = output / name
        with path.open("xb") as stream:
            os.chmod(path, 0o600)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
    (output / ".incomplete").unlink()
    return manifest


def load_bundle(bundle: Path) -> dict[str, Any]:
    if not bundle.is_dir() or bundle.is_symlink() or (bundle / ".incomplete").exists():
        raise MigrationError("Bundle is missing, incomplete, or a symbolic link.")
    required = {"manifest.json", "manifest.sha256", *(f"{table}.csv" for table in TABLES)}
    if set(path.name for path in bundle.iterdir()) != required:
        raise MigrationError(f"Bundle must contain exactly the manifest, checksum and {len(TABLES)} CSV files.")
    if any((bundle / name).is_symlink() or not (bundle / name).is_file() for name in required):
        raise MigrationError("Bundle entries must be regular files, not symbolic links.")
    raw = (bundle / "manifest.json").read_bytes()
    expected_hash = (bundle / "manifest.sha256").read_text("ascii").strip()
    if not hmac.compare_digest(hashlib.sha256(raw).hexdigest(), expected_hash):
        raise MigrationError("Manifest checksum mismatch; bundle is corrupt or changed.")
    try:
        manifest = json.loads(raw)
        if manifest["application"] != APPLICATION or manifest["format_version"] != FORMAT_VERSION:
            raise MigrationError("Unsupported bundle application/version.")
        if set(manifest["tables"]) != set(TABLES):
            raise MigrationError("Bundle table allowlist mismatch.")
        for table in TABLES:
            item = manifest["tables"][table]
            if item["file"] != f"{table}.csv":
                raise MigrationError(f"Unexpected filename in {table} metadata.")
            if type(item["row_count"]) is not int or item["row_count"] < 0 or type(item["bytes"]) is not int or item["bytes"] < 0:
                raise MigrationError(f"Invalid row count/file size for {table}.")
            check_schema(table, item["columns"])
            if not isinstance(item["constraints"], list):
                raise MigrationError(f"Invalid constraint metadata for {table}.")
            check_relations(table, item["constraints"], item["triggers"])
            digest, size = sha256_file(bundle / item["file"])
            if not hmac.compare_digest(digest, item["sha256"]) or size != item["bytes"]:
                raise MigrationError(f"Data checksum/size mismatch in {table}; import refused.")
    except (KeyError, TypeError, ValueError) as error:
        raise MigrationError("Malformed bundle manifest.") from error
    return manifest


def compare_target_schema(conn: Any, manifest: dict[str, Any]) -> None:
    if external_incoming_foreign_keys(conn):
        raise MigrationError("Unexpected foreign-key dependencies reference the dedicated target.")
    for table in TABLES:
        check_schema(table, read_schema(conn, table))
        constraints, triggers = read_constraints(conn, table), read_triggers(conn, table)
        check_relations(table, constraints, triggers)
        check_unique_indexes(table, read_standalone_unique_indexes(conn, table))
        if constraints != manifest["tables"][table]["constraints"]:
            raise MigrationError(f"Constraint drift for {table}; reconcile source/target constraints explicitly.")


def verify_rows(conn: Any, manifest: dict[str, Any]) -> dict[str, int]:
    counts = {}
    for table in TABLES:
        expected = manifest["tables"][table]
        counts[table] = count_rows(conn, table)
        if counts[table] != expected["row_count"]:
            raise MigrationError(f"Row-count mismatch for {table}.")
        digest, size = copy_out(conn, table)
        if not hmac.compare_digest(digest, expected["sha256"]) or size != expected["bytes"]:
            raise MigrationError(f"Full-row content checksum mismatch for {table}.")
    return counts


def import_bundle(conn: Any, bundle: Path) -> dict[str, int]:
    manifest = load_bundle(bundle)
    with conn.transaction():
        prepare_transaction(conn, readonly=False)
        check_target_identity(conn)
        lock_tables(conn, writing=True)
        compare_target_schema(conn, manifest)
        check_empty_target(conn)
        for table in TABLES:
            copy_in(conn, table, bundle / manifest["tables"][table]["file"])
        # Trigger/FK errors and even a checksum mismatch roll back every table.
        # No TRUNCATE, trigger disabling, DELETE, or schema mutation is performed.
        counts = verify_rows(conn, manifest)
    return counts


def verify_bundle(conn: Any, bundle: Path) -> dict[str, int]:
    manifest = load_bundle(bundle)
    with conn.transaction():
        prepare_transaction(conn, readonly=True)
        check_target_identity(conn)
        lock_tables(conn, writing=False)
        compare_target_schema(conn, manifest)
        return verify_rows(conn, manifest)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for name in ("inspect", "export", "import", "verify"):
        command = subparsers.add_parser(name)
        command.add_argument("--service", required=True, help="libpq service name in PGSERVICEFILE; no connection URLs")
        if name == "export":
            command.add_argument("--output", required=True, type=Path, help="New private directory; its parent must already exist")
        if name in ("import", "verify"):
            command.add_argument("--bundle", required=True, type=Path)
    args = parser.parse_args(argv)
    if not re.fullmatch(r"[A-Za-z0-9_-]+", args.service):
        parser.error("--service must be a simple service name, not a connection string")
    try:
        # Validate local input before even connecting to a target.
        if args.command in ("import", "verify"):
            load_bundle(args.bundle)
        options: dict[str, Any] = {"service": args.service, "connect_timeout": 15, "application_name": "esp32-eink-migration"}
        if args.command in ("inspect", "export"):
            options["sslmode"] = "verify-full"
        with psycopg.connect(**options) as conn:
            if args.command == "inspect":
                result = inspect_source(conn)
                print(json.dumps(result, indent=2))
                return 2 if result["schema_drift"] else 0
            if args.command == "export":
                result = export_bundle(conn, args.output)
                print(json.dumps({"status": "exported", "rows": {t: result["tables"][t]["row_count"] for t in TABLES},
                                  "excluded_public_tables": result["excluded_public_tables"]}, indent=2))
            else:
                result = import_bundle(conn, args.bundle) if args.command == "import" else verify_bundle(conn, args.bundle)
                print(json.dumps({"status": "imported" if args.command == "import" else "verified", "rows": result}, indent=2))
        return 0
    except MigrationError as error:
        print(f"Migration refused: {error}", file=sys.stderr)
    except psycopg.Error as error:
        # PostgreSQL errors often include a failing row or credentials/host data.
        # Expose only error type and SQLSTATE; inspect server logs privately.
        print(f"Database operation failed ({type(error).__name__}, SQLSTATE {error.sqlstate or 'unavailable'}). "
              "Import transactions roll back; failed exports remain marked incomplete. Check private server logs/configuration.", file=sys.stderr)
    except (OSError, UnicodeError):
        print("Local file operation failed. Check paths, permissions, disk space and that the output does not already exist.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
