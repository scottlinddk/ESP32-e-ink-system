#include "provisioning.h"
#include "config.h"
#include "feed_validation.h"

ProvisioningManager::ProvisioningManager() : server(80), done(false) {}

bool ProvisioningManager::loadCredentials(DeviceCredentials& c) {
  // Separate namespace: legacy account/license credentials are not delivery tokens.
  if (!prefs.begin("eink-feed", true)) return false;
  strlcpy(c.ssid, prefs.getString("ssid", "").c_str(), sizeof(c.ssid));
  strlcpy(c.password, prefs.getString("pass", "").c_str(), sizeof(c.password));
  strlcpy(c.apiUrl, prefs.getString("api", "").c_str(), sizeof(c.apiUrl));
  strlcpy(c.deviceId, prefs.getString("device", "").c_str(), sizeof(c.deviceId));
  strlcpy(c.token, prefs.getString("token", "").c_str(), sizeof(c.token));
  bool complete = prefs.getBool("complete", false);
  prefs.end();
  return complete && strlen(c.ssid) && feed::validBaseUrl(c.apiUrl) && feed::validDeviceId(c.deviceId) && feed::validToken(c.token);
}

bool ProvisioningManager::saveCredentials(const DeviceCredentials& c) {
  if (!prefs.begin("eink-feed", false)) return false;
  prefs.putBool("complete", false);
  bool saved = prefs.putString("ssid", c.ssid) == strlen(c.ssid)
    && prefs.putString("api", c.apiUrl) == strlen(c.apiUrl)
    && prefs.putString("device", c.deviceId) == strlen(c.deviceId)
    && prefs.putString("token", c.token) == strlen(c.token);
  prefs.putString("pass", c.password);
  saved = saved && prefs.getString("pass", "") == c.password;
  if (saved) saved = prefs.putBool("complete", true) == 1;
  prefs.end();
  return saved;
}

String ProvisioningManager::formPage() {
  String page = F("<!doctype html><html><head><meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'><title>Display setup</title>"
    "<style>body{font:16px sans-serif;max-width:460px;margin:32px auto;padding:16px}"
    "label{display:block;margin:16px 0}input,button{box-sizing:border-box;width:100%;padding:10px;margin-top:6px}</style>"
    "</head><body><h1>Display setup</h1><p>First register a device on the dashboard and create its token under Automatic updates.</p>"
    "<form method='post' action='/save'><label>2.4 GHz Wi-Fi network<input name='ssid' maxlength='32' required></label>"
    "<label>Wi-Fi password<input type='password' name='pass' maxlength='64' autocomplete='new-password'></label>"
    "<label>API base URL<input type='url' name='apiUrl' maxlength='191' placeholder='https://your-host.example/api' value='");
  // Escape the build-time default before inserting it into an HTML attribute.
  String base = PROVISION_DEFAULT_API_URL;
  base.replace("&", "&amp;"); base.replace("'", "&#39;"); base.replace("<", "&lt;"); base.replace("\"", "&quot;");
  page += base;
  page += F("' required></label><label>Device UUID<input name='deviceId' minlength='36' maxlength='36' required></label>"
    "<label>Device token<input type='password' name='token' minlength='49' maxlength='49' placeholder='einkd_...' autocomplete='new-password' required></label>"
    "<button>Save and restart</button></form><p>Select 250 × 122 with rotation 0 on the dashboard.</p>"
    "<p>Setup is a local Wi-Fi connection. Keep the unit nearby and power it off when finished if you are not saving settings.</p></body></html>");
  return page;
}

void ProvisioningManager::startProvisioningAP(uint32_t timeoutSeconds) {
  done = false;
  WiFi.mode(WIFI_AP);
  uint8_t mac[6];
  WiFi.softAPmacAddress(mac);
  char name[32];
  snprintf(name, sizeof(name), "ESP32-Display-%02X%02X%02X", mac[3], mac[4], mac[5]);
  IPAddress ip(192, 168, 4, 1);
  WiFi.softAPConfig(ip, ip, IPAddress(255, 255, 255, 0));
  WiFi.softAP(name);
  dns.start(53, "*", ip);
  Serial.printf("[Setup] Connect to %s and open http://192.168.4.1\n", name);
  String page = formPage();
  server.on("/", HTTP_GET, [page](AsyncWebServerRequest* req) { req->send(200, "text/html", page); });
  server.on("/save", HTTP_POST, [this](AsyncWebServerRequest* req) {
    const char* required[] = {"ssid", "apiUrl", "deviceId", "token"};
    for (const char* name : required) {
      if (!req->hasParam(name, true)) { req->send(400, "text/plain", "Missing required fields"); return; }
    }
    String ssid = req->getParam("ssid", true)->value();
    String pass = req->hasParam("pass", true) ? req->getParam("pass", true)->value() : "";
    String base = req->getParam("apiUrl", true)->value(); base.trim();
    String id = req->getParam("deviceId", true)->value(); id.trim();
    String token = req->getParam("token", true)->value(); token.trim();
    if (!ssid.length() || ssid.length() > 32 || pass.length() > 64 ||
        !feed::validBaseUrl(base.c_str()) || !feed::validDeviceId(id.c_str()) || !feed::validToken(token.c_str())) {
      req->send(400, "text/plain", "Check SSID, HTTPS API origin (optionally /api), device UUID and device token."); return;
    }
    DeviceCredentials c;
    strlcpy(c.ssid, ssid.c_str(), sizeof(c.ssid));
    strlcpy(c.password, pass.c_str(), sizeof(c.password));
    strlcpy(c.apiUrl, base.c_str(), sizeof(c.apiUrl));
    strlcpy(c.deviceId, id.c_str(), sizeof(c.deviceId));
    strlcpy(c.token, token.c_str(), sizeof(c.token));
    if (!saveCredentials(c)) { req->send(500, "text/plain", "Could not save settings. Try again."); return; }
    req->send(200, "text/html", "<h1>Saved</h1><p>Display restarting. Reconnect to your home Wi-Fi.</p>");
    done = true;
  });
  server.onNotFound([](AsyncWebServerRequest* req) { req->redirect("http://192.168.4.1/"); });
  server.begin();
  const uint32_t started = millis();
  while (!done) {
    dns.processNextRequest();
    if (timeoutSeconds && millis() - started >= timeoutSeconds * 1000UL) break;
    delay(10);
  }
  delay(1000);
  ESP.restart();
}
