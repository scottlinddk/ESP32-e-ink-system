#!/usr/bin/env python3
"""Read-only admission check for a 4 GB Pi shared with Investor.

Limits are ceilings, not reservations. Check both total planned ceilings and the
room remaining for running containers to grow. This is an admission snapshot,
not a guarantee against later host processes or concurrent maintenance jobs.
"""
from decimal import Decimal
import json
import os
from pathlib import Path
import re
import subprocess
import sys

MIB = 1024 * 1024
INVESTOR = {"postgres": 1024 * MIB, "api": 512 * MIB, "worker": 320 * MIB}
EINK = {"postgres": 384 * MIB, "postgrest": 128 * MIB, "gateway": 32 * MIB}
TUNNEL = 256 * MIB
MAINTENANCE = 512 * MIB
HOST_FLOOR = 512 * MIB
LIVE_HEADROOM = 256 * MIB
MAX_CONTAINERS = 128
MAX_OUTPUT = 128 * 1024
MAINTENANCE_UNITS = ("investor-update.service", "investor-auto-update.service",
                     "investor-update-request.service", "investor-backup.service",
                     "esp32-eink-backup.service")
INSPECT_FORMAT = ('{"id":{{json .Id}},"limit":{{json .HostConfig.Memory}},'
                  '"project":{{json (index .Config.Labels "com.docker.compose.project")}},'
                  '"service":{{json (index .Config.Labels "com.docker.compose.service")}},'
                  '"oneoff":{{json (index .Config.Labels "com.docker.compose.oneoff")}},'
                  '"running":{{json .State.Running}}}')
STATS_FORMAT = '{"id":{{json .ID}},"memory":{{json .MemUsage}}}'


def read(command):
    result = subprocess.run(command, capture_output=True, text=True, check=True, timeout=30)
    if len(result.stdout) > MAX_OUTPUT:
        raise ValueError("Unexpectedly large host inventory; inspect the host before continuing.")
    return result.stdout.strip()


def meminfo(text):
    values = {}
    for line in text.splitlines():
        if line.startswith(("MemTotal:", "MemAvailable:")):
            match = re.fullmatch(r"(MemTotal|MemAvailable):\s+(\d+)\s+kB", line)
            if not match or match[1] in values:
                raise ValueError("Invalid physical-memory information.")
            values[match[1]] = int(match[2]) * 1024
    total, available = values.get("MemTotal", 0), values.get("MemAvailable", -1)
    if total <= 0 or available < 0 or available > total:
        raise ValueError("Cannot verify MemTotal and MemAvailable; swap is not counted as RAM.")
    return total, available


def working_set_lower_bound(value):
    """Docker CLI excludes inactive file cache. Round its displayed usage down.

    Taking off one displayed precision unit avoids crediting rounded-up usage as
    allocated memory. The result deliberately overestimates future growth.
    """
    if not isinstance(value, str) or len(value) > 100:
        raise ValueError("Invalid Docker working-set reading.")
    parts = value.split(" / ")
    if len(parts) != 2:
        raise ValueError("Invalid Docker working-set reading.")
    readings = []
    for part in parts:
        match = re.fullmatch(r"(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB|TiB)", part)
        if not match:
            raise ValueError("Unrecognized Docker memory units; cannot budget safely.")
        factor = 1024 ** ("B", "KiB", "MiB", "GiB", "TiB").index(match[2])
        number = Decimal(match[1])
        precision = Decimal(10) ** number.as_tuple().exponent
        readings.append(max(0, int((number - precision) * factor)))
    return readings[0]


def decode_lines(text):
    try:
        records = [json.loads(line) for line in text.splitlines() if line]
    except (json.JSONDecodeError, TypeError) as error:
        raise ValueError("Cannot parse the bounded Docker memory inventory.") from error
    if len(records) > MAX_CONTAINERS or any(not isinstance(item, dict) for item in records):
        raise ValueError("Unexpected Docker memory inventory.")
    return records


def container_ids():
    identifiers = read(["docker", "ps", "--quiet", "--no-trunc"]).splitlines()
    if (len(identifiers) > MAX_CONTAINERS or len(set(identifiers)) != len(identifiers)
            or any(not re.fullmatch(r"[a-f0-9]{64}", item) for item in identifiers)):
        raise ValueError("Unexpected running-container list.")
    return identifiers


