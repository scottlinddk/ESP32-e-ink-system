#!/bin/bash

# ============================================================================
# Arduino IDE Setup Script for ESP32 E-Ink Display
# ============================================================================
# Prepares your environment for flashing with Arduino IDE:
#   - Creates firmware/config.h from the template if missing
#   - Sets the board define in config.h (Elecrow or Waveshare)
#   - Copies the Elecrow EPD library to your Arduino libraries folder
#   - Installs GxEPD2 and ArduinoJson via arduino-cli (if available)
#   - Prints remaining manual steps for Arduino IDE
#
# Usage:
#   ./firmware/scripts/setup_arduino_ide.sh             # Waveshare (default)
#   ./firmware/scripts/setup_arduino_ide.sh --elecrow   # Elecrow CrowPanel
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_header() {
  echo ""
  echo -e "${BLUE}════════════════════════════════════════${NC}"
  echo -e "${BLUE}  $1${NC}"
  echo -e "${BLUE}════════════════════════════════════════${NC}"
}

print_success() { echo -e "  ${GREEN}✓${NC} $1"; }
print_error()   { echo -e "  ${RED}✗${NC} $1"; }
print_warning() { echo -e "  ${YELLOW}⚠${NC} $1"; }
print_info()    { echo -e "  ${BLUE}ℹ${NC} $1"; }
print_step()    { echo -e "\n  ${YELLOW}▶${NC} $1"; }

# ============================================================================
# Board Selection
# ============================================================================

BOARD="waveshare"
if [[ "$*" == *"--elecrow"* ]]; then
  BOARD="elecrow"
else
  echo ""
  echo -e "${BLUE}Which board are you flashing?${NC}"
  echo "  1) Waveshare 2.13\" HAT (ESP32-WROOM-32)  [default]"
  echo "  2) Elecrow CrowPanel 2.13\" (ESP32-S3)"
  echo -n "  Enter choice [1]: "
  read -r BOARD_CHOICE
  if [[ "$BOARD_CHOICE" == "2" ]]; then
    BOARD="elecrow"
  fi
fi

if [[ "$BOARD" == "elecrow" ]]; then
  print_header "Arduino IDE Setup — Elecrow CrowPanel (ESP32-S3)"
else
  print_header "Arduino IDE Setup — Waveshare 2.13\" HAT (ESP32-WROOM-32)"
fi

# ============================================================================
# OS Detection — Arduino Libraries Folder
# ============================================================================

print_step "Detecting Arduino libraries folder..."

ARDUINO_LIBS_DIR=""
if [[ "$OSTYPE" == "darwin"* ]]; then
  ARDUINO_LIBS_DIR="$HOME/Documents/Arduino/libraries"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
  ARDUINO_LIBS_DIR="$HOME/Arduino/libraries"
elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then
  # WSL or Git Bash / MSYS2
  if [ -n "$USERPROFILE" ]; then
    WIN_HOME=$(echo "$USERPROFILE" | sed 's|\\|/|g' | sed 's|C:|/mnt/c|')
    ARDUINO_LIBS_DIR="$WIN_HOME/Documents/Arduino/libraries"
  else
    ARDUINO_LIBS_DIR="/mnt/c/Users/$USER/Documents/Arduino/libraries"
  fi
fi

if [ -z "$ARDUINO_LIBS_DIR" ]; then
  print_warning "Could not auto-detect OS. Enter your Arduino libraries path:"
  echo -n "  Path: "
  read -r ARDUINO_LIBS_DIR
fi

# Create directory if it doesn't exist
mkdir -p "$ARDUINO_LIBS_DIR"
print_success "Arduino libraries: $ARDUINO_LIBS_DIR"

# ============================================================================
# config.h Setup
# ============================================================================

print_step "Checking config.h..."

CONFIG_H="$SCRIPT_DIR/config.h"
CONFIG_EXAMPLE="$SCRIPT_DIR/config.h.example"

if [ ! -f "$CONFIG_H" ]; then
  cp "$CONFIG_EXAMPLE" "$CONFIG_H"
  print_success "Created config.h from config.h.example"
  print_warning "Edit $CONFIG_H and set PROVISION_DEFAULT_API_URL to your backend URL"
else
  print_success "config.h already exists"
fi

# For Elecrow: ensure ELECROW_EPAPER_213 is defined
if [[ "$BOARD" == "elecrow" ]]; then
  if grep -q "#define ELECROW_EPAPER_213" "$CONFIG_H" 2>/dev/null; then
    print_success "ELECROW_EPAPER_213 already defined in config.h"
  else
    # Insert after #pragma once (first line), handling macOS vs Linux sed
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' '/^#pragma once/a\
\
#define ELECROW_EPAPER_213  \/\/ Elecrow CrowPanel 2.13" (ESP32-S3)
' "$CONFIG_H"
    else
      sed -i '/^#pragma once/a\\\n#define ELECROW_EPAPER_213  \/\/ Elecrow CrowPanel 2.13" (ESP32-S3)' "$CONFIG_H"
    fi
    print_success "Added #define ELECROW_EPAPER_213 to config.h"
  fi
fi

# ============================================================================
# EPD Library Copy (Elecrow only)
# ============================================================================

MISSING_EPD=0

