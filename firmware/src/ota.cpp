#include "ota.h"
#include "api.h"
#include "config.h"
#include <HTTPClient.h>
#include <Update.h>
#include <WiFiClientSecure.h>

#if DEBUG_ENABLED
#define LOG_O(fmt, ...) Serial.printf("[OTA] " fmt "\n", ##__VA_ARGS__)
#else
#define LOG_O(fmt, ...)
#endif

OTAManager::OTAManager() : _lastUpdateCheck(0) {
  strcpy(_currentVersion, "1.0.0");  // Default version
}

const char* OTAManager::getCurrentVersion() {
  return _currentVersion;
}

void OTAManager::setCurrentVersion(const char* version) {
  strlcpy(_currentVersion, version, sizeof(_currentVersion));
  LOG_O("Version set to: %s", version);
}

uint32_t OTAManager::getLastUpdateCheck() {
  return _lastUpdateCheck;
}

bool OTAManager::checkForUpdates(ApiClient& apiClient, const char* userId, const char* licenseKey) {
  LOG_O("Checking for updates...");

  char latestVersion[32] = {0};
  char downloadUrl[256] = {0};
  char checksum[256] = {0};

  _lastUpdateCheck = millis() / 1000;

  if (!apiClient.checkForUpdates(userId, licenseKey, _currentVersion, latestVersion, downloadUrl, checksum)) {
    LOG_O("No update available or update check failed");
    return false;
  }

  if (strcmp(latestVersion, _currentVersion) == 0) {
    LOG_O("Device already on latest version: %s", _currentVersion);
    return false;
  }

  LOG_O("Update available: %s -> %s", _currentVersion, latestVersion);
  if (!performUpdate(downloadUrl, checksum)) {
    LOG_O("OTA update failed");
    return false;
  }

  setCurrentVersion(latestVersion);
  return true;
}

bool OTAManager::performUpdate(const char* downloadUrl, const char* checksum) {
  LOG_O("Starting OTA update from: %s", downloadUrl);

  uint8_t buffer[1024];
  size_t totalWritten = 0;

  if (!downloadFirmware(downloadUrl, buffer, &totalWritten)) {
    LOG_O("Download failed");
    return false;
  }

  LOG_O("OTA binary downloaded and written (%u bytes)", totalWritten);
  return true;
}

bool OTAManager::verifyChecksum(const char* data, size_t dataLen, const char* expectedChecksum) {
  LOG_O("Checksum verification is not implemented, expected=%s", expectedChecksum);
  return true;
}

bool OTAManager::downloadFirmware(const char* url, uint8_t* buffer, size_t* bufferLen) {
  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  if (!http.begin(client, url)) {
    LOG_O("HTTP begin failed for %s", url);
    return false;
  }

  http.setTimeout(API_REQUEST_TIMEOUT_MS, API_REQUEST_TIMEOUT_MS);
  int httpCode = http.GET();
  if (httpCode != HTTP_CODE_OK) {
    LOG_O("Firmware download HTTP error %d", httpCode);
    http.end();
    return false;
  }

  int contentLength = http.getSize();
  if (contentLength <= 0) {
    LOG_O("Firmware download has invalid content length: %d", contentLength);
    http.end();
    return false;
  }

  if (!Update.begin(static_cast<size_t>(contentLength))) {
    LOG_O("Update.begin failed: %s", Update.errorString());
    http.end();
    return false;
  }

  WiFiClient* stream = http.getStreamPtr();
  while (http.connected() && *bufferLen < static_cast<size_t>(contentLength)) {
    size_t available = stream->available();
    if (available) {
      size_t toRead = available;
      if (toRead > 1024) toRead = 1024;
      int readBytes = stream->read(buffer, toRead);
      if (readBytes <= 0) {
        break;
      }

      size_t written = Update.write(buffer, readBytes);
      if (written != static_cast<size_t>(readBytes)) {
        LOG_O("Update write failed: %s", Update.errorString());
        http.end();
        return false;
      }

      *bufferLen += written;
    }
  }

  if (!Update.end(true)) {
    LOG_O("Update end failed: %s", Update.errorString());
    http.end();
    return false;
  }

  if (!Update.isFinished()) {
    LOG_O("Update not finished");
    http.end();
    return false;
  }

  http.end();
  return true;
}