def local_inventory():
    if sys.platform != "linux":
        raise ValueError("Run memory admission checks on the Linux Pi.")
    if os.environ.get("DOCKER_HOST") and not os.environ["DOCKER_HOST"].startswith("unix://"):
        raise ValueError("Memory admission requires the local Docker daemon.")
    if not read(["docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"]).startswith("unix://"):
        raise ValueError("Memory admission requires a local Docker context.")
    memory_limits_supported = read(["docker", "info", "--format", "{{.MemoryLimit}}"])
    if memory_limits_supported != "true":
        raise ValueError("Docker cannot enforce memory ceilings on this host.")
    # These host jobs can consume memory without showing up as a Docker one-off.
    states = read(["systemctl", "show", *MAINTENANCE_UNITS, "--property=ActiveState", "--value"]).split()
    if len(states) != len(MAINTENANCE_UNITS) or any(state not in ("inactive", "failed") for state in states):
        raise ValueError("Wait for Investor/e-ink maintenance to finish, then rerun preflight.")
    identifiers = container_ids()
    if not identifiers:
        if container_ids():
            raise ValueError("Containers changed during the snapshot; rerun preflight when the host is stable.")
        return [], {}
    containers = decode_lines(read(["docker", "inspect", "--format", INSPECT_FORMAT, *identifiers]))
    stats = decode_lines(read(["docker", "stats", "--no-stream", "--no-trunc", "--format", STATS_FORMAT,
                              *identifiers]))
    if (set(container_ids()) != set(identifiers)
            or len(containers) != len(identifiers) or len(stats) != len(identifiers)
            or {item.get("id") for item in containers} != set(identifiers)
            or {item.get("id") for item in stats} != set(identifiers)):
        raise ValueError("Containers changed during the snapshot; rerun preflight when the host is stable.")
    return containers, {item["id"]: working_set_lower_bound(item.get("memory")) for item in stats}


def budget(total, available, containers, working_sets):
    # Reserve known Investor services even if an updater/restart has stopped them.
    planned = {("investor", key): value for key, value in INVESTOR.items()}
    planned.update({("esp32-eink", key): value for key, value in EINK.items()})
    missing = dict(planned)
    seen_ids, seen_services = set(), set()
    running_caps = running_growth = 0
    for item in containers:
        identifier = item.get("id")
        limit = item.get("limit")
        if not isinstance(identifier, str) or identifier in seen_ids or item.get("running") is not True:
            raise ValueError("Invalid or changed running-container inventory; rerun preflight.")
        seen_ids.add(identifier)
        if not isinstance(limit, int) or isinstance(limit, bool) or limit <= 0:
            raise ValueError(f"Container {identifier[:12]} has no verified memory ceiling; inspect its limits first.")
        project, service = item.get("project"), item.get("service")
        if any(value is not None and not isinstance(value, str) for value in (project, service)):
            raise ValueError("Invalid container service labels.")
        if ((str(item.get("oneoff") or "").lower() == "true")
                or service in ("migrate", "tools") or project == "esp32-eink-recovery"):
            raise ValueError("A migration/recovery/one-off container is running; finish maintenance before admission.")
        key = (project, service)
        if key in planned:
            if key in seen_services:
                raise ValueError("Duplicate managed service instances; inspect deployment before admission.")
            seen_services.add(key)
            limit = max(limit, planned[key])
            missing.pop(key)
        used = working_sets.get(identifier)
        if not isinstance(used, int) or isinstance(used, bool) or used < 0 or used > limit:
            raise ValueError("Missing or inconsistent container working-set reading; rerun preflight.")
        running_caps += limit
        running_growth += limit - used
    if set(working_sets) != seen_ids:
        raise ValueError("Memory statistics do not match the running containers; rerun preflight.")
    missing_caps = sum(missing.values())
    # The tunnel runs under systemd. Reserving all of it is conservative if it is
    # already running; do not credit host processes from Docker's memory reading.
    total_required = running_caps + missing_caps + TUNNEL + MAINTENANCE + HOST_FLOOR
    available_required = running_growth + missing_caps + TUNNEL + MAINTENANCE + LIVE_HEADROOM
    return {"total": total, "available": available, "running_caps": running_caps,
            "missing_caps": missing_caps, "running_growth": running_growth,
            "total_required": total_required, "available_required": available_required,
            "passes": total >= total_required and available >= available_required}


def mib(value):
    return f"{value / MIB:.1f} MiB"


def main():
    try:
        containers, working_sets = local_inventory()
        total, available = meminfo(Path("/proc/meminfo").read_text("ascii"))
        result = budget(total, available, containers, working_sets)
        print(f"Physical RAM: {mib(total)} total; {mib(available)} available (swap excluded).")
        print(f"Running Docker ceilings: {mib(result['running_caps'])}; missing planned services: {mib(result['missing_caps'])}.")
        print(f"Total admission: {mib(result['total_required'])}, including 256 MiB tunnel, 512 MiB maintenance and 512 MiB host floor.")
        print(f"Available admission: {mib(result['available_required'])}, including container growth and 256 MiB live headroom.")
        if not result["passes"]:
            raise ValueError("Insufficient physical-memory headroom for coexistence. Inspect current workloads; do not reduce Investor limits automatically.")
        print("Memory admission passed. Keep maintenance jobs sequential; rerun before starting heavy jobs.")
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        # Subprocess errors can contain captured output; only our own messages
        # are printed. Inspect commands never read environment or secret fields.
        detail = str(error) if isinstance(error, ValueError) else "Cannot read a complete local memory inventory."
        print(f"Memory preflight failed: {detail}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
