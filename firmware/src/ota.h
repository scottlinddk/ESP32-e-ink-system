#pragma once

#include <cstdint>

class ApiClient;

class OTAManager {
public:
  OTAManager();
  
  // Check for available updates (blocking, makes HTTP request)
  bool checkForUpdates(ApiClient& apiClient, const char* userId, const char* licenseKey);
  
  // Perform OTA update (blocking, downloads and updates firmware)
  bool performUpdate(const char* downloadUrl, const char* checksum);
  
  // Get current firmware version
  const char* getCurrentVersion();
  
  // Set current firmware version (called on startup)
  void setCurrentVersion(const char* version);
  
  // Get last update check time (unix timestamp)
  uint32_t getLastUpdateCheck();

private:
  char _currentVersion[32];
  uint32_t _lastUpdateCheck;
  
  // Helper functions
  bool verifyChecksum(const char* data, size_t dataLen, const char* expectedChecksum);
  bool downloadFirmware(const char* url, uint8_t* buffer, size_t* bufferLen);
};
