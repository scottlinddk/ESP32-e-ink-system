#ifdef ELECROW_EPAPER_42
#include <Arduino.h>
#include "epd42_bus.h"

namespace epd42 {
namespace {
constexpr uint32_t BUSY_ASSERT_TIMEOUT_MS = 1000;
constexpr uint32_t BUSY_RELEASE_TIMEOUT_MS = 15000;

// MSB first, data valid on the rising clock edge. This is the vendor's GPIO
// transport; at 15000 bytes a frame it is fast enough that hardware SPI buys
// nothing worth deviating from the reference for.
void transferByte(uint8_t value) {
  for (uint8_t bit = 0; bit < 8; ++bit) {
    digitalWrite(kPinSck, LOW);
    digitalWrite(kPinMosi, value & 0x80 ? HIGH : LOW);
    digitalWrite(kPinSck, HIGH);
    value <<= 1;
  }
}

bool busyFailure(const char* stage, const char* reason, uint32_t elapsed) {
  Serial.printf("[EPD42] %s: %s after %lu ms; BUSY GPIO%d=%d active=%d, power GPIO%d=%d, reset GPIO%d=%d\n",
    stage, reason, static_cast<unsigned long>(elapsed),
    kPinBusy, digitalRead(kPinBusy), kBusyActive,
    kPinPower, digitalRead(kPinPower), kPinReset, digitalRead(kPinReset));
  return false;
}
}  // namespace

void busBegin() {
  pinMode(kPinPower, OUTPUT);
  digitalWrite(kPinPower, HIGH);
  delay(100);
  pinMode(kPinSck, OUTPUT);
  pinMode(kPinMosi, OUTPUT);
  pinMode(kPinReset, OUTPUT);
  pinMode(kPinDc, OUTPUT);
  pinMode(kPinCs, OUTPUT);
  pinMode(kPinBusy, INPUT);
  digitalWrite(kPinCs, HIGH);
  digitalWrite(kPinSck, LOW);
}

void hardwareReset(uint32_t highMs, uint32_t lowMs, uint32_t settleMs) {
  digitalWrite(kPinReset, HIGH);
  delay(highMs);
  digitalWrite(kPinReset, LOW);
  delay(lowMs);
  digitalWrite(kPinReset, HIGH);
  delay(settleMs);
}

void command(uint8_t value) {
  digitalWrite(kPinDc, LOW);
  digitalWrite(kPinCs, LOW);
  transferByte(value);
  digitalWrite(kPinCs, HIGH);
  digitalWrite(kPinDc, HIGH);
}

void data(uint8_t value) {
  digitalWrite(kPinDc, HIGH);
  digitalWrite(kPinCs, LOW);
  transferByte(value);
  digitalWrite(kPinCs, HIGH);
}

void dataBlock(const uint8_t* bytes, size_t length) {
  for (size_t i = 0; i < length; ++i) data(bytes[i]);
}

void dataFill(uint8_t value, size_t length) {
  for (size_t i = 0; i < length; ++i) data(value);
}

void reg(uint8_t address, std::initializer_list<uint8_t> values) {
  command(address);
  for (uint8_t value : values) data(value);
}

bool waitIdle(const char* stage) {
  const uint32_t start = millis();
  while (digitalRead(kPinBusy) == kBusyActive) {
    if (millis() - start >= BUSY_RELEASE_TIMEOUT_MS)
      return busyFailure(stage, "BUSY did not release", millis() - start);
    delay(10);
  }
  return true;
}

bool waitRefreshCycle() {
  const uint32_t start = millis();
  while (digitalRead(kPinBusy) != kBusyActive) {
    if (millis() - start >= BUSY_ASSERT_TIMEOUT_MS)
      return busyFailure("refresh", "BUSY did not assert", millis() - start);
    delay(1);
  }
  const uint32_t asserted = millis();
  if (!waitIdle("refresh")) return false;
  Serial.printf("[EPD42] refresh BUSY cycle observed: asserted after %lu ms, active for %lu ms\n",
    static_cast<unsigned long>(asserted - start), static_cast<unsigned long>(millis() - asserted));
  return true;
}

}  // namespace epd42
#endif
