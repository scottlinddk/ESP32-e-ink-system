#!/usr/bin/env bash
# Fresh-start setup of the e-ink database on the Raspberry Pi (no source database).
# Thin, phased wrapper over the tracked tooling. Run on the Pi from the checkout.
#
#   sudo bash setup-fresh.sh preflight --ssd-uuid UUID --storage-mount MOUNT
#   sudo bash setup-fresh.sh init      --ssd-uuid UUID --storage-mount MOUNT
#   sudo bash setup-fresh.sh start     --ssd-uuid UUID
#   sudo bash setup-fresh.sh verify
#   sudo bash setup-fresh.sh timers
#
# Each phase is idempotent where the underlying tool is. It never prints secrets,
# never touches Investor, and never overwrites existing credentials.
set -euo pipefail
umask 077

APP=/opt/esp32-eink
INFRA=$APP/infra/raspberry-pi
ETC=/etc/esp32-eink
SRV=/srv/esp32-eink
ENV_FILE=$ETC/.env

die() { printf 'setup-fresh: %s\n' "$*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die 'Run as root (sudo).'
[[ $(uname -m) == aarch64 ]] || die 'This package requires ARM64 Linux.'
[[ -d $INFRA ]] || die "Expected the checkout at $APP (need $INFRA)."
for tool in docker python3 curl; do command -v "$tool" >/dev/null || die "Missing $tool"; done

phase=${1:-}; shift || true
uuid=''; mount=''
while [[ $# -gt 0 ]]; do
  case $1 in
    --ssd-uuid) uuid=${2:-}; shift 2 ;;
    --storage-mount) mount=${2:-}; shift 2 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

eink() {
  docker compose --project-name esp32-eink --env-file "$ENV_FILE" -f "$INFRA/compose.yaml" "$@"
}

set_env() { # set_env KEY VALUE: replace the single KEY= line in .env
  local key=$1 value=$2
  grep -q "^${key}=" "$ENV_FILE" || die "$key not found in $ENV_FILE"
  python3 - "$ENV_FILE" "$key" "$value" <<'PY'
import sys, pathlib
path, key, value = sys.argv[1:]
p = pathlib.Path(path)
lines = [f"{key}={value}" if l.startswith(f"{key}=") else l for l in p.read_text().splitlines()]
p.write_text("\n".join(lines) + "\n")
PY
}

case $phase in
  preflight)
    [[ -n $uuid && -n $mount ]] || die 'preflight needs --ssd-uuid and --storage-mount'
    printf 'Memory cgroup: '; grep -w memory /proc/cgroups || true
    [[ $(docker info --format '{{.MemoryLimit}}') == true ]] \
      || die 'Docker has no memory limit support. Enable cgroup_enable=memory (see the runbook), reboot, retry.'
    bash "$INFRA/preflight.sh" --ssd-uuid "$uuid" --storage-mount "$mount"
    ;;

  init)
    [[ -n $uuid && -n $mount ]] || die 'init needs --ssd-uuid and --storage-mount'
    install -d -m 0700 "$ETC" "$ETC/pgconfig"
    install -d -m 0700 "$SRV" "$SRV/postgres" "$SRV/migration" "$SRV/backups"
    if [[ -e $ENV_FILE ]]; then
      echo "$ENV_FILE exists; keeping existing credentials."
    else
      python3 "$INFRA/generate-secrets.py" --output-dir "$ETC"
    fi
    set_env STORAGE_UUID "$uuid"
    set_env STORAGE_MOUNT "$mount"
    chmod 0600 "$ENV_FILE"
    eink config --quiet
    echo 'Config valid. Back up /etc/esp32-eink/.env and backend.env (and your ENCRYPTION_KEY) now.'
    echo 'Edit backend.env: replace the hostname placeholder with https://eink-db.scottlind.dk'
    ;;

  start)
    [[ -n $uuid ]] || die 'start needs --ssd-uuid'
    eink config --quiet
    eink pull postgres postgrest gateway
    bash "$INFRA/start-postgres.sh" "$ENV_FILE" --ssd-uuid "$uuid"
    eink ps
    echo 'Tables (expect nine):'
    eink exec -T postgres psql -U eink_admin -d eink -c '\dt'
    eink up -d postgrest gateway
    curl --fail --show-error --max-time 10 http://127.0.0.1:3080/healthz || die 'Gateway is not healthy.'
    echo ' gateway healthy'
    ;;

  verify)
    eink ps
    curl --fail --show-error --max-time 10 http://127.0.0.1:3080/healthz || die 'Gateway is not healthy.'
    echo ' gateway healthy'
    python3 "$INFRA/memory_budget.py" || die 'Memory admission failed; see the message above.'
    cat <<'MSG'

Local checks done. Remaining manual steps:
  1. HTTPS: Cloudflare Tunnel to eink-db.scottlind.dk (runbook section 5).
  2. From a workstation (SSH tunnel or HTTPS origin):
       EINK_SMOKE_URL=... EINK_SMOKE_SERVICE_KEY=<private JWT> \
         node infra/raspberry-pi/smoke.mjs --write-test
  3. Rehearse backup and isolated recovery: bash backup.sh, then restore.sh.
  4. Cut over: set backend SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on Vercel, redeploy.
MSG
    ;;

  timers)
    eink ps --status running --services | grep -qx postgres \
      || die 'The e-ink PostgreSQL container is not running; run the start phase first.'
    install -m 0644 "$INFRA"/systemd/esp32-eink-backup.service "$INFRA"/systemd/esp32-eink-backup.timer /etc/systemd/system/
    systemctl daemon-reload
    systemctl enable --now esp32-eink-backup.timer
    systemctl list-timers esp32-eink-backup.timer --no-pager
    ;;

  *) die 'Usage: setup-fresh.sh {preflight|init|start|verify|timers} [--ssd-uuid UUID] [--storage-mount MOUNT]' ;;
esac
