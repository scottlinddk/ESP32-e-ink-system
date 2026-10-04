#include "config.h"
#include "wifi_manager.h"
#include "display.h"
#include "api.h"
#include "provisioning.h"
#include "feed_validation.h"
#include "applied_frame.h"
#include "manual_ble.h"
#include <time.h>

WiFiManager wifiManager;
DisplayManager display;
ApiClient apiClient;
ProvisioningManager provisioning;
DeviceCredentials credentials;
RTC_DATA_ATTR feed::AppliedFrame appliedFrame = {};
RTC_DATA_ATTR uint32_t failedPolls = 0;
uint32_t nextPollSeconds = 60;
// Owner opt-in reported on every feed response. RAM only: an instant-updates
// device never deep sleeps, and any boot or timer wake relearns the mode.
bool instantUpdates = false;
uint32_t instantCheckSeconds = 5;
uint32_t nextPollAt = 0;  // millis() of the next scheduled frame request

#ifdef ELECROW_EPAPER_213
constexpr int SETUP_BUTTON = 2;  // Manufacturer MENU button, not the boot strap.
#else
constexpr int SETUP_BUTTON = 0;
#endif

void openSetup(uint32_t timeoutSeconds = 0, const char* failureReason = nullptr) {
  appliedFrame.clear();
  if (failureReason) Serial.printf("[Main] Setup recovery: %s\n", failureReason);
  const bool manual = failureReason == nullptr;
  display.showLoading(manual ? "WiFi: ESP32-Display\nBLE: EInk-..." : "Setup: ESP32-Display\nOpen 192.168.4.1");
  // The original SSD1680 full refresh leaves its boost/clock enabled. The
  // setup portal may stay open indefinitely; the retained image needs no power.
  display.sleep();
  if (manual) beginManualBluetooth();
  provisioning.startProvisioningAP(timeoutSeconds, failureReason,
    manual ? +[]() { pollManualBluetooth(display); } : nullptr);
}

void sleepUntilNextPoll() {
  display.sleep();
  wifiManager.disconnect();
  Serial.printf("[Main] Next poll in %lu seconds\n", static_cast<unsigned long>(nextPollSeconds));
  Serial.flush();
#if DEEP_SLEEP_ENABLED
  esp_sleep_enable_timer_wakeup(static_cast<uint64_t>(nextPollSeconds) * 1000000ULL);
#ifdef ELECROW_EPAPER_213
  // MENU can wake the device into setup without a USB reflash.
  esp_sleep_enable_ext0_wakeup(GPIO_NUM_2, 0);
#endif
  esp_deep_sleep_start();
#endif
}

void finishPoll() {
  if (!instantUpdates) {
    sleepUntilNextPoll();
    return;
  }
  // USB-powered opt-in: keep Wi-Fi associated (modem sleep) so loop() can ask
  // for screen-update requests until the scheduled frame poll.
  display.sleep();
#if FEATURE_BLE_WHILE_AWAKE
  beginManualBluetooth();
#endif
  nextPollAt = millis() + nextPollSeconds * 1000UL;
  Serial.printf("[Main] Instant updates on; next scheduled poll in %lu seconds\n", static_cast<unsigned long>(nextPollSeconds));
}

// An awake device accepts Bluetooth pushes between polls. The panel then no
// longer shows the server frame's refresh request, so a repeated request must
// redraw; the hash stays, so an unchanged feed (304) keeps the manual image.
void serviceBluetooth() {
#if FEATURE_BLE_WHILE_AWAKE
  if (pollManualBluetooth(display)) appliedFrame.refreshRequestId[0] = 0;
#endif
}

