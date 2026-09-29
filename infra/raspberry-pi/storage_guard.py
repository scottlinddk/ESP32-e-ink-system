#!/usr/bin/env python3
"""Read-only checks for isolated e-ink storage on the shared Pi."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

APP_ROOT = "/srv/esp32-eink"
PRIVATE_ROOTS = ("/srv/investor", "/etc/investor")


def fail(message):
    raise ValueError(message)


def read(command):
    return subprocess.run(command, check=True, text=True, capture_output=True, timeout=30).stdout.strip()


def overlaps(left, right):
    return left == right or left.is_relative_to(right) or right.is_relative_to(left)


def canonical(path, *, directory=True, existing=True):
    path = Path(path)
    if not path.is_absolute() or path.resolve(strict=existing) != path:
        fail("Storage paths must be absolute and have no symlink components.")
    if existing and ((directory and not path.is_dir()) or (not directory and not path.is_file())):
        fail("The required storage path does not exist with the expected type.")
    return path


def filesystem(path):
    result = json.loads(read(["findmnt", "--json", "--target", str(path), "--output", "TARGET,UUID,FSTYPE,FSROOT"]))
    records = result.get("filesystems", [])
    if len(records) != 1:
        fail("Unable to identify exactly one backing filesystem.")
    record = records[0]
    target, fsroot = Path(record["target"]), Path(record["fsroot"])
    if not target.is_absolute() or not fsroot.is_absolute() or not path.is_relative_to(target):
        fail("Unexpected filesystem mount identity.")
    return record, fsroot / path.relative_to(target)


def local_docker():
    if sys.platform != "linux":
        fail("Run storage checks on the Linux Pi.")
    if os.environ.get("DOCKER_HOST") and not os.environ["DOCKER_HOST"].startswith("unix://"):
        fail("Refusing a remote Docker daemon.")
    if not read(["docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"]).startswith("unix://"):
        fail("Refusing a remote Docker context.")


def private_backing_storage():
    private = []
    for private_name in PRIVATE_ROOTS:
        private_path = Path(private_name)
        if private_path.exists():
            record, backing = filesystem(private_path.resolve(strict=True))
            private.append((record.get("uuid"), backing))
    return private


def verify_storage(mount, uuid, paths=(), *, preflight=False):
    if not isinstance(uuid, str) or not uuid.strip():
        fail("Set the independently verified STORAGE_UUID before proceeding.")
    mount = canonical(mount)
    if not mount.is_mount():
        fail("STORAGE_MOUNT must be an existing mountpoint, including / for a verified root SSD.")
    record, _ = filesystem(mount)
    if record["target"] != str(mount) or record.get("uuid") != uuid or record.get("fstype") != "ext4":
        fail("Storage mount must match the independently verified ext4 UUID.")
    base = Path(APP_ROOT)
    if not base.is_relative_to(mount):
        fail("STORAGE_MOUNT must contain /srv/esp32-eink.")
    if str(mount) != "/":
        unit = read(["systemd-escape", "--path", "--suffix=mount", str(mount)])
        bindings = read(["systemctl", "show", "docker.service", "--property=BindsTo", "--value"]).split()
        if unit not in bindings or read(["systemctl", "is-active", unit]) != "active":
            fail("Non-root storage requires its existing active mount in Docker BindsTo; review host setup without restarting Docker.")
    private = private_backing_storage()
    candidates = [canonical(base, existing=not preflight), *paths]
    for candidate in candidates:
        anchor = candidate
        while not anchor.exists():
            anchor = anchor.parent
        current, backing = filesystem(anchor)
        backing = backing / candidate.relative_to(anchor)
        if current.get("uuid") != uuid or current.get("fstype") != "ext4" or current["target"] != str(mount):
            fail("Application storage must stay on the configured mount and UUID; nested/aliased mounts need review.")
        if any(current.get("uuid") == identity and overlaps(backing, root) for identity, root in private):
            fail("E-ink storage overlaps Investor's private backing storage, including a bind-mount alias.")


def compose_config(env_file, recovery=False):
    project = "esp32-eink-recovery" if recovery else "esp32-eink"
    compose = ["docker", "compose", "--project-name", project, "--env-file", str(Path(env_file).resolve(strict=True)),
               "-f", str(Path(__file__).resolve().parent / "compose.yaml")]
    # The opt-in tools service is hidden without its profile, but its bind mounts
    # are validated below. Enable the profile for this read-only render only, so
    # the returned command never starts it.
    config = json.loads(read(compose + ["--profile", "tools", "config", "--format", "json"]))
    return project, compose, config


def validate_config(env_file, *, recovery=False, uuid=None, extra_path=None, running=False):
    local_docker()
    project, compose, config = compose_config(env_file, recovery)
    storage = config["x-eink-storage"]
    if uuid is not None and uuid != storage["uuid"]:
        fail("Supplied --ssd-uuid differs from persisted STORAGE_UUID.")
    mounts = [item for item in config["services"]["postgres"]["volumes"] if item["target"] == "/var/lib/postgresql/data"]
    if len(mounts) != 1 or mounts[0]["type"] != "bind":
        fail("Expected exactly one explicit PostgreSQL data bind mount.")
    data = canonical(mounts[0]["source"])
    base = Path(APP_ROOT)
    if not data.is_relative_to(base) or data == base:
        fail("DATA_DIR must be a child of /srv/esp32-eink; Investor paths are forbidden.")
    relative = data.relative_to(base).parts
    if recovery and (relative[0] != "recovery" or len(relative) < 2):
        fail("Recovery DATA_DIR must be a child of /srv/esp32-eink/recovery/.")
    if not recovery and relative[0] == "recovery":
        fail("Production DATA_DIR must not be inside the recovery directory.")
    paths = [data]
    tool_mounts = config["services"]["tools"]["volumes"]
    for target in ("/work", "/run/pgconfig"):
        selected = [item for item in tool_mounts if item["target"] == target]
        if len(selected) != 1 or selected[0]["type"] != "bind":
            fail("Expected one explicit migration work/config bind mount.")
        path = canonical(selected[0]["source"])
        if target == "/work":
            if not path.is_relative_to(base) or path == base or overlaps(path, data):
                fail("MIGRATION_WORK_DIR must be an isolated child of /srv/esp32-eink outside database storage.")
            paths.append(path)
        else:
            if not path.is_relative_to(Path("/etc/esp32-eink")) or path == Path("/etc/esp32-eink"):
                fail("PG_CONFIG_DIR must be a private child of /etc/esp32-eink.")
            record, backing = filesystem(path)
            if any(record.get("uuid") == identity and overlaps(backing, root)
                   for identity, root in private_backing_storage()):
                fail("PG_CONFIG_DIR overlaps Investor's private backing storage.")
    if extra_path:
        extra = canonical(extra_path, directory=Path(extra_path).is_dir())
        if not extra.is_relative_to(base) or extra == base or overlaps(extra, data):
            fail("Backup/archive paths must be isolated children of /srv/esp32-eink outside database storage.")
        paths.append(extra)
    verify_storage(storage["mount"], storage["uuid"], paths)
    ids = read(["docker", "ps", "-aq"]).split()
    containers = json.loads(read(["docker", "inspect", *ids])) if ids else []
    matching = []
    for container in containers:
        labels = container["Config"].get("Labels") or {}
        own = labels.get("com.docker.compose.project") == project and labels.get("com.docker.compose.service") == "postgres"
        if own:
            matching.append(container)
        for item in container["Mounts"]:
            if not item.get("Source"):
                continue
            source = Path(item["Source"]).resolve()
            if overlaps(data, source) and not own:
                fail("DATA_DIR overlaps a mount attached to another container/project, including stopped containers.")
    if running:
        if len(matching) != 1 or not matching[0]["State"]["Running"]:
            fail("Start exactly one PostgreSQL container in the selected e-ink project first.")
        actual = [item for item in matching[0]["Mounts"] if item.get("Destination") == "/var/lib/postgresql/data"]
        if len(actual) != 1 or actual[0].get("Source") != str(data):
            fail("Running container storage differs from the verified configured data path.")
    return compose, data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file")
    parser.add_argument("--ssd-uuid")
    parser.add_argument("--storage-mount")
    parser.add_argument("--preflight", action="store_true")
    parser.add_argument("--recovery", action="store_true")
    parser.add_argument("--check-running", action="store_true")
    parser.add_argument("--extra-path")
    parser.add_argument("--print-data", action="store_true")
    parser.add_argument("--start", action="store_true")
    args = parser.parse_args()
    try:
        if args.preflight:
            if not args.ssd_uuid or not args.storage_mount:
                fail("Preflight requires explicit --ssd-uuid and --storage-mount.")
            local_docker()
            verify_storage(args.storage_mount, args.ssd_uuid, preflight=True)
            return 0
        if not args.env_file:
            fail("An explicit e-ink environment file is required.")
        compose, data = validate_config(args.env_file, recovery=args.recovery, uuid=args.ssd_uuid,
                                       extra_path=args.extra_path, running=args.check_running)
        if args.print_data:
            print(data)
        if args.start:
            print("Validated isolated storage; starting only the selected e-ink PostgreSQL container.", flush=True)
            subprocess.run(compose + ["up", "-d", "--no-deps", "--force-recreate", "--wait", "--wait-timeout", "120", "postgres"],
                           check=True, timeout=180)
        return 0
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError) as error:
        detail = str(error) if isinstance(error, ValueError) and not isinstance(error, json.JSONDecodeError) else "Prerequisite/configuration check failed; inspect the selected stack privately."
        print("Storage check refused: " + detail, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
