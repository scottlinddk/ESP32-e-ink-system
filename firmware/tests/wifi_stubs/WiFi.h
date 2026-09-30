#pragma once
#include "Arduino.h"
#include "esp_wifi.h"
#include <cstring>

enum wl_status_t {
  WL_CONNECTED, WL_DISCONNECTED, WL_IDLE_STATUS, WL_NO_SSID_AVAIL,
  WL_CONNECT_FAILED, WL_NO_SHIELD, WL_CONNECTION_LOST
};
enum WiFiEvent_t {
  ARDUINO_EVENT_WIFI_STA_START, ARDUINO_EVENT_WIFI_STA_CONNECTED,
  ARDUINO_EVENT_WIFI_STA_GOT_IP, ARDUINO_EVENT_WIFI_STA_DISCONNECTED,
  ARDUINO_EVENT_WIFI_STA_LOST_IP
};
struct WiFiEventInfo_t { struct { uint8_t reason = 0; } wifi_sta_disconnected; };
using wifi_event_id_t = size_t;
using WiFiEventFuncCb = std::function<void(WiFiEvent_t, WiFiEventInfo_t)>;
constexpr int WIFI_STA = 1;

struct TestWiFiState {
  bool modeOk = true;
  bool hostnameOk = true;
  bool applyCredentials = true;
  bool beginConnected = false;
  wl_status_t status = WL_DISCONNECTED;
  esp_err_t getError = ESP_OK;
  esp_err_t setError = ESP_OK;
  esp_err_t connectError = ESP_OK;
  wifi_config_t configTemplate;
  wifi_config_t stationConfig;
  wifi_config_t configBeforePatch;
  wifi_config_t configAtConnection;
  int beginCalls = 0;
  int getCalls = 0;
  int setCalls = 0;
  int connectCalls = 0;
};
inline TestWiFiState testWiFi;

class WiFiClass {
public:
  WiFiEventFuncCb callback;
  int registrations = 0;
  bool mode(int) { return testWiFi.modeOk; }
  bool setHostname(const char*) { return testWiFi.hostnameOk; }
  wifi_event_id_t onEvent(WiFiEventFuncCb handler) {
    callback = handler;
    return static_cast<wifi_event_id_t>(++registrations);
  }
  wl_status_t begin(const char* ssid, const char* password, int, const uint8_t*, bool connect) {
    ++testWiFi.beginCalls;
    testWiFi.beginConnected = connect;
    if (testWiFi.applyCredentials) {
      testWiFi.stationConfig = testWiFi.configTemplate;
      std::memcpy(testWiFi.stationConfig.sta.ssid, ssid, std::strlen(ssid));
      std::memcpy(testWiFi.stationConfig.sta.password, password, std::strlen(password));
    }
    testWiFi.configBeforePatch = testWiFi.stationConfig;
    return testWiFi.status;
  }
  wl_status_t status() { return testWiFi.status; }
  bool disconnect(bool) {
    testWiFi.status = WL_DISCONNECTED;
    emitDisconnect(WIFI_REASON_ASSOC_LEAVE);
    return true;
  }
  int RSSI() { return -50; }
  struct Address { std::string toString() const { return "192.168.1.10"; } };
  Address localIP() { return {}; }
  void emitDisconnect(uint8_t reason) {
    testWiFi.status = WL_DISCONNECTED;
    WiFiEventInfo_t info;
    info.wifi_sta_disconnected.reason = reason;
    if (callback) callback(ARDUINO_EVENT_WIFI_STA_DISCONNECTED, info);
  }
  void emitGotIP() {
    testWiFi.status = WL_CONNECTED;
    if (callback) callback(ARDUINO_EVENT_WIFI_STA_GOT_IP, {});
  }
};
inline WiFiClass WiFi;
