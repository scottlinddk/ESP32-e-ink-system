#pragma once

#include <cstdint>

class BatteryManager {
public:
  BatteryManager();
  
  // Initialize ADC
  void begin();
  
  // Read battery voltage (in volts)
  float readVoltage();
  
  // Read battery percentage (0-100)
  int readPercentage();
  
  // Read raw ADC value
  uint16_t readRaw();
  
  // Check if battery is low
  bool isLow();
  
  // Get human-readable battery status
  const char* getStatus();

private:
  // ADC calibration values (can be adjusted per device)
  static const float BATTERY_FULL_VOLTAGE;   // 4.2V (typical Li-Po full)
  static const float BATTERY_EMPTY_VOLTAGE;  // 3.0V (typical Li-Po empty)
  static const int ADC_MAX_VALUE;            // 4095 for ESP32 (12-bit)
  static const float VREF;                   // Reference voltage for ADC
  
  // Voltage divider ratio (if using voltage divider)
  static const float VOLTAGE_DIVIDER_RATIO;  // e.g., 2.0 if using 1:1 divider
  
  float _lastVoltage;
};
