#include "wifi_manager.h"
#include "config.h"
#include <esp_wifi.h>
#include <cstring>

#if DEBUG_ENABLED
#define LOG_W(fmt, ...) Serial.printf("[WiFi] " fmt "\n", ##__VA_ARGS__)
#else
#define LOG_W(fmt, ...)
#endif

std::atomic<uint32_t> WiFiManager::_disconnectState{0};
wifi_event_id_t WiFiManager::_eventId = 0;

namespace {
constexpr uint32_t CAPTURE_DISCONNECTS = 1UL << 16;
constexpr uint32_t DISCONNECT_REASON_MASK = 0xFFFF;
// Maximum-length SSIDs and PSKs fill their arrays without a terminating NUL.
bool credentialMatches(const uint8_t* stored, size_t capacity, const char* expected) {
  const size_t length = std::strlen(expected);
  return length <= capacity && std::memcmp(stored, expected, length) == 0 &&
    (length == capacity || stored[length] == 0);
}
}

WiFiManager::WiFiManager()
  : _ssid(nullptr), _password(nullptr), _connectionError(nullptr), _initialized(false) {}

bool WiFiManager::begin(const char* ssid, const char* password) {
  _ssid = ssid;
  _password = password ? password : "";
  _connectionError = nullptr;
  _initialized = false;
  _disconnectState.store(0);
  if (!_ssid || !_ssid[0] || std::strlen(_ssid) > 32 || std::strlen(_password) > 64) {
    _connectionError = "Wi-Fi settings are invalid. Check the network name and password length.";
    return false;
  }
  if (!_eventId) _eventId = WiFi.onEvent(WiFiManager::eventCallback);
  if (!_eventId || !WiFi.setHostname("esp32-eink-display") || !WiFi.mode(WIFI_STA)) {
    _connectionError = "The Wi-Fi station could not be initialized. Restart the device and try again.";
    return false;
  }
  _initialized = true;
  LOG_W("Wi-Fi station initialized");
  return true;
}

bool WiFiManager::connect() {
  if (!_initialized) {
    if (!_connectionError) _connectionError = "Wi-Fi has not been initialized. Restart the device.";
    return false;
  }
  _connectionError = nullptr;
  _disconnectState.store(0);
  if (isConnected()) {
    LOG_W("Already connected to WiFi");
    return true;
  }
  
  // Arduino 2.0.17 zeroes sae_pwe_h2e when configuring credentials. Defer the
  // connection so IDF 4.4.7 can negotiate either SAE method (AR2026-003 issue 4.1).
  // begin(false) returns current status, possibly a stale failure from a prior
  // attempt, so verify its configuration instead of interpreting that status.
  WiFi.begin(_ssid, _password, 0, nullptr, false);
  wifi_config_t config{};
  esp_err_t error = esp_wifi_get_config(WIFI_IF_STA, &config);
  if (error != ESP_OK) {
    LOG_W("Cannot read station configuration: %s", esp_err_to_name(error));
    _connectionError = "Wi-Fi settings could not be read. Restart the device and try again.";
    return false;
  }
  if (!credentialMatches(config.sta.ssid, sizeof(config.sta.ssid), _ssid) ||
      !credentialMatches(config.sta.password, sizeof(config.sta.password), _password)) {
    _connectionError = "Wi-Fi settings could not be applied. Save the network settings again.";
    LOG_W("Station configuration does not match the requested credentials");
    return false;
  }
  // Preserve Arduino's PMF policy, minimum authentication level and scan options.
  config.sta.sae_pwe_h2e = WPA3_SAE_PWE_BOTH;
  error = esp_wifi_set_config(WIFI_IF_STA, &config);
  if (error != ESP_OK) {
    LOG_W("Cannot apply station configuration: %s", esp_err_to_name(error));
    _connectionError = "Wi-Fi security settings could not be applied. Restart the device and try again.";
    return false;
  }
  _disconnectState.store(CAPTURE_DISCONNECTS);
  error = esp_wifi_connect();
  if (error != ESP_OK) {
    _disconnectState.fetch_and(DISCONNECT_REASON_MASK);
    LOG_W("Cannot start station connection: %s", esp_err_to_name(error));
    _connectionError = "The Wi-Fi connection could not be started. Restart the device and try again.";
    return false;
  }
  LOG_W("Connecting with WPA2/WPA3 support; SAE methods: both");
  return true;
}

