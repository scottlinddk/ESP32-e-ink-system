#include "config.h"
#include "wifi_manager.h"
#include "display.h"
#include "api.h"
#include "provisioning.h"
#include "feed_validation.h"
#include <time.h>

WiFiManager wifiManager;
DisplayManager display;
ApiClient apiClient;
ProvisioningManager provisioning;
DeviceCredentials credentials;
RTC_DATA_ATTR char appliedHash[65] = {};
RTC_DATA_ATTR uint32_t failedPolls = 0;
uint32_t nextPollSeconds = 60;

#ifdef ELECROW_EPAPER_213
constexpr int SETUP_BUTTON = 2;  // Manufacturer MENU button, not the boot strap.
#else
constexpr int SETUP_BUTTON = 0;
#endif

void openSetup(uint32_t timeoutSeconds = 0, const char* failureReason = nullptr) {
  appliedHash[0] = 0;
  if (failureReason) Serial.printf("[Main] Setup recovery: %s\n", failureReason);
  display.showLoading("Setup: ESP32-Display\nOpen 192.168.4.1");
  // The original SSD1680 full refresh leaves its boost/clock enabled. The
  // setup portal may stay open indefinitely; the retained image needs no power.
  display.sleep();
  provisioning.startProvisioningAP(timeoutSeconds, failureReason);
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
    if (!feed::validHash(appliedHash)) display.showError("Time sync failed", "Check internet / NTP");
    sleepUntilNextPoll();
    return;
  }
  Serial.println("[Main] Clock ready; requesting device frame");
  static uint8_t bmp[8192];  // Keep the frame off the ESP32's 8 KiB loop stack.
  FrameResult frame = apiClient.fetchFrame(credentials.apiUrl, credentials.deviceId,
    credentials.token, appliedHash, bmp, sizeof(bmp));
  Serial.printf("[Main] Frame response: HTTP %d, %d image bytes\n", frame.httpCode, frame.length);
  bool success = false;
  if (frame.length > 0) {
    // Drawing replaces any previously applied frame, including on partial failure.
    appliedHash[0] = 0;
    success = display.showBitmap(bmp, static_cast<size_t>(frame.length));
    if (success) {
      strlcpy(appliedHash, frame.hash, sizeof(appliedHash));
#ifdef ELECROW_EPAPER_213
      Serial.println("[Main] Display controller refresh cycle completed; visible image not verified");
#else
      Serial.println("[Main] Display refresh completed");
#endif
    }
    else Serial.println("[Main] Display rejected BMP or failed to refresh");
  } else if (frame.httpCode == 204 || (frame.httpCode == 304 && feed::validHash(appliedHash))) {
    success = true;  // Quiet or unchanged: leave the panel untouched.
  } else {
    Serial.printf("[Main] %s\n", frame.error);
    if (!feed::validHash(appliedHash)) display.showError("Update failed", frame.error);
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
  if (!apiClient.heartbeat(credentials.apiUrl, credentials.deviceId, credentials.token, appliedHash, WiFi.RSSI()))
    Serial.println("[Main] Heartbeat failed");
  else Serial.println("[Main] Heartbeat accepted by server");
  const uint32_t elapsed = (millis() - frame.receivedAt) / 1000;
  nextPollSeconds = nextPollSeconds > elapsed ? nextPollSeconds - elapsed : 1;
  sleepUntilNextPoll();
}

void setup() {
  Serial.begin(DEBUG_BAUD);
  delay(150);
  Serial.printf("\n[Main] ESP32 Display %s; flash %u bytes\n", FIRMWARE_VERSION, ESP.getFlashChipSize());
  pinMode(SETUP_BUTTON, INPUT_PULLUP);
  // Only a timer wake is known to retain the previously rendered frame.
  if (esp_sleep_get_wakeup_cause() != ESP_SLEEP_WAKEUP_TIMER) {
    appliedHash[0] = 0;
    failedPolls = 0;
  }
  display.begin();
  if (digitalRead(SETUP_BUTTON) == LOW || esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_EXT0 || !provisioning.loadCredentials(credentials)) {
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
#if !DEEP_SLEEP_ENABLED
  // A firmware with sleep disabled still polls, and allows button recovery.
  uint32_t started = millis();
  while (millis() - started < nextPollSeconds * 1000UL) {
    if (digitalRead(SETUP_BUTTON) == LOW) openSetup();
    delay(50);
  }
  WiFi.mode(WIFI_STA);
  pollDisplay();
#endif
}
