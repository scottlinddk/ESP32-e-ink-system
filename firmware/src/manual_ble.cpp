#include "manual_ble.h"
#include "ble_frame.h"
#include "display.h"
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <atomic>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

namespace {
const char* SERVICE_UUID = "c9c10001-7a6b-4c31-8a98-89e539e43805";
const char* CHARACTERISTIC_UUID = "c9c10002-7a6b-4c31-8a98-89e539e43805";
// version, width LE, height LE, mono
const uint8_t CAPABILITIES[] = {1, uint8_t(kBoard.width & 0xff), uint8_t(kBoard.width >> 8),
                                uint8_t(kBoard.height & 0xff), uint8_t(kBoard.height >> 8), 0};
struct Packet { uint32_t session; uint8_t length; uint8_t bytes[20]; };
QueueHandle_t packets = nullptr;
BLECharacteristic* characteristic = nullptr;
std::atomic<uint32_t> session{0};
std::atomic<bool> connected{false};
BleFrame receiver;
uint32_t activeSession = 0;

void notify(uint8_t status, uint8_t command, uint32_t owner) {
  if (!connected || owner != session.load()) return;
  uint8_t reply[] = {status, command};
  characteristic->setValue(reply, sizeof(reply));
  characteristic->notify();
}
class ConnectionCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override { ++session; connected = true; }
  void onDisconnect(BLEServer*) override { connected = false; ++session; }
} connectionCallbacks;
class FrameCallbacks : public BLECharacteristicCallbacks {
  void onRead(BLECharacteristic* value) override {
    value->setValue(const_cast<uint8_t*>(CAPABILITIES), sizeof(CAPABILITIES));
  }
  void onWrite(BLECharacteristic* value) override {
    const std::string bytes = value->getValue();
    Packet packet{};
    packet.session = session.load();
    packet.length = bytes.size() <= sizeof(packet.bytes) ? bytes.size() : 0;
    if (packet.length) memcpy(packet.bytes, bytes.data(), packet.length);
    // One command in flight: the client must await our application ACK.
    // Malformed/overflow writes never touch the image or display from this task.
    if (xQueueSend(packets, &packet, 0) != pdTRUE) {
      ++session; // invalidate the whole partial frame on a flooding connection
    }
  }
} frameCallbacks;
}

void beginManualBluetooth() {
  if (packets) return;  // Setup can reopen from an awake device; init only once.
  packets = xQueueCreate(4, sizeof(Packet));
  if (!packets) { Serial.println("[BLE] Could not allocate command queue"); return; }
  char name[20];
  snprintf(name, sizeof(name), "EInk-%06X", unsigned(ESP.getEfuseMac() & 0xffffff));
  BLEDevice::init(name);
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(&connectionCallbacks);
  BLEService* service = server->createService(SERVICE_UUID);
  characteristic = service->createCharacteristic(CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_NOTIFY);
  characteristic->setCallbacks(&frameCallbacks);
  characteristic->addDescriptor(new BLE2902());
  characteristic->setValue(const_cast<uint8_t*>(CAPABILITIES), sizeof(CAPABILITIES));
  service->start();
  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  advertising->start();
  Serial.printf("[BLE] Manual display receiver ready as %s; free heap %u bytes\n", name, unsigned(ESP.getFreeHeap()));
}

bool manualBluetoothConnected() { return connected; }

bool pollManualBluetooth(DisplayManager& display) {
  if (!packets || !characteristic) return false;
  const uint32_t currentSession = session.load();
  if (currentSession != activeSession) {
    receiver.reset(); activeSession = currentSession;
    if (!connected) BLEDevice::startAdvertising();
  }
  receiver.expire(millis());
  Packet packet;
  if (xQueueReceive(packets, &packet, 0) != pdTRUE || packet.session != currentSession || !connected) return false;
  const bool accepted = receiver.accept(packet.bytes, packet.length, millis());
  const uint8_t command = packet.length >= 2 ? packet.bytes[1] : 0;
  notify(accepted ? 0 : 0xff, command, currentSession);
  if (accepted && receiver.ready) {
    // E-paper refresh can block for seconds; keep it off the Bluetooth task.
    const bool refreshed = display.showBitmap(receiver.bitmap, BleFrame::BMP_BYTES);
    display.sleep();
    receiver.reset();
    notify(0, refreshed ? 0x73 : 0x74, currentSession);
    Serial.printf("[BLE] Manual image %s\n", refreshed ? "refresh completed" : "refresh failed");
    return true;  // Even a failed refresh may have changed the panel.
  }
  return false;
}
