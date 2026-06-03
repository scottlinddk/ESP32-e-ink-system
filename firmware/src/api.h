#pragma once

#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include "display.h"

struct ApiResponse {
  bool success;
  int httpCode;
  DisplayData displayData;
  char errorMessage[256];
};

struct PairingResult {
  bool success;
  char userId[64];
  char licenseKey[32];
  char errorMessage[256];
};

class ApiClient {
public:
  ApiClient();

  void setBaseUrl(const char* baseUrl);

  // Fetch display data from backend
  ApiResponse fetchDisplayData(const char* userId, const char* licenseKey);

  // Pair an unprovisioned device — returns userId + licenseKey on success
  bool pairDevice(const char* macAddress, const char* deviceName, PairingResult& result);

  // Report device status (battery, signal strength)
  bool reportDeviceStatus(const char* userId, const char* licenseKey,
                         int batteryPercent, int signalStrength);

  // Check for firmware updates
  bool checkForUpdates(const char* userId, const char* licenseKey,
                      const char* currentVersion, char* latestVersion,
                      char* downloadUrl, char* checksum);

  // Get user preferences (refresh interval, display mode, etc.)
  bool getPreferences(const char* userId, const char* licenseKey,
                     uint32_t* refreshMinutes, int* displayMode);

private:
  HTTPClient http;
  WiFiClientSecure client;
  char _baseUrl[128];

  // Helper functions
  bool parseDisplayDataResponse(const char* jsonResponse, DisplayData& data);
  bool parsePreferencesResponse(const char* jsonResponse, uint32_t* refreshMinutes, int* displayMode);

  void setupSSL();
};
