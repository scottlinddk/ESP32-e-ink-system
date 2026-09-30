#pragma once
#include <cstdint>

using esp_err_t = int;
constexpr esp_err_t ESP_OK = 0;
constexpr esp_err_t ESP_FAIL = -1;
constexpr int WIFI_IF_STA = 0;
enum wifi_sae_pwe_method_t {
  WPA3_SAE_PWE_UNSPECIFIED, WPA3_SAE_PWE_HUNT_AND_PECK,
  WPA3_SAE_PWE_HASH_TO_ELEMENT, WPA3_SAE_PWE_BOTH
};
enum wifi_auth_mode_t { WIFI_AUTH_OPEN, WIFI_AUTH_WPA2_PSK, WIFI_AUTH_WPA3_PSK };
enum wifi_err_reason_t {
  WIFI_REASON_ASSOC_LEAVE = 8,
  WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT = 15,
  WIFI_REASON_NO_AP_FOUND = 201,
  WIFI_REASON_AUTH_FAIL = 202,
  WIFI_REASON_ASSOC_FAIL = 203,
  WIFI_REASON_HANDSHAKE_TIMEOUT = 204,
};
struct wifi_sta_config_t {
  uint8_t ssid[32]{};
  uint8_t password[64]{};
  struct { bool capable = true; bool required = false; } pmf_cfg;
  struct { int rssi = -127; wifi_auth_mode_t authmode = WIFI_AUTH_WPA2_PSK; } threshold;
  int scan_method = 1;
  int sort_method = 0;
  uint8_t channel = 0;
  bool bssid_set = false;
  uint8_t bssid[6]{};
  wifi_sae_pwe_method_t sae_pwe_h2e = WPA3_SAE_PWE_UNSPECIFIED;
};
struct wifi_config_t { wifi_sta_config_t sta; };

esp_err_t esp_wifi_get_config(int interface, wifi_config_t* config);
esp_err_t esp_wifi_set_config(int interface, wifi_config_t* config);
esp_err_t esp_wifi_connect();
inline const char* esp_err_to_name(esp_err_t error) {
  return error == ESP_OK ? "ESP_OK" : "ESP_FAIL";
}
