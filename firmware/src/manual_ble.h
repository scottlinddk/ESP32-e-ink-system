#pragma once
class DisplayManager;

// Call only during physical/first-boot setup, never during unattended polling.
void beginManualBluetooth();
void pollManualBluetooth(DisplayManager& display);
