#pragma once
#include <Arduino.h>
#include <Preferences.h>
#include <WiFi.h>
#include <DNSServer.h>
#include <ESPAsyncWebServer.h>

struct DeviceCredentials {
  char ssid[33] = {};
  char password[65] = {};
  char apiUrl[192] = {};
  char deviceId[37] = {};
  char token[50] = {};
};
class ProvisioningManager {
public:
  ProvisioningManager();
  bool loadCredentials(DeviceCredentials& credentials);
  void startProvisioningAP(uint32_t timeoutSeconds = 0, const char* failureReason = nullptr,
    void (*setupLoop)() = nullptr);
private:
  Preferences prefs;
  DNSServer dns;
  AsyncWebServer server;
  volatile bool done;
  String formPage(const char* failureReason);
  bool saveCredentials(const DeviceCredentials& credentials);
};
