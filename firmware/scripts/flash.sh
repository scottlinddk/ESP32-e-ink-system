#!/usr/bin/env bash
# PlatformIO handles OS-specific port discovery; use --port when more than one is connected.
set -euo pipefail

FIRMWARE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIO_ENV="esp32dev"
COMMAND="upload"
PORT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    build|upload|monitor|flash|clean|help) COMMAND="$1"; shift ;;
    --elecrow) PIO_ENV="elecrow_213"; shift ;;
    --elecrow-v12) PIO_ENV="elecrow_213_v12"; shift ;;
    --rlcd) PIO_ENV="waveshare_rlcd_42"; shift ;;
    --port)
      [[ $# -gt 1 && -n "$2" ]] || { echo "--port requires a serial port" >&2; exit 2; }
      PORT="$2"; shift 2 ;;
    -h|--help) COMMAND="help"; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ "$COMMAND" == "help" ]]; then
  cat <<'HELP'
Usage: flash.sh [build|upload|monitor|flash|clean] [--elecrow|--elecrow-v12|--rlcd] [--port PORT]

Boards: default = Waveshare HAT / ESP32; --elecrow = original CrowPanel SSD1680;
        --elecrow-v12 = CrowPanel V1.2 JD79661; --rlcd = Waveshare ESP32-S3-RLCD-4.2.

PlatformIO selects the port automatically unless --port is given (for example COM4).
No config file is required for a stock build. Optional hardware/API defaults go in
firmware/config.h; Wi-Fi and device token are entered in the first-boot hotspot.
Install PlatformIO: python -m pip install platformio==6.1.18
Browser installation and recovery: docs/FIRMWARE_FLASHING.md
HELP
  exit 0
fi

command -v pio >/dev/null || { echo "PlatformIO not found. Run: python -m pip install platformio==6.1.18" >&2; exit 1; }
cd "$FIRMWARE_DIR"
UPLOAD_ARGS=()
MONITOR_ARGS=()
if [[ -n "$PORT" ]]; then
  UPLOAD_ARGS+=(--upload-port "$PORT")
  MONITOR_ARGS+=(--port "$PORT")
fi

case "$COMMAND" in
  build) pio run -e "$PIO_ENV" ;;
  upload) pio run -e "$PIO_ENV" --target upload "${UPLOAD_ARGS[@]}" ;;
  monitor) pio device monitor -e "$PIO_ENV" --baud 115200 "${MONITOR_ARGS[@]}" ;;
  flash)
    pio run -e "$PIO_ENV" --target upload "${UPLOAD_ARGS[@]}"
    pio device monitor -e "$PIO_ENV" --baud 115200 "${MONITOR_ARGS[@]}"
    ;;
  clean) pio run -e "$PIO_ENV" --target clean ;;
esac
