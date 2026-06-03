#include "wifi.h"
#include "config.h"

#if DEBUG_ENABLED
#define LOG_W(fmt, ...) Serial.printf("[WiFi] " fmt "\n", ##__VA_ARGS__)
#else
#define LOG_W(fmt, ...)
#endif

WiFiManager::WiFiManager() : _ssid(nullptr), _password(nullptr) {}

bool WiFiManager::begin(const char* ssid, const char* password) {
  _ssid = ssid;
  _password = password;
  
  WiFi.mode(WIFI_STA);
  WiFi.setHostname("esp32-eink-display");
  
  // Register event callback
  WiFi.onEvent(WiFiManager::eventCallback);
  
  LOG_W("WiFi initialized for SSID: %s", ssid);
  return true;
}

bool WiFiManager::connect() {
  if (isConnected()) {
    LOG_W("Already connected to WiFi");
    return true;
  }
  
  LOG_W("Connecting to WiFi: %s", _ssid);
  WiFi.begin(_ssid, _password);
  
  return true;
}

bool WiFiManager::isConnected() {
  return WiFi.status() == WL_CONNECTED;
}

void WiFiManager::disconnect() {
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
      LOG_W("Connected! IP: %s, RSSI: %d dBm", 
            WiFi.localIP().toString().c_str(), 
            getSignalStrength());
      return true;
    }
    delay(100);
  }
  
  LOG_W("WiFi connection timeout after %d ms", timeout_ms);
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

void WiFiManager::eventCallback(WiFiEvent_t event) {
  switch (event) {
    case SYSTEM_EVENT_STA_START:
      LOG_W("WiFi: Station started");
      break;
    case SYSTEM_EVENT_STA_CONNECTED:
      LOG_W("WiFi: Connected to network");
      break;
    case SYSTEM_EVENT_STA_GOT_IP:
      LOG_W("WiFi: Got IP address");
      break;
    case SYSTEM_EVENT_STA_DISCONNECTED:
      LOG_W("WiFi: Disconnected from network");
      break;
    case SYSTEM_EVENT_STA_LOST_IP:
      LOG_W("WiFi: Lost IP address");
      break;
    default:
      break;
  }
}
