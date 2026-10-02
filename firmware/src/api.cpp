#include "api.h"
#include "config.h"
#include "tls_roots.h"
#include "feed_validation.h"
#include <ArduinoJson.h>
#include <mbedtls/sha256.h>

ApiClient::ApiClient() {
  client.setCACert(DEVICE_ROOT_CA);
  client.setHandshakeTimeout(15);
}

bool ApiClient::begin(HTTPClient& http, const char* baseUrl, const char* deviceId,
                      const char* token, const char* endpoint) {
  if (!feed::validBaseUrl(baseUrl) || !feed::validDeviceId(deviceId) || !feed::validToken(token)) return false;
  String base(baseUrl);
  while (base.endsWith("/")) base.remove(base.length() - 1);
  if (!base.endsWith("/api")) base += "/api";
  http.setConnectTimeout(API_REQUEST_TIMEOUT_MS);
  http.setTimeout(API_REQUEST_TIMEOUT_MS);
  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  // HTTP/1.0 avoids chunked transfer encoding and bounds the BMP reader.
  http.useHTTP10(true);
  if (!http.begin(client, base + "/device-feed/" + deviceId + endpoint)) return false;
  http.addHeader("Authorization", String("Bearer ") + token);
  return true;
}

FrameResult ApiClient::fetchFrame(const char* baseUrl, const char* deviceId, const char* token,
                                 const char* appliedHash, uint8_t* buffer, size_t capacity) {
  FrameResult result;
  result.receivedAt = millis();
  HTTPClient http;
  if (!begin(http, baseUrl, deviceId, token, "/frame?format=bmp")) {
    strlcpy(result.error, "Invalid device configuration", sizeof(result.error));
    return result;
  }
  const char* headers[] = {"Retry-After", "X-Image-SHA256", "X-Display-Width", "X-Display-Height",
    "X-Display-Rotation", "X-Display-Row-Bytes", "X-Display-Encoding", "X-Refresh-Mode", "X-Refresh-Request-ID", "Content-Type", "Transfer-Encoding"};
  http.collectHeaders(headers, sizeof(headers) / sizeof(headers[0]));
  if (feed::validHash(appliedHash)) http.addHeader("If-None-Match", String('"') + appliedHash + '"');
  result.httpCode = http.GET();
  result.receivedAt = millis();
  result.retrySeconds = feed::retrySeconds(http.header("Retry-After").c_str());
  if (result.httpCode == 204 || (result.httpCode == 304 && feed::validHash(appliedHash))) {
    http.end();
    return result;
  }
  if (result.httpCode != 200) {
    snprintf(result.error, sizeof(result.error), "Frame request failed (HTTP %d)", result.httpCode);
    http.end();
    return result;
  }
  // Only a successful full-frame response can request a physical refresh.
  // Ignore this header on quiet/unchanged responses; they cannot prove an apply.
  String requestId = http.header("X-Refresh-Request-ID");
  if (requestId.length() && !feed::validDeviceId(requestId.c_str())) {
    strlcpy(result.error, "Invalid refresh request ID", sizeof(result.error));
    http.end();
    return result;
  }
  String hash = http.header("X-Image-SHA256");
  if (!feed::validHash(hash.c_str()) || http.header("X-Display-Width") != "250" ||
      http.header("X-Display-Height") != "122" || http.header("X-Display-Rotation") != "0" ||
      http.header("X-Display-Row-Bytes") != "32" || http.header("X-Display-Encoding") != "mono-msb-white1" ||
      http.header("X-Refresh-Mode") != "full" || !http.header("Content-Type").startsWith("image/bmp") ||
      http.header("Transfer-Encoding").length()) {
    strlcpy(result.error, "Unsupported frame: select 250x122, rotation 0", sizeof(result.error));
    http.end();
    return result;
  }
  const int expected = http.getSize();
  if (expected < 62 || static_cast<size_t>(expected) > capacity) {
    strlcpy(result.error, "Invalid frame length", sizeof(result.error));
    http.end();
    return result;
  }
  WiFiClient* stream = http.getStreamPtr();
  size_t received = 0;
  const uint32_t start = millis();
  while (received < static_cast<size_t>(expected) && millis() - start < API_REQUEST_TIMEOUT_MS) {
    const int available = stream->available();
    if (available > 0) {
      const int count = stream->read(buffer + received, min(static_cast<size_t>(available), static_cast<size_t>(expected) - received));
      if (count > 0) received += count;
    } else if (!http.connected()) break;
    else delay(1);
  }
  http.end();
  if (received != static_cast<size_t>(expected)) {
    strlcpy(result.error, "Incomplete frame download", sizeof(result.error));
    return result;
  }
  uint8_t digest[32];
  mbedtls_sha256_ret(buffer, received, digest, 0);
  for (size_t i = 0; i < sizeof(digest); i++) snprintf(result.hash + i * 2, 3, "%02x", digest[i]);
  if (strcmp(result.hash, hash.c_str()) != 0) {
    result.hash[0] = 0;
    strlcpy(result.error, "Frame checksum mismatch", sizeof(result.error));
    return result;
  }
  strlcpy(result.refreshRequestId, requestId.c_str(), sizeof(result.refreshRequestId));
  result.length = expected;
  return result;
}

bool ApiClient::heartbeat(const char* baseUrl, const char* deviceId, const char* token,
                          const char* appliedHash, int rssi, const char* refreshRequestId) {
  HTTPClient http;
  if (!begin(http, baseUrl, deviceId, token, "/heartbeat")) return false;
  JsonDocument doc;
  doc["firmware_version"] = FIRMWARE_VERSION;
  doc["rssi"] = constrain(rssi, -150, 0);
  // A failed/unknown frame must clear an older acknowledgement on the server.
  // Deploy the API's nullable last_applied_hash contract before this firmware.
  if (feed::validHash(appliedHash)) doc["last_applied_hash"] = appliedHash;
  else doc["last_applied_hash"] = nullptr;
  if (feed::validHash(appliedHash) && feed::validDeviceId(refreshRequestId)) doc["refresh_request_id"] = refreshRequestId;
  String payload;
  serializeJson(doc, payload);
  http.addHeader("Content-Type", "application/json");
  int status = http.POST(payload);
  http.end();
  return status == 200;
}