// Returns true to poll the frame now (request or schedule), false when the
// owner turned instant updates off and the device should sleep again.
bool waitForRefreshRequest() {
  uint32_t intervalSeconds = instantCheckSeconds;
  uint32_t checkFailures = 0;
  uint32_t lastCheck = millis();
  while (static_cast<int32_t>(nextPollAt - millis()) > 0) {
    if (digitalRead(SETUP_BUTTON) == LOW) openSetup();
    serviceBluetooth();
    // A request check can block for seconds and stall an active transfer.
    if (millis() - lastCheck < intervalSeconds * 1000UL || manualBluetoothConnected()) {
      delay(50);
      continue;
    }
    lastCheck = millis();
    RefreshCheck check;
    if (wifiManager.isConnected() || (wifiManager.connect() && wifiManager.waitForConnection(WIFI_CONNECT_TIMEOUT_SEC * 1000)))
      check = apiClient.checkRefreshRequest(credentials.apiUrl, credentials.deviceId, credentials.token);
    if (check.instantUpdates == 0) {
      instantUpdates = false;
      const int32_t remaining = static_cast<int32_t>(nextPollAt - millis());
      nextPollSeconds = remaining > 1000 ? static_cast<uint32_t>(remaining) / 1000 : 1;
      Serial.println("[Main] Instant updates turned off; resuming sleep between polls");
      return false;
    }
    // A failed frame keeps its backoff; repeating it every check would hammer the API.
    if (check.pending && failedPolls == 0) {
      Serial.println("[Main] Screen update requested");
      return true;
    }
    // Let the frame request report a rejected token through the setup portal.
    if (check.httpCode == 401 || check.httpCode == 403) return true;
    if (check.httpCode == 200 || check.httpCode == 204) {
      checkFailures = 0;
      instantCheckSeconds = intervalSeconds = check.retrySeconds;
    } else {
      checkFailures = min(checkFailures + 1, static_cast<uint32_t>(4));
      intervalSeconds = min(static_cast<uint32_t>(60), instantCheckSeconds << checkFailures);
      Serial.printf("[Main] Request check failed (HTTP %d); next check in %lu seconds\n", check.httpCode, static_cast<unsigned long>(intervalSeconds));
    }
  }
  return true;
}

void pollDisplay() {
  nextPollSeconds = 60;
  if (!wifiManager.connect() || !wifiManager.waitForConnection(WIFI_CONNECT_TIMEOUT_SEC * 1000)) {
    // Bad Wi-Fi credentials must remain recoverable without a successful API call.
    failedPolls++;
    Serial.println("[Main] Wi-Fi unavailable; opening local setup portal");
    openSetup(300, wifiManager.getConnectionError());
    return;
  }
  // Certificate time validation requires a real clock. Retained RTC time is used
  // after sleep; on a cold boot synchronise before sending any device credential.
  Serial.println("[Main] Synchronizing clock for HTTPS");
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  const uint32_t syncStart = millis();
  while (time(nullptr) < 1735689600 && millis() - syncStart < 20000) delay(100);
  if (time(nullptr) < 1735689600) {
    Serial.println("[Main] Time sync failed; check internet/NTP access");
    if (!feed::validHash(appliedFrame.hash)) display.showError("Time sync failed", "Check internet / NTP");
    finishPoll();
    return;
  }
  Serial.println("[Main] Clock ready; requesting device frame");
  static uint8_t bmp[8192];  // Keep the frame off the ESP32's 8 KiB loop stack.
  FrameResult frame = apiClient.fetchFrame(credentials.apiUrl, credentials.deviceId,
    credentials.token, appliedFrame.hash, bmp, sizeof(bmp));
  Serial.printf("[Main] Frame response: HTTP %d, %d image bytes\n", frame.httpCode, frame.length);
  if (frame.instantUpdates >= 0) instantUpdates = frame.instantUpdates == 1;
  bool success = false;
  if (frame.length > 0) {
    success = appliedFrame.apply(frame.hash, frame.refreshRequestId, [&]() {
      return display.showBitmap(bmp, static_cast<size_t>(frame.length));
    });
    if (success) {
#ifdef ELECROW_EPAPER_213
      Serial.println("[Main] Display controller refresh cycle completed; visible image not verified");
#else
      Serial.println("[Main] Display refresh completed");
#endif
    }
    else Serial.println("[Main] Display rejected BMP or failed to refresh");
  } else if (frame.httpCode == 204 || (frame.httpCode == 304 && feed::validHash(appliedFrame.hash))) {
    success = true;  // Quiet or unchanged: leave the panel untouched.
  } else {
    Serial.printf("[Main] %s\n", frame.error);
    if (!feed::validHash(appliedFrame.hash)) display.showError("Update failed", frame.error);
  }
  if (frame.httpCode == 401 || frame.httpCode == 403) {
    Serial.println("[Main] Device token rejected; open setup to replace it");
    openSetup(0, "The server rejected the device token. Create a new token under Automatic updates and enter it here.");
    return;
  }
  if (success) {
    failedPolls = 0;
    nextPollSeconds = frame.retrySeconds;
  } else {
    failedPolls = min(failedPolls + 1, static_cast<uint32_t>(7));
    nextPollSeconds = max(frame.retrySeconds, min(static_cast<uint32_t>(3600), static_cast<uint32_t>(30UL << failedPolls)));
  }
  // Request ACKs belong only to validated 200 frames, including lost-ACK retries.
  const char* requestAck = success && frame.length > 0 ? appliedFrame.refreshRequestId : nullptr;
  if (!apiClient.heartbeat(credentials.apiUrl, credentials.deviceId, credentials.token, appliedFrame.hash, WiFi.RSSI(), requestAck))
    Serial.println("[Main] Heartbeat failed");
  else Serial.println("[Main] Heartbeat accepted by server");
  const uint32_t elapsed = (millis() - frame.receivedAt) / 1000;
  nextPollSeconds = nextPollSeconds > elapsed ? nextPollSeconds - elapsed : 1;
  finishPoll();
}

