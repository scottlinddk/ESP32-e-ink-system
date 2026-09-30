#pragma once

#include <WiFi.h>
#include <atomic>

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

  // Stable, non-secret explanation for the local setup portal after failure.
  const char* getConnectionError() const;

private:
  const char* _ssid;
  const char* _password;
  const char* _connectionError;
  bool _initialized;

  // There is one station interface. Its callback runs on the Arduino event task;
  // share only atomic values, never a mutable message buffer, with the main task.
  static std::atomic<uint32_t> _disconnectState;
  static wifi_event_id_t _eventId;
  static void recordDisconnectReason(uint32_t reason);
  
  // WiFi event callbacks
  static void eventCallback(WiFiEvent_t event, WiFiEventInfo_t info);
};
