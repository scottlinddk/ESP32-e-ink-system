#include "provisioning.h"
#include "config.h"

#ifndef PROVISION_DEFAULT_API_URL
#define PROVISION_DEFAULT_API_URL "https://your-api.vercel.app"
#endif

#define PROV_NS "esp32disp"

#if DEBUG_ENABLED
#define LOG_P(fmt, ...) Serial.printf("[Prov] " fmt "\n", ##__VA_ARGS__)
#else
#define LOG_P(fmt, ...)
#endif

ProvisioningManager::ProvisioningManager() : _server(80), _done(false) {}

bool ProvisioningManager::hasCredentials() {
  _prefs.begin(PROV_NS, true);
  String ssid = _prefs.getString("ssid", "");
  String apiUrl = _prefs.getString("apiUrl", "");
  _prefs.end();
  return ssid.length() > 0 && apiUrl.length() > 0;
}

void ProvisioningManager::loadCredentials(char* ssid, size_t ssidLen,
                                           char* pass, size_t passLen,
                                           char* apiUrl, size_t apiUrlLen,
                                           char* userId, size_t userIdLen,
                                           char* licenseKey, size_t licenseKeyLen) {
  _prefs.begin(PROV_NS, true);
  strlcpy(ssid,       _prefs.getString("ssid",   "").c_str(),                       ssidLen);
  strlcpy(pass,       _prefs.getString("pass",   "").c_str(),                       passLen);
  strlcpy(apiUrl,     _prefs.getString("apiUrl", PROVISION_DEFAULT_API_URL).c_str(), apiUrlLen);
  strlcpy(userId,     _prefs.getString("userId", "").c_str(),                       userIdLen);
  strlcpy(licenseKey, _prefs.getString("licKey", "").c_str(),                       licenseKeyLen);
  _prefs.end();
}

void ProvisioningManager::saveCredentials(const char* ssid, const char* pass, const char* apiUrl) {
  _prefs.begin(PROV_NS, false);
  _prefs.putString("ssid",   ssid);
  _prefs.putString("pass",   pass);
  _prefs.putString("apiUrl", apiUrl);
  _prefs.end();
  LOG_P("WiFi credentials saved");
}

void ProvisioningManager::saveUserCredentials(const char* userId, const char* licenseKey) {
  _prefs.begin(PROV_NS, false);
  _prefs.putString("userId", userId);
  _prefs.putString("licKey", licenseKey);
  _prefs.end();
  LOG_P("User credentials saved: userId=%s", userId);
}

void ProvisioningManager::clearCredentials() {
  _prefs.begin(PROV_NS, false);
  _prefs.clear();
  _prefs.end();
  LOG_P("All credentials cleared");
}

String ProvisioningManager::_buildFormPage() {
  String page = F("<!DOCTYPE html>"
    "<html><head>"
    "<meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>ESP32 Display Setup</title>"
    "<style>"
    "body{font-family:sans-serif;max-width:400px;margin:40px auto;padding:0 16px;background:#f5f5f5}"
    "h1{color:#333;font-size:1.4em}"
    "label{display:block;margin-top:12px;font-weight:600;color:#555}"
    "input{width:100%;padding:8px;margin-top:4px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box;font-size:1em}"
    "button{margin-top:20px;width:100%;padding:12px;background:#4CAF50;color:#fff;border:none;border-radius:4px;font-size:1.1em;cursor:pointer}"
    "button:hover{background:#45a049}"
    ".note{font-size:.85em;color:#777;margin-top:8px}"
    "</style></head><body>"
    "<h1>ESP32 Display Setup</h1>"
    "<p>Enter your WiFi credentials to connect your display.</p>"
    "<form method='POST' action='/save'>"
    "<label>WiFi Network (SSID)<input type='text' name='ssid' placeholder='YourNetworkName' required></label>"
    "<label>WiFi Password<input type='password' name='pass' placeholder='YourPassword'></label>"
    "<label>API URL<input type='text' name='apiUrl' value='");
  page += PROVISION_DEFAULT_API_URL;
  page += F("' required></label>"
    "<button type='submit'>Save &amp; Connect</button>"
    "</form>"
    "<p class='note'>After saving, the device will restart and connect to your network automatically.</p>"
    "</body></html>");
  return page;
}

void ProvisioningManager::startProvisioningAP() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char apName[32];
  snprintf(apName, sizeof(apName), "ESP32-Display-%02X%02X%02X", mac[3], mac[4], mac[5]);

  LOG_P("Starting captive-portal AP: %s", apName);

  WiFi.mode(WIFI_AP);
  WiFi.softAP(apName);

  IPAddress apIP(192, 168, 4, 1);
  WiFi.softAPConfig(apIP, apIP, IPAddress(255, 255, 255, 0));

  _dns.start(53, "*", apIP);

  String formPage = _buildFormPage();

  // Captive portal probes (Android / iOS / Windows)
  auto redirect = [](AsyncWebServerRequest* req) {
    req->redirect("http://192.168.4.1/");
  };
  _server.on("/generate_204",       HTTP_GET, redirect);
  _server.on("/hotspot-detect.html",HTTP_GET, redirect);
  _server.on("/fwlink",             HTTP_GET, redirect);
  _server.on("/ncsi.txt",           HTTP_GET, redirect);
  _server.on("/connecttest.txt",    HTTP_GET, redirect);

  _server.on("/", HTTP_GET, [formPage](AsyncWebServerRequest* req) {
    req->send(200, "text/html", formPage);
  });

  _server.on("/save", HTTP_POST, [this](AsyncWebServerRequest* req) {
    if (!req->hasParam("ssid", true) || !req->hasParam("apiUrl", true)) {
      req->send(400, "text/plain", "Missing required fields");
      return;
    }

    String ssid   = req->getParam("ssid",   true)->value();
    String pass   = req->hasParam("pass", true) ? req->getParam("pass", true)->value() : "";
    String apiUrl = req->getParam("apiUrl", true)->value();

    if (ssid.length() == 0 || apiUrl.length() == 0) {
      req->send(400, "text/plain", "SSID and API URL are required");
      return;
    }

    saveCredentials(ssid.c_str(), pass.c_str(), apiUrl.c_str());
    LOG_P("Credentials received, restarting...");

    req->send(200, "text/html",
      "<html><body><h2>Saved! Device is restarting...</h2>"
      "<p>Please reconnect to your home WiFi network.</p></body></html>");

    _done = true;
  });

  _server.onNotFound([](AsyncWebServerRequest* req) {
    req->redirect("http://192.168.4.1/");
  });

  _server.begin();
  LOG_P("Captive portal running at http://192.168.4.1");

  while (!_done) {
    _dns.processNextRequest();
    delay(10);
  }

  delay(500);
  ESP.restart();
}
