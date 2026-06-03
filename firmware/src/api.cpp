#include "api.h"
#include "config.h"
#include <ArduinoJson.h>

#ifndef PROVISION_DEFAULT_API_URL
#define PROVISION_DEFAULT_API_URL "https://your-api.vercel.app"
#endif

#if DEBUG_ENABLED
#define LOG_A(fmt, ...) Serial.printf("[API] " fmt "\n", ##__VA_ARGS__)
#else
#define LOG_A(fmt, ...)
#endif

ApiClient::ApiClient() {
  strlcpy(_baseUrl, PROVISION_DEFAULT_API_URL, sizeof(_baseUrl));
  setupSSL();
}

void ApiClient::setBaseUrl(const char* baseUrl) {
  strlcpy(_baseUrl, baseUrl, sizeof(_baseUrl));
}

void ApiClient::setupSSL() {
  client.setInsecure();
}

ApiResponse ApiClient::fetchDisplayData(const char* userId, const char* licenseKey) {
  ApiResponse response = {false, 0, {}, ""};

  char url[512];
  snprintf(url, sizeof(url), "%s/api/display-data/%s", _baseUrl, userId);

  LOG_A("Fetching display data from: %s", url);

  http.setConnectTimeout(API_REQUEST_TIMEOUT_MS);
  http.setTimeout(API_REQUEST_TIMEOUT_MS, API_REQUEST_TIMEOUT_MS);

  if (!http.begin(client, url)) {
    snprintf(response.errorMessage, sizeof(response.errorMessage), "Failed to connect to server");
    LOG_A("Connection failed");
    return response;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-License-Key", licenseKey);

  int httpCode = http.GET();
  response.httpCode = httpCode;

  LOG_A("HTTP response code: %d", httpCode);

  if (httpCode != 200) {
    snprintf(response.errorMessage, sizeof(response.errorMessage), "HTTP error %d", httpCode);
    http.end();
    return response;
  }

  String payload = http.getString();
  http.end();

  if (payload.length() == 0) {
    snprintf(response.errorMessage, sizeof(response.errorMessage), "Empty response");
    return response;
  }

#if LOG_API_RESPONSES
  LOG_A("Response: %s", payload.c_str());
#endif

  if (parseDisplayDataResponse(payload.c_str(), response.displayData)) {
    response.success = true;
    LOG_A("Display data parsed successfully");
  } else {
    snprintf(response.errorMessage, sizeof(response.errorMessage), "JSON parse error");
    LOG_A("Failed to parse JSON response");
  }

  return response;
}

bool ApiClient::pairDevice(const char* macAddress, const char* deviceName, PairingResult& result) {
  result.success = false;
  result.userId[0] = '\0';
  result.licenseKey[0] = '\0';
  result.errorMessage[0] = '\0';

  char url[512];
  snprintf(url, sizeof(url), "%s/api/devices/pair", _baseUrl);

  LOG_A("Pairing device at: %s  MAC: %s", url, macAddress);

  http.setConnectTimeout(API_REQUEST_TIMEOUT_MS);
  http.setTimeout(API_REQUEST_TIMEOUT_MS, API_REQUEST_TIMEOUT_MS);

  if (!http.begin(client, url)) {
    snprintf(result.errorMessage, sizeof(result.errorMessage), "Failed to connect to server");
    LOG_A("Connection failed");
    return false;
  }

  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<256> reqDoc;
  reqDoc["mac_address"] = macAddress;
  reqDoc["device_name"] = deviceName;

  String payload;
  serializeJson(reqDoc, payload);

  int httpCode = http.POST(payload);
  LOG_A("Pair response: HTTP %d", httpCode);

  if (httpCode != 200 && httpCode != 201) {
    snprintf(result.errorMessage, sizeof(result.errorMessage), "HTTP error %d", httpCode);
    http.end();
    return false;
  }

  String body = http.getString();
  http.end();

  StaticJsonDocument<512> resDoc;
  DeserializationError err = deserializeJson(resDoc, body);
  if (err) {
    snprintf(result.errorMessage, sizeof(result.errorMessage), "JSON parse error");
    LOG_A("Failed to parse pair response");
    return false;
  }

  if (!resDoc.containsKey("user_id") || !resDoc.containsKey("license_key")) {
    snprintf(result.errorMessage, sizeof(result.errorMessage), "Invalid pair response");
    LOG_A("Missing fields in pair response");
    return false;
  }

  strlcpy(result.userId,     resDoc["user_id"],     sizeof(result.userId));
  strlcpy(result.licenseKey, resDoc["license_key"], sizeof(result.licenseKey));
  result.success = true;

  LOG_A("Device paired — userId: %s", result.userId);
  return true;
}

bool ApiClient::reportDeviceStatus(const char* userId, const char* licenseKey,
                                   int batteryPercent, int signalStrength) {
  char url[512];
  snprintf(url, sizeof(url), "%s/api/devices/%s/status", _baseUrl, userId);

  LOG_A("Reporting device status to: %s", url);

  http.setConnectTimeout(API_REQUEST_TIMEOUT_MS);
  http.setTimeout(API_REQUEST_TIMEOUT_MS, API_REQUEST_TIMEOUT_MS);

  if (!http.begin(client, url)) {
    LOG_A("Connection failed");
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-License-Key", licenseKey);

  StaticJsonDocument<200> doc;
  doc["batteryPercent"] = batteryPercent;
  doc["signalStrength"] = signalStrength;

  String payload;
  serializeJson(doc, payload);

  int httpCode = http.POST(payload);
  http.end();

  bool success = (httpCode == 200 || httpCode == 204);
  LOG_A("Status report: HTTP %d - %s", httpCode, success ? "success" : "failed");

  return success;
}

bool ApiClient::checkForUpdates(const char* userId, const char* licenseKey,
                               const char* currentVersion, char* latestVersion,
                               char* downloadUrl, char* checksum) {
  char url[512];
  snprintf(url, sizeof(url), "%s/api/devices/%s/firmware/latest?currentVersion=%s",
           _baseUrl, userId, currentVersion);

  LOG_A("Checking for firmware updates at: %s", url);

  http.setConnectTimeout(API_REQUEST_TIMEOUT_MS);
  http.setTimeout(API_REQUEST_TIMEOUT_MS, API_REQUEST_TIMEOUT_MS);

  if (!http.begin(client, url)) {
    LOG_A("Connection failed");
    return false;
  }

  http.addHeader("X-License-Key", licenseKey);

  int httpCode = http.GET();

  if (httpCode == 204) {
    LOG_A("No firmware update available");
    http.end();
    return false;
  }

  if (httpCode != 200) {
    LOG_A("Update check failed: HTTP %d", httpCode);
    http.end();
    return false;
  }

  String payload = http.getString();
  http.end();

  StaticJsonDocument<512> doc;
  DeserializationError error = deserializeJson(doc, payload);

  if (error) {
    LOG_A("Failed to parse update response");
    return false;
  }

  if (doc.containsKey("version") && doc.containsKey("url")) {
    strlcpy(latestVersion, doc["version"], 32);
    strlcpy(downloadUrl,   doc["url"],     256);
    strlcpy(checksum,      doc["checksum"], 256);
    LOG_A("Update available: %s", latestVersion);
    return true;
  }

  LOG_A("No update available");
  return false;
}

bool ApiClient::getPreferences(const char* userId, const char* licenseKey,
                              uint32_t* refreshMinutes, int* displayMode) {
  char url[512];
  snprintf(url, sizeof(url), "%s/api/preferences", _baseUrl);

  LOG_A("Fetching preferences from: %s", url);

  http.setConnectTimeout(API_REQUEST_TIMEOUT_MS);
  http.setTimeout(API_REQUEST_TIMEOUT_MS, API_REQUEST_TIMEOUT_MS);

  if (!http.begin(client, url)) {
    LOG_A("Connection failed");
    return false;
  }

  http.addHeader("X-License-Key", licenseKey);

  int httpCode = http.GET();

  if (httpCode != 200) {
    LOG_A("Preferences fetch failed: HTTP %d", httpCode);
    http.end();
    return false;
  }

  String payload = http.getString();
  http.end();

  return parsePreferencesResponse(payload.c_str(), refreshMinutes, displayMode);
}

// ============================================================================
// Helper Functions
// ============================================================================

bool ApiClient::parseDisplayDataResponse(const char* jsonResponse, DisplayData& data) {
  StaticJsonDocument<1024> doc;
  DeserializationError error = deserializeJson(doc, jsonResponse);

  if (error) {
    LOG_A("JSON parse error: %s", error.c_str());
    return false;
  }

  if (doc.containsKey("energy")) {
    data.energy.price    = doc["energy"]["price"]    | 0.0;
    data.energy.unit     = "DKK/kWh";
    data.energy.priceMin = doc["energy"]["priceMin"] | 0.0;
    data.energy.priceMax = doc["energy"]["priceMax"] | 0.0;
  }

  if (doc.containsKey("weather")) {
    data.weather.temp        = doc["weather"]["temp"]      | 0.0;
    data.weather.feelsLike   = doc["weather"]["feelsLike"] | 0.0;
    data.weather.description = "Clear";
    data.weather.humidity    = doc["weather"]["humidity"]  | 0.0;
    data.weather.windSpeed   = doc["weather"]["windSpeed"] | 0.0;
  }

  if (doc.containsKey("news")) {
    data.news.headline = "No news available";
    data.news.source   = "NewsAPI";
  }

  data.status.batteryPercent = doc["status"]["batteryPercent"] | 100;
  data.status.signalStrength = doc["status"]["signalStrength"] | -70;
  data.status.lastUpdate     = now();

  return true;
}

bool ApiClient::parsePreferencesResponse(const char* jsonResponse, uint32_t* refreshMinutes, int* displayMode) {
  StaticJsonDocument<256> doc;
  DeserializationError error = deserializeJson(doc, jsonResponse);

  if (error) {
    LOG_A("Preferences parse error: %s", error.c_str());
    return false;
  }

  if (doc.containsKey("refreshMinutes")) {
    *refreshMinutes = doc["refreshMinutes"] | REFRESH_MINUTES;
  }

  if (doc.containsKey("displayMode")) {
    *displayMode = doc["displayMode"] | 0;
  }

  return true;
}
