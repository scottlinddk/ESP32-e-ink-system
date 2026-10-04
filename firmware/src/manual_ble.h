#pragma once
class DisplayManager;

// Starts the BLE receiver once; later calls are no-ops. Runs during setup and,
// with FEATURE_BLE_WHILE_AWAKE, whenever the device stays awake between polls.
// Deep sleep powers the radio off, so a battery device is reachable only in setup.
void beginManualBluetooth();
// Returns true after a manual image replaced the panel contents.
bool pollManualBluetooth(DisplayManager& display);
// True while a browser is connected, so callers can defer blocking network work.
bool manualBluetoothConnected();