bool WiFiManager::isConnected() {
  return WiFi.status() == WL_CONNECTED;
}

void WiFiManager::disconnect() {
  _disconnectState.fetch_and(DISCONNECT_REASON_MASK);
  WiFi.disconnect(true);  // true = turn off radio
  LOG_W("WiFi disconnected");
}

int WiFiManager::getSignalStrength() {
  return WiFi.RSSI();
}

bool WiFiManager::waitForConnection(uint32_t timeout_ms) {
  uint32_t start = millis();
  
  while (millis() - start < timeout_ms) {
    if (isConnected()) {
      _disconnectState.store(0);
      LOG_W("Connected! IP: %s, RSSI: %d dBm", 
            WiFi.localIP().toString().c_str(), 
            getSignalStrength());
      return true;
    }
    delay(100);
  }
  
  _disconnectState.fetch_and(DISCONNECT_REASON_MASK);
  LOG_W("Wi-Fi connection timeout after %lu ms: %s", static_cast<unsigned long>(timeout_ms), getConnectionError());
  return false;
}

const char* WiFiManager::getStatusString() {
  switch (WiFi.status()) {
    case WL_CONNECTED:
      return "Connected";
    case WL_DISCONNECTED:
      return "Disconnected";
    case WL_IDLE_STATUS:
      return "Idle";
    case WL_NO_SSID_AVAIL:
      return "SSID not found";
    case WL_CONNECT_FAILED:
      return "Connection failed";
    case WL_NO_SHIELD:
      return "No WiFi shield";
    default:
      return "Unknown";
  }
}

const char* WiFiManager::getConnectionError() const {
  if (_connectionError) return _connectionError;
  if (WiFi.status() == WL_CONNECTED) return "";
  switch (_disconnectState.load() & DISCONNECT_REASON_MASK) {
    case WIFI_REASON_AUTH_FAIL:
      return "Authentication was rejected by the router. Check the saved password and WPA2/WPA3 settings.";
    case WIFI_REASON_NO_AP_FOUND:
      return "The Wi-Fi network was not found. Check its name, 2.4 GHz availability, and signal.";
    case WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT:
    case WIFI_REASON_HANDSHAKE_TIMEOUT:
      return "The Wi-Fi security handshake timed out. Check the saved password, router security settings, and signal.";
    case 0:
      return "The Wi-Fi connection timed out. Check router availability, signal, and DHCP settings.";
    default:
      return "Wi-Fi disconnected before an IP address was obtained. Check router settings and signal; the serial log has the reason code.";
  }
}

void WiFiManager::recordDisconnectReason(uint32_t reason) {
  uint32_t state = _disconnectState.load();
  // A timeout/disconnect can freeze the result concurrently with this callback.
  // Compare/exchange prevents an event already in progress from changing it.
  while (state & CAPTURE_DISCONNECTS) {
    if (_disconnectState.compare_exchange_weak(state, CAPTURE_DISCONNECTS | reason)) return;
  }
}

void WiFiManager::eventCallback(WiFiEvent_t event, WiFiEventInfo_t info) {
  switch (event) {
    case ARDUINO_EVENT_WIFI_STA_START:
      LOG_W("WiFi: Station started");
      break;
    case ARDUINO_EVENT_WIFI_STA_CONNECTED:
      LOG_W("WiFi: Connected to network");
      break;
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      recordDisconnectReason(0);
      LOG_W("WiFi: Got IP address");
      break;
    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
      // Arduino also emits ASSOC_LEAVE while retrying. Do not replace the actual
      // failure with an intentional disconnect, or with later setup-AP events.
      if (info.wifi_sta_disconnected.reason != WIFI_REASON_ASSOC_LEAVE)
        recordDisconnectReason(info.wifi_sta_disconnected.reason);
      LOG_W("Wi-Fi disconnected; reason %u", static_cast<unsigned>(info.wifi_sta_disconnected.reason));
      break;
    case ARDUINO_EVENT_WIFI_STA_LOST_IP:
      LOG_W("WiFi: Lost IP address");
      break;
    default:
      break;
  }
}
