#include "../src/wifi_manager.h"
#include <cassert>
#include <cstring>
#include <string>

namespace {
constexpr char SSID[] = "network-name";
constexpr char PASSWORD[] = "private-test-password";

void resetRadio() {
  testWiFi = TestWiFiState{};
  testMillis = 0;
  testDelayHook = {};
  Serial.output.clear();
}
bool contains(const char* message, const char* text) {
  return std::strstr(message, text) != nullptr;
}
void assertNoSecrets() {
  assert(Serial.output.find(PASSWORD) == std::string::npos);
}
void assertSecurityPreserved() {
  const auto& before = testWiFi.configBeforePatch.sta;
  const auto& after = testWiFi.configAtConnection.sta;
  assert(after.sae_pwe_h2e == WPA3_SAE_PWE_BOTH);
  assert(after.pmf_cfg.capable == before.pmf_cfg.capable);
  assert(after.pmf_cfg.required == before.pmf_cfg.required);
  assert(after.threshold.authmode == before.threshold.authmode);
  assert(after.threshold.rssi == before.threshold.rssi);
  assert(after.scan_method == before.scan_method);
  assert(after.sort_method == before.sort_method);
  assert(after.channel == before.channel);
  assert(after.bssid_set == before.bssid_set);
  assert(std::memcmp(after.bssid, before.bssid, sizeof(after.bssid)) == 0);
  assert(std::memcmp(after.ssid, before.ssid, sizeof(after.ssid)) == 0);
  assert(std::memcmp(after.password, before.password, sizeof(after.password)) == 0);
}
}

esp_err_t esp_wifi_get_config(int interface, wifi_config_t* config) {
  assert(interface == WIFI_IF_STA);
  ++testWiFi.getCalls;
  if (testWiFi.getError == ESP_OK) *config = testWiFi.stationConfig;
  return testWiFi.getError;
}
esp_err_t esp_wifi_set_config(int interface, wifi_config_t* config) {
  assert(interface == WIFI_IF_STA);
  ++testWiFi.setCalls;
  if (testWiFi.setError == ESP_OK) testWiFi.stationConfig = *config;
  return testWiFi.setError;
}
esp_err_t esp_wifi_connect() {
  ++testWiFi.connectCalls;
  // The observable connection request must always carry the compatibility fix.
  assert(!testWiFi.beginConnected);
  assert(testWiFi.stationConfig.sta.sae_pwe_h2e == WPA3_SAE_PWE_BOTH);
  testWiFi.configAtConnection = testWiFi.stationConfig;
  return testWiFi.connectError;
}

