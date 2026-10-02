#include "provisioning.h"
#include "config.h"
#include "feed_validation.h"

namespace {
String escapeHtml(String value) {
  value.replace("&", "&amp;");
  value.replace("<", "&lt;");
  value.replace(">", "&gt;");
  value.replace("\"", "&quot;");
  value.replace("'", "&#39;");
  return value;
}
}

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
  if (prefs.putBool("complete", false) != 1) { prefs.end(); return false; }
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

String ProvisioningManager::formPage(const char* failureReason) {
  String page = F("<!doctype html><html><head><meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'><title>Display setup</title>"
    "<style>body{font:16px sans-serif;max-width:460px;margin:32px auto;padding:16px}"
    "label{display:block;margin:16px 0}input,button{box-sizing:border-box;width:100%;padding:10px;margin-top:6px}"
    "input[type=checkbox]{width:auto;margin-right:8px}.error{padding:12px;border:2px solid #a22}</style>"
    "</head><body><h1>Display setup</h1>");
  if (failureReason && *failureReason) {
    page += F("<div role='alert' class='error'><strong>Connection failed</strong><p>");
    page += escapeHtml(failureReason);
    page += F("</p><p>Your saved settings are still stored. Re-enter all settings below if they need changing.</p></div>");
  }
  page += F("<p>First register a device on the dashboard and create its token under Automatic updates.</p>"
    "<form method='post' action='/save'><label>2.4 GHz Wi-Fi network<input name='ssid' maxlength='32' required></label>"
    "<label>Wi-Fi password<input id='wifi-password' type='password' name='pass' maxlength='64' autocomplete='new-password'></label>"
    "<label><input type='checkbox' onchange=\"document.getElementById('wifi-password').type=this.checked?'text':'password'\">Show Wi-Fi password</label>"
    "<label>API base URL<input type='url' name='apiUrl' maxlength='191' placeholder='https://your-host.example/api' value='");
  // Escape the build-time default before inserting it into an HTML attribute.
  page += escapeHtml(PROVISION_DEFAULT_API_URL);
  page += F("' required></label><label>Device UUID<input name='deviceId' minlength='36' maxlength='36' required></label>"
    "<label>Device token<input type='password' name='token' minlength='49' maxlength='49' placeholder='einkd_...' autocomplete='new-password' required></label>"
    "<button>Save and restart</button></form><p>Select 250 × 122 with rotation 0 on the dashboard.</p>"
    "<p>Setup is a local Wi-Fi connection. Keep the unit nearby and power it off when finished if you are not saving settings.</p></body></html>");
  return page;
}

void ProvisioningManager::startProvisioningAP(uint32_t timeoutSeconds, const char* failureReason, void (*setupLoop)()) {
  done = false;
  char name[32] = {};
  IPAddress ip(192, 168, 4, 1);
  bool apReady = false;
  for (unsigned int attempt = 1; attempt <= 3; ++attempt) {
    if (!WiFi.mode(WIFI_AP)) {
      Serial.printf("[Setup] Attempt %u/3: could not enable access point mode\n", attempt);
    } else if (!WiFi.softAPConfig(ip, ip, IPAddress(255, 255, 255, 0))) {
      Serial.printf("[Setup] Attempt %u/3: could not configure access point address\n", attempt);
    } else {
      uint8_t mac[6] = {};
      WiFi.softAPmacAddress(mac);
      snprintf(name, sizeof(name), "ESP32-Display-%02X%02X%02X", mac[3], mac[4], mac[5]);
      if (WiFi.softAP(name) && static_cast<uint32_t>(WiFi.softAPIP()) != 0) {
        apReady = true;
        break;
      }
      Serial.printf("[Setup] Attempt %u/3: could not start access point\n", attempt);
    }
    WiFi.softAPdisconnect(true);
    if (attempt < 3) delay(500);
  }
  if (!apReady) {
    Serial.println("[Setup] Access point unavailable after 3 attempts; restarting in 5 seconds");
    delay(5000);
    ESP.restart();
    return;
  }
  const IPAddress actualIp = WiFi.softAPIP();
  const String setupUrl = "http://" + actualIp.toString() + "/";
  const bool dnsReady = dns.start(53, "*", actualIp);
  if (!dnsReady) Serial.printf("[Setup] Captive DNS unavailable; open %s directly\n", setupUrl.c_str());
  if (failureReason && *failureReason) Serial.printf("[Setup] Previous connection failed: %s\n", failureReason);
  String page = formPage(failureReason);
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
    Serial.println("[Setup] Settings stored; restarting to test Wi-Fi and device delivery");
    req->send(200, "text/html", "<!doctype html><html><head><meta charset='utf-8'>"
      "<meta name='viewport' content='width=device-width,initial-scale=1'><title>Settings saved</title></head>"
      "<body><h1>Settings saved</h1><p>The display will restart. Your settings are stored, but the Wi-Fi connection and device token have not been verified yet.</p>"
      "<p>Reconnect your computer or phone to your normal Wi-Fi. On the dashboard, open Devices &rarr; Automatic updates and check Last report.</p>"
      "<p>If no report appears, open the USB installer's Logs &amp; Console at 115200 baud and reset the display. If the setup network returns, reconnect to it to see the connection error and enter your settings again.</p>"
      "<p>This page will not update after the display restarts.</p></body></html>");
    done = true;
  });
  server.onNotFound([setupUrl](AsyncWebServerRequest* req) { req->redirect(setupUrl); });
  server.begin();
  Serial.printf("[Setup] Connect to %s and open %s (stay connected without internet)\n", name, setupUrl.c_str());
  const uint32_t started = millis();
  while (!done) {
    if (setupLoop) setupLoop();
    if (dnsReady) dns.processNextRequest();
    if (timeoutSeconds && millis() - started >= timeoutSeconds * 1000UL) {
      Serial.println("[Setup] Setup timeout; restarting with stored settings");
      break;
    }
    delay(10);
  }
  delay(1000);
  ESP.restart();
}
