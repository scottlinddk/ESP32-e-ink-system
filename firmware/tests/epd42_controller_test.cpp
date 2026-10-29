#include <assert.h>
#include <stdio.h>
#include <string>
#include <vector>
#include <Arduino.h>
#include "epd42_panel.h"
#include "epd42_bus.h"

// Compiled twice by run_host_tests.py: SSD1683 board and the green-sticker (v2) board.
int testPins[64] = {};
uint32_t testMillis = 0;
TestSerial Serial;

namespace {
using epd42::kPinBusy;
using epd42::kPinCs;
using epd42::kPinDc;
using epd42::kPinMosi;
using epd42::kPinPower;
using epd42::kPinReset;
using epd42::kPinSck;

// The simulated panel drives BUSY with the controller's datasheet polarity,
// independent of the driver constant, so a wrong driver polarity fails here.
#ifdef ELECROW_PANEL_42_V2
constexpr uint8_t FRAME_COMMAND = 0x13;
constexpr int PANEL_BUSY = LOW;   // UC8176-family BUSY_N
#else
constexpr uint8_t FRAME_COMMAND = 0x24;
constexpr int PANEL_BUSY = HIGH;  // SSD1683 BUSY
#endif

struct Command { uint8_t address; std::vector<uint8_t> bytes; };
std::vector<Command> commands;
int pinModes[64] = {};
unsigned resetPulses = 0;

enum class Response { Cycle, NeverAssert, NeverRelease };
Response response = Response::Cycle;
uint32_t activeDuration = 650;
uint32_t activatedAt = 0;
bool activated = false;

uint8_t shiftByte = 0;
unsigned shiftBits = 0;

void activation() { activatedAt = millis(); activated = true; }

void onByte(uint8_t value) {
  assert(testPins[kPinCs] == LOW);
  if (testPins[kPinDc] == LOW) {
    commands.push_back({value, {}});
#ifndef ELECROW_PANEL_42_V2
    if (value == 0x20) activation();  // Master activation
#endif
  } else {
    assert(!commands.empty());
    commands.back().bytes.push_back(value);
#ifdef ELECROW_PANEL_42_V2
    if (commands.back().address == 0x17 && value == 0xA5) activation();  // Auto refresh
#endif
  }
}

const Command& last(uint8_t address) {
  for (auto it = commands.rbegin(); it != commands.rend(); ++it)
    if (it->address == address) return *it;
  assert(false && "missing controller command");
  return commands[0];
}

std::vector<uint8_t> addresses() {
  std::vector<uint8_t> out;
  for (const auto& command : commands) out.push_back(command.address);
  return out;
}

size_t countOf(uint8_t address) {
  size_t n = 0;
  for (const auto& command : commands) n += command.address == address;
  return n;
}

void fresh(Response next = Response::Cycle) {
  commands.clear();
  response = next;
  activated = false;
  resetPulses = 0;
  Serial.output.clear();
}
}  // namespace

void testPinMode(int pin, int mode) { pinModes[pin] = mode; }

// Decode actual GPIO edges as the display would, independent of the driver's
// helper names. This catches bit order, per-byte chip select and clock regressions.
void testWritePin(int pin, int value) {
  const int previous = testPins[pin];
  testPins[pin] = value;
  if (pin == kPinReset && value == LOW) { activated = false; ++resetPulses; }
  if (pin == kPinCs && value == LOW) { shiftByte = 0; shiftBits = 0; }
  if (pin == kPinSck && previous == LOW && value == HIGH && testPins[kPinCs] == LOW) {
    assert(pinModes[kPinSck] == OUTPUT && pinModes[kPinMosi] == OUTPUT);
    shiftByte = uint8_t((shiftByte << 1) | testPins[kPinMosi]);
    if (++shiftBits == 8) onByte(shiftByte);
    assert(shiftBits <= 8);
  }
  if (pin == kPinCs && value == HIGH && previous == LOW && shiftBits) assert(shiftBits == 8);
}

int testReadPin(int pin) {
  if (pin != kPinBusy) return testPins[pin];
  if (!activated || response == Response::NeverAssert) return !PANEL_BUSY;
  const uint32_t elapsed = millis() - activatedAt;
  if (response == Response::NeverRelease || elapsed < activeDuration) return PANEL_BUSY;
  return !PANEL_BUSY;
}

