#pragma once
#include <stddef.h>
#include <stdint.h>
#include <initializer_list>

// GPIO wiring and transport for the Elecrow CrowPanel 4.2" e-paper. Both
// controller revisions share it. Pins are fixed by the PCB (vendor readme,
// section 7) and deliberately not read from config.h: a stale local config.h
// would otherwise silently drive another board's pins.
namespace epd42 {

constexpr int kPinSck = 12;
constexpr int kPinMosi = 11;
constexpr int kPinReset = 47;
constexpr int kPinDc = 46;
constexpr int kPinCs = 45;
constexpr int kPinBusy = 48;
constexpr int kPinPower = 7;  // Panel rail, HIGH = enabled (vendor examples).

// Both vendor drivers poll BUSY until it reads LOW, so HIGH = busy. Override
// with -D EPD42_BUSY_ACTIVE=LOW if a unit proves otherwise.
#ifndef EPD42_BUSY_ACTIVE
#define EPD42_BUSY_ACTIVE 1
#endif
constexpr int kBusyActive = EPD42_BUSY_ACTIVE;

// Powers the rail and configures the pins. Safe to call repeatedly.
void busBegin();
// Pulses RESET with the given low and settle times (they differ per revision).
void hardwareReset(uint32_t highMs, uint32_t lowMs, uint32_t settleMs);

void command(uint8_t value);
void data(uint8_t value);
void dataBlock(const uint8_t* bytes, size_t length);
void dataFill(uint8_t value, size_t length);
void reg(uint8_t address, std::initializer_list<uint8_t> values);

// Waits for BUSY to leave its active level. Logs and returns false on timeout.
bool waitIdle(const char* stage);
// Requires BUSY to assert and then release, so a line stuck at either level
// cannot acknowledge a frame. Proves controller activity, not visible pixels.
bool waitRefreshCycle();

}  // namespace epd42