void setup() {
  Serial.begin(DEBUG_BAUD);
  delay(150);
  Serial.printf("\n[Main] ESP32 Display %s; flash %u bytes\n", FIRMWARE_VERSION, ESP.getFlashChipSize());
  pinMode(SETUP_BUTTON, INPUT_PULLUP);
  bool setupRequested = digitalRead(SETUP_BUTTON) == LOW;
#ifndef ELECROW_EPAPER_213
  // GPIO0 is a boot strap: hold BOOT only AFTER reset has been released.
  // Give cold boots a short entry window without delaying automatic timer wakes.
  if (esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_UNDEFINED) {
    const uint32_t started = millis();
    Serial.println("[Main] Press BOOT within 3 seconds for manual setup/Bluetooth");
    while (!setupRequested && millis() - started < 3000) {
      setupRequested = digitalRead(SETUP_BUTTON) == LOW;
      delay(10);
    }
  }
#endif
  // Only a timer wake is known to retain the previously rendered frame.
  if (esp_sleep_get_wakeup_cause() != ESP_SLEEP_WAKEUP_TIMER) {
    appliedFrame.clear();
    failedPolls = 0;
  }
  display.begin();
  if (setupRequested || digitalRead(SETUP_BUTTON) == LOW || esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_EXT0 || !provisioning.loadCredentials(credentials)) {
    Serial.println("[Main] Setup requested or saved settings unavailable");
    openSetup();
    return;
  }
  Serial.println("[Main] Stored settings loaded");
  if (!wifiManager.begin(credentials.ssid, credentials.password)) {
    openSetup(300, wifiManager.getConnectionError());
    return;
  }
  pollDisplay();
}

void loop() {
  if (instantUpdates) {
    if (waitForRefreshRequest()) pollDisplay();
    else sleepUntilNextPoll();  // Returns only when deep sleep is disabled.
    return;
  }
#if !DEEP_SLEEP_ENABLED
  // A firmware with sleep disabled still polls, and allows button recovery.
#if FEATURE_BLE_WHILE_AWAKE
  beginManualBluetooth();
#endif
  uint32_t started = millis();
  while (millis() - started < nextPollSeconds * 1000UL) {
    if (digitalRead(SETUP_BUTTON) == LOW) openSetup();
    serviceBluetooth();
    delay(50);
  }
  WiFi.mode(WIFI_STA);
  pollDisplay();
#endif
}
