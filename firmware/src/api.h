#pragma once
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
struct FrameResult {
  int httpCode = 0;
  int length = 0;
  uint32_t retrySeconds = 60;
  uint32_t receivedAt = 0;
  char hash[65] = {};
  char error[128] = {};
};
class ApiClient {
public:
  ApiClient();
  FrameResult fetchFrame(const char* baseUrl, const char* deviceId, const char* token,
                         const char* appliedHash, uint8_t* buffer, size_t capacity);
  bool heartbeat(const char* baseUrl, const char* deviceId, const char* token,
                 const char* appliedHash, int rssi);
private:
  WiFiClientSecure client;
  bool begin(HTTPClient& http, const char* baseUrl, const char* deviceId,
             const char* token, const char* endpoint);
};
