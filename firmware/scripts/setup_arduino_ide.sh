#!/usr/bin/env bash
# Kept for existing npm arduino:setup shortcuts; no unverified IDE/library mutations.
set -euo pipefail
FIRMWARE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIO_ENV="esp32dev"
for argument in "$@"; do
  case "$argument" in
    --elecrow) PIO_ENV="elecrow_213" ;;
    --elecrow-v12) PIO_ENV="elecrow_213_v12" ;;
    -h|--help) ;;
    *) echo "Unknown argument: $argument" >&2; exit 2 ;;
  esac
done
cat <<HELP
The supported setup is the web app's Flash page, or this pinned source build:

  python -m pip install platformio==6.1.18
  cd "$FIRMWARE_DIR"
  pio run -e $PIO_ENV --target upload
  pio device monitor -e $PIO_ENV --baud 115200

The Elecrow driver is already included. Wi-Fi and device tokens are configured
through the first-boot hotspot, not compiled into firmware. For CrowPanel V1.2,
use --elecrow-v12 so the JD79661 controller driver is selected.

Arduino IDE expert notes: $FIRMWARE_DIR/../docs/ARDUINO_IDE_ELECROW_SETUP.md
No Arduino libraries or settings were changed. The old automatic helper could
not reproduce the project's board flags or sketch layout reliably.
HELP
