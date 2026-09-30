#pragma once

#include <WiFi.h>

class WiFiManager {
public:
  WiFiManager();
  
  // Initialize WiFi connection
  bool begin(const char* ssid, const char* password);
  
  // Connect to WiFi (with timeout)
  bool connect();
  
  // Check if currently connected
  bool isConnected();
  
  // Disconnect WiFi
  void disconnect();
  
  // Get signal strength (RSSI)
  int getSignalStrength();
  
  // Wait for connection (blocking, with timeout)
  bool waitForConnection(uint32_t timeout_ms);
  
  // Get human-readable WiFi status
  const char* getStatusString();

private:
  const char* _ssid;
  const char* _password;
  
  // WiFi event callbacks
  static void eventCallback(WiFiEvent_t event);
};
