#pragma once
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
struct FrameResult {
  int httpCode = 0;
  int length = 0;
  uint32_t retrySeconds = 60;
  uint32_t receivedAt = 0;
  char hash[65] = {};
  char refreshRequestId[37] = {};
  char error[128] = {};
  int instantUpdates = -1;  // feed::instantMode(): -1 means not reported
};
struct RefreshCheck {
  int httpCode = 0;
  bool pending = false;     // Fetch the frame now; it carries the validated request ID.
  int instantUpdates = -1;
  uint32_t retrySeconds = 5;
};
class ApiClient {
public:
  ApiClient();
  FrameResult fetchFrame(const char* baseUrl, const char* deviceId, const char* token,
                         const char* appliedHash, uint8_t* buffer, size_t capacity);
  RefreshCheck checkRefreshRequest(const char* baseUrl, const char* deviceId, const char* token);
  // Clock fallback when NTP is blocked: the Date (+ Age) header of the
  // unauthenticated /api/health route, over the same CA-verified TLS client.
  // No device credential is sent. True and *epoch set only for a sane date.
  bool fetchServerTime(const char* baseUrl, uint32_t* epoch);
  bool heartbeat(const char* baseUrl, const char* deviceId, const char* token,
                 const char* appliedHash, int rssi, const char* refreshRequestId = nullptr,
                 int batteryPercent = -1);
private:
  WiFiClientSecure client;
  static String apiBase(const char* baseUrl);
  bool begin(HTTPClient& http, const char* baseUrl, const char* deviceId,
             const char* token, const char* endpoint);
};
