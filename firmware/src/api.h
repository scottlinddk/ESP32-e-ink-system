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

class ApiClient {
public:
  ApiClient();
  
  // Fetch display data from backend
  ApiResponse fetchDisplayData(const char* userId, const char* licenseKey);
  
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
  
  // Helper functions
  bool parseDisplayDataResponse(const char* jsonResponse, DisplayData& data);
  bool parsePreferencesResponse(const char* jsonResponse, uint32_t* refreshMinutes, int* displayMode);
  
  // SSL certificate validation (if using self-signed certs)
  void setupSSL();
};
