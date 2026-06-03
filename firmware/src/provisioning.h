#pragma once

#include <Arduino.h>
#include <Preferences.h>
#include <WiFi.h>
#include <DNSServer.h>
#include <ESPAsyncWebServer.h>

class ProvisioningManager {
public:
  ProvisioningManager();

  bool hasCredentials();

  void loadCredentials(char* ssid, size_t ssidLen,
                       char* pass, size_t passLen,
                       char* apiUrl, size_t apiUrlLen,
                       char* userId, size_t userIdLen,
                       char* licenseKey, size_t licenseKeyLen);

  void saveCredentials(const char* ssid, const char* pass, const char* apiUrl);
  void saveUserCredentials(const char* userId, const char* licenseKey);

  void startProvisioningAP();
  void clearCredentials();

private:
  Preferences _prefs;
  DNSServer _dns;
  AsyncWebServer _server;
  volatile bool _done;

  String _buildFormPage();
};
