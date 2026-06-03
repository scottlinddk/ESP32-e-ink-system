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
  # Try to detect ESP32 serial port
  local port=""
  
  # macOS
  if [[ "$OSTYPE" == "darwin"* ]]; then
    port=$(ls /dev/cu.* 2>/dev/null | grep -iE "(usb|serial|wchusbserial)" | head -1)
  # Linux
  elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    port=$(ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null | head -1)
  # Windows (WSL)
  elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
    port=$(ls /dev/ttyS* 2>/dev/null | head -1)
  fi
  
  if [ -z "$port" ]; then
    print_error "Could not auto-detect ESP32 port"
    echo "  Available ports:"
    pio device list
    exit 1
  fi
  
  echo "$port"
}

# ============================================================================
# Commands
# ============================================================================

cmd_build() {
  print_header "Building Firmware"
  cd "$SCRIPT_DIR"
  pio run
  print_success "Build complete"
}

cmd_upload() {
  print_header "Uploading Firmware"
  check_config
  
  cd "$SCRIPT_DIR"
  
  local port=$(detect_port)
  print_info "Detected port: $port"
  
  pio run --target upload -v
  print_success "Firmware uploaded successfully"
  
  echo ""
  print_info "Device should reboot and connect to WiFi..."
}

cmd_monitor() {
  print_header "Serial Monitor (115200 baud)"
  print_info "Press Ctrl+C to exit"
  echo ""
  
  cd "$SCRIPT_DIR"
  
  local port=$(detect_port)
  print_info "Using port: $port"
  
  pio device monitor --port "$port" --baud 115200
}

cmd_flash_and_monitor() {
  print_header "Flash & Monitor"
  cmd_upload
  echo ""
  cmd_monitor
}

cmd_clean() {
  print_header "Cleaning Build"
  cd "$SCRIPT_DIR"
  pio run --target clean
  print_success "Build cleaned"
}

cmd_help() {
  cat << EOF
${BLUE}ESP32 Firmware Flashing Script${NC}

${YELLOW}Usage:${NC}
  $0 [COMMAND]

${YELLOW}Commands:${NC}
  build              Build firmware only (no upload)
  upload             Build and upload to ESP32 (default)
  monitor            View serial output (115200 baud)
  flash              Build, upload, and monitor
  clean              Clean build artifacts
  help               Show this message

${YELLOW}Examples:${NC}
  # Build and upload (interactive):
  $0 upload

  # View logs after flashing:
  $0 monitor

  # Full workflow:
  $0 flash

${YELLOW}Requirements:${NC}
  • PlatformIO CLI (pip install platformio)
  • USB driver for your ESP32 board
  • config.h configured with WiFi & API credentials

${YELLOW}Troubleshooting:${NC}
  • Port not detected? → pio device list
  • Want manual control? → cd firmware && pio run --target upload
  • Check wiring & USB cable if upload fails

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