int main() {
  WiFiManager manager;
  assert(!manager.connect());

  // A previous connection failure must not prevent a newly configured retry.
  // Non-default security/scan settings must survive the read/modify/write.
  resetRadio();
  testWiFi.status = WL_CONNECT_FAILED;
  testWiFi.configTemplate.sta.pmf_cfg.required = true;
  testWiFi.configTemplate.sta.threshold.authmode = WIFI_AUTH_WPA3_PSK;
  testWiFi.configTemplate.sta.threshold.rssi = -75;
  testWiFi.configTemplate.sta.scan_method = 3;
  testWiFi.configTemplate.sta.sort_method = 2;
  testWiFi.configTemplate.sta.channel = 11;
  testWiFi.configTemplate.sta.bssid_set = true;
  testWiFi.configTemplate.sta.bssid[5] = 42;
  assert(manager.begin(SSID, PASSWORD));
  assert(manager.connect());
  assert(testWiFi.connectCalls == 1);
  assertSecurityPreserved();
  WiFi.emitDisconnect(WIFI_REASON_AUTH_FAIL);
  testDelayHook = [] { WiFi.emitGotIP(); };
  assert(manager.waitForConnection(500));
  assert(std::strlen(manager.getConnectionError()) == 0);
  assert(manager.connect()); // Connected station is not interrupted.
  assert(testWiFi.connectCalls == 1);
  assertNoSecrets();
  testDelayHook = {};
  manager.disconnect();
  assert(manager.connect()); // Radio-off/reconnect follows the same safe path.
  assert(testWiFi.connectCalls == 2);
  assertSecurityPreserved();

  // Full-capacity credentials are legal and need not be NUL-terminated in IDF.
  resetRadio();
  const std::string fullSSID(32, 's');
  const std::string fullPSK(64, 'a');
  assert(manager.begin(fullSSID.c_str(), fullPSK.c_str()));
  assert(manager.connect());
  assertSecurityPreserved();

  // Reject mismatched or stale credentials instead of connecting to an old AP.
  for (bool wrongPassword : {false, true}) {
    resetRadio();
    testWiFi.applyCredentials = false;
    std::memcpy(testWiFi.stationConfig.sta.ssid, SSID, sizeof(SSID));
    std::memcpy(testWiFi.stationConfig.sta.password, PASSWORD, sizeof(PASSWORD));
    if (wrongPassword) testWiFi.stationConfig.sta.password[0] = 'X';
    else testWiFi.stationConfig.sta.ssid[sizeof(SSID) - 1] = 'X'; // Same prefix, longer SSID.
    assert(manager.begin(SSID, PASSWORD));
    assert(!manager.connect());
    assert(testWiFi.connectCalls == 0 && testWiFi.setCalls == 0);
    assert(contains(manager.getConnectionError(), "could not be applied"));
    assertNoSecrets();
  }

  // A driver failure must stop the pipeline before any connection request.
  for (int failure = 0; failure < 3; ++failure) {
    resetRadio();
    if (failure == 0) testWiFi.getError = ESP_FAIL;
    if (failure == 1) testWiFi.setError = ESP_FAIL;
    if (failure == 2) testWiFi.connectError = ESP_FAIL;
    assert(manager.begin(SSID, PASSWORD));
    assert(!manager.connect());
    assert(testWiFi.connectCalls == (failure == 2 ? 1 : 0));
    if (failure == 0) assert(testWiFi.setCalls == 0);
    assert(contains(manager.getConnectionError(), "could not"));
    assertNoSecrets();
  }

  for (bool failMode : {false, true}) {
    resetRadio();
    testWiFi.modeOk = !failMode;
    testWiFi.hostnameOk = failMode;
    assert(!manager.begin(SSID, PASSWORD));
    assert(!manager.connect());
    assert(testWiFi.beginCalls == 0 && testWiFi.connectCalls == 0);
    assert(contains(manager.getConnectionError(), "initialized"));
  }
  resetRadio();
  const std::string tooLong(65, 'x');
  assert(!manager.begin(nullptr, PASSWORD));
  assert(!manager.begin("", PASSWORD));
  assert(!manager.begin(tooLong.c_str(), PASSWORD));
  assert(!manager.begin(SSID, tooLong.c_str()));
  assert(!manager.connect());
  assert(testWiFi.beginCalls == 0 && testWiFi.connectCalls == 0);

  // Event-derived diagnostics survive voluntary disconnects and portal startup.
  struct FailureCase { uint8_t reason; const char* message; };
  for (const FailureCase failure : {
      FailureCase{WIFI_REASON_AUTH_FAIL, "Authentication was rejected"},
      FailureCase{WIFI_REASON_NO_AP_FOUND, "network was not found"},
      FailureCase{WIFI_REASON_HANDSHAKE_TIMEOUT, "security handshake timed out"},
      FailureCase{WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT, "security handshake timed out"},
      FailureCase{WIFI_REASON_ASSOC_FAIL, "disconnected before an IP address"}}) {
    resetRadio();
    assert(manager.begin(SSID, PASSWORD));
    assert(manager.connect());
    WiFi.emitDisconnect(failure.reason);
    WiFi.emitDisconnect(WIFI_REASON_ASSOC_LEAVE); // Arduino's automatic retry.
    assert(!manager.waitForConnection(100));
    assert(contains(manager.getConnectionError(), failure.message));
    const std::string frozen = manager.getConnectionError();
    manager.disconnect();
    WiFi.emitDisconnect(WIFI_REASON_NO_AP_FOUND);
    assert(frozen == manager.getConnectionError());
    assert(!contains(manager.getConnectionError(), "incorrect password"));
    assertNoSecrets();
    // A new attempt clears the last failure; lack of DHCP gets its own message.
    assert(manager.connect());
    assert(!manager.waitForConnection(100));
    assert(contains(manager.getConnectionError(), "DHCP"));
  }
  assert(WiFi.registrations == 1); // Repeated begin() never stacks callbacks.
}
