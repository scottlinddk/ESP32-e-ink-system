#include "battery.h"
#include "config.h"

#if DEBUG_ENABLED
#define LOG_B(fmt, ...) Serial.printf("[Battery] " fmt "\n", ##__VA_ARGS__)
#else
#define LOG_B(fmt, ...)
#endif

// Calibration constants (adjust for your specific setup)
const float BatteryManager::BATTERY_FULL_VOLTAGE = 4.2;   // 100%
const float BatteryManager::BATTERY_EMPTY_VOLTAGE = 3.0;  // 0%
const int BatteryManager::ADC_MAX_VALUE = 4095;           // 12-bit ADC
const float BatteryManager::VREF = 1.1;                   // Internal reference
const float BatteryManager::VOLTAGE_DIVIDER_RATIO = 1.0;  // Adjust if using divider

BatteryManager::BatteryManager() : _lastVoltage(0.0) {}

void BatteryManager::begin() {
  // Configure ADC
  analogSetPinAttenuation(PIN_BATTERY_ADC, ADC_11db);  // Full range 0-3.6V
  analogReadResolution(12);                             // 12-bit resolution
  
  LOG_B("Battery monitor initialized on GPIO %d", PIN_BATTERY_ADC);
}

uint16_t BatteryManager::readRaw() {
  return analogRead(PIN_BATTERY_ADC);
}

float BatteryManager::readVoltage() {
  uint16_t raw = readRaw();
  
  // Convert ADC reading to voltage
  // Formula: voltage = (raw / ADC_MAX) * VREF * 2 (if using 1:1 divider)
  float voltage = (raw / (float)ADC_MAX_VALUE) * 3.3 * VOLTAGE_DIVIDER_RATIO;
  
  _lastVoltage = voltage;
  
  LOG_B("Battery ADC: %d → %.2f V", raw, voltage);
  
  return voltage;
}

int BatteryManager::readPercentage() {
  float voltage = readVoltage();
  
  // Map voltage to percentage (linear approximation)
  if (voltage >= BATTERY_FULL_VOLTAGE) {
    return 100;
  } else if (voltage <= BATTERY_EMPTY_VOLTAGE) {
    return 0;
  } else {
    int percentage = (int)(
      (voltage - BATTERY_EMPTY_VOLTAGE) / 
      (BATTERY_FULL_VOLTAGE - BATTERY_EMPTY_VOLTAGE) * 100.0
    );
    return constrain(percentage, 0, 100);
  }
}

bool BatteryManager::isLow() {
  float voltage = _lastVoltage > 0 ? _lastVoltage : readVoltage();
  return voltage < BATTERY_ALERT_THRESHOLD;
}

const char* BatteryManager::getStatus() {
  int percentage = readPercentage();
  
  if (percentage > 75) return "🔋 Full";
  if (percentage > 50) return "🔌 Good";
  if (percentage > 25) return "⚠️  Low";
  return "🔴 Critical";
}
