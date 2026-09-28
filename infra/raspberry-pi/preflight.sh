#!/usr/bin/env bash
# Read-only Pi checks. Does not install, restart, mount, or change any workload.
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
die() { printf 'Preflight failed: %s\n' "$*" >&2; exit 1; }
usage() { printf 'Usage: bash preflight.sh --ssd-uuid VERIFIED_SSD_UUID --storage-mount VERIFIED_MOUNT\n'; }
[[ $# == 4 && $1 == --ssd-uuid && -n $2 && $3 == --storage-mount && -n $4 ]] || { usage >&2; exit 2; }
expected_uuid=$2
storage_mount=$4
[[ $(uname -s) == Linux && $(uname -m) == aarch64 && $(getconf LONG_BIT) == 64 ]] ||
  die 'This deployment requires 64-bit ARM Linux on the Pi.'
for tool in python3 docker findmnt ss awk df systemctl systemd-escape; do
  command -v "$tool" >/dev/null || die "Missing prerequisite: $tool (inspect before installing anything)."
done
python3 "$script_dir/storage_guard.py" --preflight --ssd-uuid "$expected_uuid" --storage-mount "$storage_mount"
docker compose version
docker info >/dev/null
[[ $(docker info --format '{{.OSType}}') == linux ]] || die 'Docker must run Linux containers.'
[[ -z $(ss -H -ltn 'sport = :3080') ]] || die 'Host port 3080 is already listening. Inspect the owner before changing configuration.'
available_kib=$(awk '/^MemAvailable:/ { print $2 }' /proc/meminfo)
[[ "$available_kib" =~ ^[0-9]+$ && "$available_kib" -ge 3735552 ]] ||
  die 'Less than 3.56 GiB available RAM: reserve 2 GiB OS headroom plus 832 MiB stack, 256 MiB tunnel and 512 MiB migration tool.'
docker_root=$(docker info --format '{{.DockerRootDir}}')
[[ "$docker_root" == /* && -d "$docker_root" ]] || die 'Cannot verify local Docker image storage.'
for directory in "$storage_mount" "$docker_root"; do
  free_kib=$(df -Pk "$directory" | awk 'NR == 2 { print $4 }')
  [[ "$free_kib" =~ ^[0-9]+$ && "$free_kib" -ge 10485760 ]] ||
    die 'Less than 10 GiB free on data or Docker image storage. Review data, image and backup sizing.'
  used_percent=$(df -Pk "$directory" | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')
  [[ "$used_percent" =~ ^[0-9]+$ && "$used_percent" -le 80 ]] ||
    die 'Less than 20 percent capacity free on data or Docker image storage. Preserve shared-host headroom.'
done
printf '\nVerified storage mount and free space:\n'
findmnt --target "$storage_mount" -o TARGET,SOURCE,FSTYPE,UUID,FSROOT,OPTIONS
df -h "$storage_mount" "$docker_root"
printf '\nAvailable memory: %s KiB\n' "$available_kib"
printf '\nExisting containers (no configuration or secret output):\n'
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}'
printf '\nPreflight passed. No files, mounts, services, or Investor resources were changed.\n'
printf 'Also measure Investor under peak load and budget backup/export space before cutover.\n'
