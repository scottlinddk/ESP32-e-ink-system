#!/bin/bash

# ============================================================================
# ESP32 Firmware Flashing Script
# ============================================================================
# Automatically detects ESP32 serial port and flashes firmware
# Usage: ./firmware/scripts/flash.sh [build|monitor|clean]
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Board target: pass --elecrow for Elecrow CrowPanel ESP32 2.13"
# Default: Waveshare 2.13" HAT on ESP32-WROOM-32
PIO_ENV="esp32dev"
if [[ "$*" == *"--elecrow"* ]]; then
  PIO_ENV="elecrow_213"
  print_info() { echo -e "${BLUE}ℹ${NC} [Elecrow] $1"; } 2>/dev/null || true
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'  # No Color

# ============================================================================
# Helper Functions
# ============================================================================

print_header() {
  echo -e "${BLUE}════════════════════════════════════════${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}════════════════════════════════════════${NC}"
}

print_success() {
  echo -e "${GREEN}✓${NC} $1"
}

print_error() {
  echo -e "${RED}✗${NC} $1"
}

print_warning() {
  echo -e "${YELLOW}⚠${NC} $1"
}

print_info() {
  echo -e "${BLUE}ℹ${NC} $1"
}

# ============================================================================
# Check Dependencies
# ============================================================================

check_pio() {
  if ! command -v pio &> /dev/null; then
    print_error "PlatformIO CLI not found"
    echo "  Install: pip install platformio"
    echo "  Or use VS Code PlatformIO extension"
    exit 1
  fi
  print_success "PlatformIO CLI found"
}

check_config() {
  if [ ! -f "$SCRIPT_DIR/config.h" ]; then
    print_warning "config.h not found"
    echo "  Creating config.h from template..."
    cp "$SCRIPT_DIR/config.h.example" "$SCRIPT_DIR/config.h"
    print_warning "⚠️  Edit config.h with your WiFi and API credentials:"
    echo "    ${BLUE}${SCRIPT_DIR}/config.h${NC}"
    echo ""
    print_info "Required settings:"
    echo "    • WIFI_SSID"
    echo "    • WIFI_PASSWORD"
    echo "    • API_BASE_URL"
    echo "    • USER_ID"
    echo "    • LICENSE_KEY"
    exit 1
  fi
  print_success "config.h found"
}

detect_port() {
  local port=""

  # macOS
  if [[ "$OSTYPE" == "darwin"* ]]; then
    # ESP32-S3 (Elecrow) shows as usbmodem; ESP32 (Waveshare) as wchusbserial/usbserial
    port=$(ls /dev/cu.* 2>/dev/null | grep -iE "(usb|serial|wchusbserial|usbmodem)" | head -1)
  # Linux
  elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    port=$(ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null | head -1)
  # Windows (WSL / Git Bash / MSYS2)
  elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then
    port=$(ls /dev/ttyS* 2>/dev/null | head -1)
  fi

  if [ -z "$port" ]; then
    print_error "Could not auto-detect ESP32 port"
    echo "  Available ports:"
    pio device list
    echo ""
    echo "  macOS: expect /dev/cu.usbmodem* (Elecrow) or /dev/cu.wchusbserial* (Waveshare)"
    echo "  Windows: expect COM3, COM4, etc. — PlatformIO detects these automatically"
    exit 1
  fi

  echo "$port"
}

# ============================================================================
# Commands
# ============================================================================

cmd_build() {
  print_header "Building Firmware (env: $PIO_ENV)"
  cd "$SCRIPT_DIR"
  pio run -e "$PIO_ENV"
  print_success "Build complete"
}

cmd_upload() {
  print_header "Uploading Firmware (env: $PIO_ENV)"
  check_config

  cd "$SCRIPT_DIR"

  local port=$(detect_port)
  print_info "Detected port: $port"

  pio run -e "$PIO_ENV" --target upload
  print_success "Firmware uploaded successfully"

  echo ""
  print_info "Device should reboot. On first boot it broadcasts a setup hotspot."
}

cmd_monitor() {
  print_header "Serial Monitor — 115200 baud (env: $PIO_ENV)"
  print_info "Press Ctrl+C to exit"
  echo ""

  cd "$SCRIPT_DIR"

  local port=$(detect_port)
  print_info "Using port: $port"

  pio device monitor -e "$PIO_ENV" --port "$port" --baud 115200
}

cmd_flash_and_monitor() {
  print_header "Flash & Monitor (env: $PIO_ENV)"
  cmd_upload
  echo ""
  cmd_monitor
}

cmd_clean() {
  print_header "Cleaning Build (env: $PIO_ENV)"
  cd "$SCRIPT_DIR"
  pio run -e "$PIO_ENV" --target clean
  print_success "Build cleaned"
}

cmd_help() {
  cat << EOF
${BLUE}ESP32 Firmware Flashing Script${NC}

${YELLOW}Usage:${NC}
  $0 [COMMAND] [--elecrow]

${YELLOW}Board Flags:${NC}
  (default)          Waveshare 2.13" HAT on ESP32-WROOM-32  [env: esp32dev]
  --elecrow          Elecrow CrowPanel ESP32 2.13" (ESP32-S3) [env: elecrow_213]

${YELLOW}Commands:${NC}
  build              Build firmware only (no upload)
  upload             Build and upload (default)
  monitor            View serial output (115200 baud)
  flash              Build, upload, and monitor
  clean              Clean build artifacts
  help               Show this message

${YELLOW}Examples:${NC}
  # Elecrow board — build and upload:
  $0 upload --elecrow

  # Waveshare board — full workflow:
  $0 flash

  # View serial logs (Elecrow):
  $0 monitor --elecrow

${YELLOW}npm shortcuts:${NC}
  npm run flash                  Waveshare upload
  npm run flash:elecrow          Elecrow upload
  npm run flash:elecrow:monitor  Elecrow serial monitor
  npm run flash:full             Waveshare upload + monitor

${YELLOW}Requirements:${NC}
  • PlatformIO CLI  →  pip install platformio
  • USB driver  →  see docs/FIRMWARE_FLASHING.md
  • firmware/lib/EPD/  →  required for Elecrow build (copy from Elecrow GitHub)
  • firmware/config.h  →  copy from config.h.example and fill in API URL

${YELLOW}Troubleshooting:${NC}
  • Port not detected?  →  pio device list
  • Upload fails?  →  hold BOOT button on board while uploading
  • Still failing?  →  try lower upload speed in platformio.ini (115200)
  • Elecrow: no lib?  →  see docs/FIRMWARE_FLASHING.md § Get the EPD Library

EOF
}

# ============================================================================
# Main
# ============================================================================

main() {
  local cmd="${1:-upload}"
  
  case "$cmd" in
    build)
      check_pio
      cmd_build
      ;;
    upload)
      check_pio
      cmd_upload
      ;;
    monitor)
      check_pio
      cmd_monitor
      ;;
    flash)
      check_pio
      cmd_flash_and_monitor
      ;;
    clean)
      check_pio
      cmd_clean
      ;;
    help|--help|-h)
      cmd_help
      ;;
    *)
      print_error "Unknown command: $cmd"
      echo ""
      cmd_help
      exit 1
      ;;
  esac
}

main "$@"