int main() {
  Epd42Frame frame;
  frame.setBlack(0, 0, true);
  frame.setBlack(399, 299, true);
  Epd42Panel panel;

  // begin(): powers the rail and configures, but must not refresh, so the image
  // retained on the panel survives a reboot.
  fresh();
  assert(panel.begin());
  assert(testPins[kPinPower] == HIGH && pinModes[kPinPower] == OUTPUT);
  assert(testPins[epd42::kPinPowerAux] == HIGH && pinModes[epd42::kPinPowerAux] == OUTPUT);
  // Controller BUSY polarity: SSD1683 HIGH = busy; the green-sticker UC8176-family BUSY_N LOW = busy.
  static_assert(epd42::kBusyActive == PANEL_BUSY, "driver BUSY polarity must match the controller");
  assert(pinModes[kPinBusy] == INPUT && testPins[kPinCs] == HIGH);
  assert(!activated);
#ifdef ELECROW_PANEL_42_V2
  assert(addresses() == std::vector<uint8_t>({0x00, 0x01, 0x06, 0x30, 0x61, 0x82, 0x50, 0x60, 0xE3, 0x10}));
  assert(last(0x61).bytes == std::vector<uint8_t>({0x01, 0x90, 0x01, 0x2C}));  // 400 x 300
  assert(last(0x10).bytes == std::vector<uint8_t>(Epd42Frame::BYTES, 0xFF));    // previous image white
#else
  assert(addresses() == std::vector<uint8_t>({0x12, 0x21, 0x3C, 0x11, 0x44, 0x45, 0x4E, 0x4F}));
  assert(last(0x44).bytes == std::vector<uint8_t>({0x00, 49}));              // 50 bytes per row
  assert(last(0x45).bytes == std::vector<uint8_t>({0x00, 0x00, 0x2B, 0x01}));  // 300 rows
  assert(last(0x11).bytes == std::vector<uint8_t>({0x03}));
#endif
  assert(resetPulses == 1);

  // Full refresh: the frame goes out byte for byte, then the BUSY cycle is awaited.
  uint32_t start = millis();
  assert(panel.write(frame));
  assert(millis() - start >= 650);
  assert(Serial.output.find("cycle observed") != std::string::npos);
  const auto& image = last(FRAME_COMMAND).bytes;
  assert(image.size() == Epd42Frame::BYTES);
  assert(image[0] == 0x7F && image[Epd42Frame::BYTES - 1] == 0xFE && image[1] == 0xFF);
#ifdef ELECROW_PANEL_42_V2
  for (uint8_t table = 0x20; table <= 0x24; ++table) assert(last(table).bytes.size() == 42);
  assert(last(0x20).bytes[1] == 0x14 && last(0x21).bytes[1] == 0x54 && last(0x23).bytes[1] == 0x94);
  assert(last(0x50).bytes == std::vector<uint8_t>({0xD7}));
  assert(addresses().back() == 0x17 && last(0x17).bytes == std::vector<uint8_t>({0xA5}));
#else
  assert(last(0x22).bytes == std::vector<uint8_t>({0xF7}));
  assert(addresses().back() == 0x20);
#endif

  // sleep() enters deep sleep; the next write wakes the controller with a new hardware reset.
  const unsigned pulses = resetPulses;
  panel.sleep();
#ifdef ELECROW_PANEL_42_V2
  assert(last(0x07).bytes == std::vector<uint8_t>({0xA5}));
#else
  assert(last(0x10).bytes == std::vector<uint8_t>({0x01}));
#endif
  commands.clear();
  assert(panel.write(frame));
  assert(resetPulses == pulses + 1);
  assert(countOf(FRAME_COMMAND) == 1);

  // A BUSY line that never asserts is not a refresh acknowledgement. The failure
  // is reported once, then latched so later screens do not stall again.
  fresh(Response::NeverAssert);
  panel.begin();
  start = millis();
  assert(!panel.write(frame));
  uint32_t elapsed = millis() - start;
  assert(elapsed >= 1000 && elapsed < 2000);
  assert(Serial.output.find("BUSY did not assert") != std::string::npos);
  assert(Serial.output.find("cycle observed") == std::string::npos);
  const size_t sent = commands.size();
  start = millis();
  assert(!panel.write(frame));
  assert(commands.size() == sent && millis() == start);

  // begin() is the explicit retry and clears the latch.
  fresh();
  assert(panel.begin() && panel.write(frame));

  // A BUSY line stuck active times out instead of hanging the device.
  fresh(Response::NeverRelease);
  panel.begin();
  start = millis();
  assert(!panel.write(frame));
  elapsed = millis() - start;
  assert(elapsed >= 15000 && elapsed < 17000);
  assert(Serial.output.find("BUSY did not release") != std::string::npos);

  puts("Epd42Panel controller sequence, GPIO framing, BUSY cycle and failure latch checks passed");
}
