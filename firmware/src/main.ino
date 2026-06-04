#include "config.h"
#include "wifi.h"
#include "display.h"
#include "api.h"
#include "battery.h"
#include "ota.h"
#include "provisioning.h"

// Global objects
WiFiManager wifiManager;
DisplayManager display;
ApiClient apiClient;
BatteryManager battery;
OTAManager otaManager;
ProvisioningManager provManager;

// State variables
unsigned long lastFetchTime = 0;
unsigned long refreshInterval = REFRESH_MINUTES * 60 * 1000;  // Convert minutes to ms
int displayMode = 0;

// Sleep duration (calculated from config)
#if DEEP_SLEEP_ENABLED
RTC_DATA_ATTR int bootCount = 0;  // Persistent counter across sleep cycles
#endif

#if DEBUG_ENABLED
#define LOG_MAIN(fmt, ...) Serial.printf("[Main] " fmt "\n", ##__VA_ARGS__)
#else
#define LOG_MAIN(fmt, ...)
#endif

// ============================================================================
// Setup
// ============================================================================

void setup() {
  // Initialize serial for debugging
#if DEBUG_ENABLED
  Serial.begin(DEBUG_BAUD);
  delay(100);
  Serial.println("\n\n");
  LOG_MAIN("========================================");
  LOG_MAIN("ESP32 E-Ink Display Firmware v%s", FIRMWARE_VERSION);
  LOG_MAIN("========================================");
#endif

  // Initialize hardware
  battery.begin();
  display.begin();
  
  LOG_MAIN("Hardware initialized");
  
#if DEEP_SLEEP_ENABLED
  bootCount++;
  LOG_MAIN("Boot count: %d (wake reason: %d)", bootCount, esp_sleep_get_wakeup_cause());
#endif
  
  // Check for provisioning credentials — start captive portal if missing
  if (!provManager.hasCredentials()) {
    display.showLoading("Setup required\nConnect to:\nESP32-Display-XXXXXX");
    LOG_MAIN("No credentials found — starting captive portal AP");
    provManager.startProvisioningAP();  // blocks until saved, then restarts
    return;  // unreachable — device restarts inside startProvisioningAP()
  }

  // Load all credentials from NVS
  char ssid[64], pass[64], apiUrl[128], userId[64], licenseKey[64];
  provManager.loadCredentials(ssid, sizeof(ssid), pass, sizeof(pass),
                               apiUrl, sizeof(apiUrl), userId, sizeof(userId),
                               licenseKey, sizeof(licenseKey));

  LOG_MAIN("Credentials loaded — SSID: %s  userId: %s", ssid, strlen(userId) ? userId : "(pending)");

  // Show loading screen
  display.showLoading("Initializing...");

  // Initialize WiFi with provisioned credentials
  wifiManager.begin(ssid, pass);

  // Attempt to connect
  if (!wifiManager.connect() || !wifiManager.waitForConnection(WIFI_CONNECT_TIMEOUT_SEC * 1000)) {
    LOG_MAIN("WiFi connection failed!");
    display.showError("WiFi Error", "Cannot connect to network. Check SSID/password.");
    delay(5000);
    goToDeepSleep();
    return;  // Unreachable but here for safety
  }

  LOG_MAIN("WiFi connected: %s (RSSI: %d dBm)",
           WiFi.localIP().toString().c_str(),
           wifiManager.getSignalStrength());

  // Pair device with backend if userId not yet assigned
  apiClient.setBaseUrl(apiUrl);
  if (strlen(userId) == 0) {
    LOG_MAIN("No userId — pairing device with backend...");
    display.showLoading("Pairing device...");

    PairingResult pairing;
    if (apiClient.pairDevice(WiFi.macAddress().c_str(), "ESP32 Display", pairing)) {
      provManager.saveUserCredentials(pairing.userId, pairing.licenseKey);
      strlcpy(userId,     pairing.userId,     sizeof(userId));
      strlcpy(licenseKey, pairing.licenseKey, sizeof(licenseKey));
      LOG_MAIN("Pairing successful — userId: %s", userId);
    } else {
      LOG_MAIN("Pairing failed: %s", pairing.errorMessage);
      display.showError("Pairing Failed", pairing.errorMessage);
      delay(3000);
      wifiManager.disconnect();
      goToDeepSleep();
      return;
    }
  }

  // Set firmware version and fetch display data
  otaManager.setCurrentVersion(FIRMWARE_VERSION);

  // ── Image-based flow (TRMNL-style) ──────────────────────────────────────
  display.showLoading("Fetching image...");
  ImageDisplayResult imgResult;
  bool imageShown = false;

  if (apiClient.fetchImageEndpoint(userId, licenseKey, imgResult)) {
    const size_t BMP_BUF_SIZE = 8192; // ample for ~4 KB 1-bit BMP
    uint8_t* bmpBuf = (uint8_t*)malloc(BMP_BUF_SIZE);
    if (bmpBuf) {
      int bmpLen = apiClient.downloadBmp(imgResult.imageUrl, bmpBuf, BMP_BUF_SIZE);
      if (bmpLen > 0) {
        display.showBitmap(bmpBuf, (size_t)bmpLen);
        refreshInterval = (unsigned long)imgResult.refreshSeconds * 1000UL;
        imageShown = true;
        LOG_MAIN("Image displayed (%d bytes, next refresh %us)", bmpLen, imgResult.refreshSeconds);
      } else {
        LOG_MAIN("BMP download failed, falling back to JSON");
      }
      free(bmpBuf);
    } else {
      LOG_MAIN("OOM allocating BMP buffer, falling back to JSON");
    }
  } else {
    LOG_MAIN("Image endpoint failed (%s), falling back to JSON", imgResult.errorMessage);
  }

  // ── JSON fallback ────────────────────────────────────────────────────────
  if (!imageShown) {
    display.showLoading("Fetching data...");
    ApiResponse response = apiClient.fetchDisplayData(userId, licenseKey);

    if (!response.success) {
      LOG_MAIN("API call failed: %s (HTTP %d)", response.errorMessage, response.httpCode);
      display.showError("Data Error", response.errorMessage);
      delay(3000);
      wifiManager.disconnect();
      goToDeepSleep();
      return;
    }

    LOG_MAIN("Display data received successfully");
    response.displayData.status.batteryPercent = battery.readPercentage();
    response.displayData.status.signalStrength = wifiManager.getSignalStrength();
    display.showData(response.displayData);
  }

  // Report device status (optional)
#if FEATURE_BATTERY_REPORTING
  apiClient.reportDeviceStatus(userId, licenseKey,
                               battery.readPercentage(),
                               wifiManager.getSignalStrength());
#endif

#if FEATURE_OTA_UPDATES
  // Check for firmware updates (non-blocking check only)
  otaManager.checkForUpdates(apiClient, userId, licenseKey);
#endif
  
  // Disconnect WiFi to save power
  wifiManager.disconnect();
  
  LOG_MAIN("Display updated, disconnecting WiFi");
  
  lastFetchTime = millis();
  
  // Go to deep sleep
  LOG_MAIN("Entering deep sleep for %d minutes", REFRESH_MINUTES);
  goToDeepSleep();
}

