#pragma once

#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include "display.h"

struct ImageDisplayResult {
  bool success;
  char imageUrl[512];
  uint32_t refreshSeconds;
  char errorMessage[128];
};

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

  // Fetch TRMNL-style image endpoint: returns image_url + refresh_rate
  bool fetchImageEndpoint(const char* userId, const char* licenseKey,
                          ImageDisplayResult& result);

  // Download a BMP from the given URL into caller-supplied buffer.
  // Returns number of bytes downloaded, or -1 on failure.
  int downloadBmp(const char* url, uint8_t* buffer, size_t bufferSize);

private:
  HTTPClient http;
  WiFiClientSecure client;
  char _baseUrl[128];

  // Helper functions
  bool parseDisplayDataResponse(const char* jsonResponse, DisplayData& data);
  bool parsePreferencesResponse(const char* jsonResponse, uint32_t* refreshMinutes, int* displayMode);

  void setupSSL();
};