if [[ "$BOARD" == "elecrow" ]]; then
  print_step "Copying Elecrow EPD library..."

  EPD_SRC="$SCRIPT_DIR/lib/EPD"
  EPD_DEST="$ARDUINO_LIBS_DIR/EPD"

  if [ -d "$EPD_SRC" ]; then
    if [ -d "$EPD_DEST" ]; then
      print_success "EPD library already at $EPD_DEST — skipping"
    else
      cp -r "$EPD_SRC" "$EPD_DEST"
      print_success "Copied EPD library to $EPD_DEST"
    fi
  else
    print_warning "firmware/lib/EPD/ not found — EPD library must be installed manually"
    MISSING_EPD=1
  fi
fi

# ============================================================================
# Library Installation via arduino-cli
# ============================================================================

print_step "Installing Arduino libraries..."

MANUAL_LIBS=0

if command -v arduino-cli &>/dev/null; then
  print_info "arduino-cli found — installing GxEPD2 and ArduinoJson..."
  arduino-cli lib install "GxEPD2" 2>&1 | sed 's/^/    /'
  arduino-cli lib install "ArduinoJson" 2>&1 | sed 's/^/    /'
  print_success "GxEPD2 and ArduinoJson installed via arduino-cli"
else
  print_warning "arduino-cli not installed — GxEPD2 and ArduinoJson need manual install"
  MANUAL_LIBS=1
fi

# ESPAsyncWebServer and AsyncTCP are always ZIP installs (not in standard registry)
ASYNC_WEB_URL="https://github.com/esphome/ESPAsyncWebServer/archive/refs/heads/master.zip"
ASYNC_TCP_URL="https://github.com/esphome/AsyncTCP/archive/refs/heads/master.zip"

# ============================================================================
# Summary
# ============================================================================

print_header "Setup Summary"

echo ""
echo -e "  ${GREEN}Done automatically:${NC}"
print_success "config.h exists"
if [[ "$BOARD" == "elecrow" ]]; then
  print_success "ELECROW_EPAPER_213 defined in config.h"
  if [ "$MISSING_EPD" -eq 0 ]; then
    print_success "EPD library copied to $ARDUINO_LIBS_DIR/EPD/"
  fi
fi
if [ "$MANUAL_LIBS" -eq 0 ]; then
  print_success "GxEPD2 installed via arduino-cli"
  print_success "ArduinoJson installed via arduino-cli"
fi

echo ""
echo -e "  ${YELLOW}Manual steps still required in Arduino IDE:${NC}"
echo ""

STEP=1

# API URL
echo -e "  ${STEP}. Edit firmware/config.h and set your backend URL:"
echo "       #define PROVISION_DEFAULT_API_URL \"https://your-api.vercel.app\""
STEP=$((STEP + 1))

# Missing EPD library
if [ "$MISSING_EPD" -eq 1 ]; then
  echo ""
  echo -e "  ${STEP}. Install Elecrow EPD library (firmware/lib/EPD/ was not found):"
  echo "       a) Download: https://github.com/Elecrow-RD/CrowPanel-ESP32-2.13-E-paper-HMI-Display-with-122-250"
  echo "          (Code → Download ZIP, then extract)"
  echo "       b) Copy the EPD folder from factory_sourcecode/.../libraries/EPD/"
  echo "          to $ARDUINO_LIBS_DIR/EPD/"
  echo "       c) Re-run this script to copy it automatically, or copy manually"
  STEP=$((STEP + 1))
fi

# Library Manager (if arduino-cli not available)
if [ "$MANUAL_LIBS" -eq 1 ]; then
  echo ""
  echo -e "  ${STEP}. Install via Arduino IDE Library Manager (Tools → Manage Libraries):"
  if [[ "$BOARD" == "waveshare" ]]; then
    echo "       • GxEPD2 by ZinggJM  (v1.5.3 or newer)"
  fi
  echo "       • ArduinoJson by Benoit Blanchon  (v7.x)"
  STEP=$((STEP + 1))
fi

# ZIP libraries (always required)
echo ""
echo -e "  ${STEP}. Install ZIP libraries (Sketch → Include Library → Add .ZIP Library):"
echo "       a) ESPAsyncWebServer-esphome:"
echo "          $ASYNC_WEB_URL"
echo "       b) AsyncTCP-esphome:"
echo "          $ASYNC_TCP_URL"
STEP=$((STEP + 1))

# Board settings
echo ""
echo -e "  ${STEP}. Configure board settings (Tools menu in Arduino IDE):"
if [[ "$BOARD" == "elecrow" ]]; then
  echo "       Board:            ESP32 Arduino → ESP32S3 Dev Module"
  echo "       Partition Scheme: Huge APP (3MB No OTA/1MB SPIFFS)"
  echo "       PSRAM:            OPI PSRAM"
  echo "       USB CDC On Boot:  Enabled"
  echo "       Upload Mode:      UART0 / Hardware CDC"
  echo "       Port:             your /dev/cu.* or COM port"
  echo ""
  echo "       Note: Use esp32 board package version 2.0.15 (newer versions"
  echo "             change USB upload behavior and may cause upload failures)"
else
  echo "       Board:            ESP32 Arduino → ESP32 Dev Module"
  echo "       Partition Scheme: Default 4MB"
  echo "       Port:             your /dev/cu.* or COM port"
fi
STEP=$((STEP + 1))

# Open and upload
echo ""
echo -e "  ${STEP}. Open firmware/src/main.ino and click Upload"
echo "       If upload fails, hold the BOOT button on the board and try again"

echo ""
echo -e "  ${BLUE}ℹ${NC}  Full instructions: docs/FIRMWARE_FLASHING.md § Arduino IDE"
echo ""