// ============================================================================
// Main Loop
// ============================================================================

void loop() {
  // Empty - we use deep sleep instead
  // This is only reached if deep sleep is disabled
  
  unsigned long now = millis();
  
  if (now - lastFetchTime >= refreshInterval) {
    LOG_MAIN("Refresh interval reached, fetching data...");
    lastFetchTime = now;
    
    // Re-run setup sequence
    setup();
  }
  
  delay(1000);  // Prevent watchdog issues
}

// ============================================================================
// Deep Sleep Helpers
// ============================================================================

void goToDeepSleep() {
#if DEEP_SLEEP_ENABLED
  LOG_MAIN("Going to deep sleep for %d seconds...", DEEP_SLEEP_DURATION_SEC);
  
  // Configure wake-up timer
  esp_sleep_enable_timer_wakeup(DEEP_SLEEP_DURATION_SEC * 1000000ULL);  // microseconds
  
  // Optional: Configure GPIO wake-up (if you have a button)
  // esp_sleep_enable_ext0_wakeup(GPIO_NUM_36, 0);  // GPIO36, low level
  
  // Go to sleep
  esp_deep_sleep_start();
  
  // Code never reaches here; device wakes up and restarts from setup()
#else
  delay(REFRESH_MINUTES * 60 * 1000);  // Just delay if deep sleep disabled
#endif
}

// ============================================================================
// Utility Functions
// ============================================================================

void printWakeupReason() {
  esp_sleep_wakeup_cause_t wakeup_reason = esp_sleep_get_wakeup_cause();
  
  switch (wakeup_reason) {
    case ESP_SLEEP_WAKEUP_EXT0:
      LOG_MAIN("Wakeup caused by external signal on RTC_IO");
      break;
    case ESP_SLEEP_WAKEUP_EXT1:
      LOG_MAIN("Wakeup caused by external signal on RTC_CNTL");
      break;
    case ESP_SLEEP_WAKEUP_TIMER:
      LOG_MAIN("Wakeup caused by timer");
      break;
    case ESP_SLEEP_WAKEUP_TOUCHPAD:
      LOG_MAIN("Wakeup caused by touchpad");
      break;
    case ESP_SLEEP_WAKEUP_ULP:
      LOG_MAIN("Wakeup caused by ULP program");
      break;
    default:
      LOG_MAIN("Wakeup was not caused by deep sleep");
      break;
  }
}

// Display information screen (useful for debugging)
void displaySystemInfo() {
  display.showLoading("System Info");
  
  LOG_MAIN("========== System Information ==========");
  LOG_MAIN("Firmware Version: 1.0.0");
  LOG_MAIN("Chip ID: %u", ESP.getChipRevision());
  LOG_MAIN("Free Heap: %d bytes", ESP.getFreeHeap());
  LOG_MAIN("Flash Size: %d bytes", ESP.getFlashChipSize());
  LOG_MAIN("Reset Reason: %d", (int)esp_rom_get_reset_reason(0));
  LOG_MAIN("========================================");
}
