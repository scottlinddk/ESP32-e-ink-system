#include <assert.h>
#include <algorithm>
#include <stdio.h>
#include <limits>
#include "EPD.h"

int testPins[64] = {};
uint32_t testMillis = 0;
TestSerial Serial;
TestSPI SPI;

namespace {
#ifdef ELECROW_PANEL_JD79661
constexpr int ACTIVE = LOW;
constexpr uint8_t FRAME_COMMAND = 0x13;
#else
constexpr int ACTIVE = HIGH;
constexpr uint8_t FRAME_COMMAND = 0x24;
#endif
constexpr int IDLE = !ACTIVE;
int pinModes[64] = {};
struct PinWrite { int pin; int value; uint32_t at; };
std::vector<PinWrite> pinWrites;
enum class Response { Cycle, NeverAssert, NeverRelease };
Response response = Response::Cycle;
uint32_t assertDelay = 0;
uint32_t activeDuration = 650;
uint32_t activatedAt = 0;
unsigned activations = 0;
bool activated = false;
bool forceActive = false;
#ifndef ELECROW_PANEL_JD79661
uint8_t shiftByte = 0;
unsigned shiftBits = 0;
unsigned clockEdges = 0;
#endif

void activation() {
    activatedAt = millis();
    activated = true;
    ++activations;
}

void init(Response nextResponse = Response::Cycle, uint32_t assertion = 0, uint32_t duration = 650) {
    response = nextResponse;
    assertDelay = assertion;
    activeDuration = duration;
    activated = false;
    forceActive = false;
    Serial.output.clear();
    assert(EPD_7IN5_Init());
}

const SpiCommand& lastCommand(uint8_t address) {
    for (auto it = SPI.commands.rbegin(); it != SPI.commands.rend(); ++it) {
        if (it->address == address) return *it;
    }
    assert(false && "Missing controller command");
    return SPI.commands[0];
}

void expectFailure(const char* diagnostic, uint32_t minWait, uint32_t maxWait) {
    Serial.output.clear();
    const uint32_t start = millis();
    assert(!EPD_7IN5_Display());
    const uint32_t elapsed = millis() - start;
    assert(elapsed >= minWait && elapsed <= maxWait);
    assert(Serial.output.find(diagnostic) != std::string::npos);
    assert(Serial.output.find("BUSY GPIO9=") != std::string::npos);
    assert(Serial.output.find("power GPIO7=1") != std::string::npos);
    assert(Serial.output.find("reset GPIO10=1") != std::string::npos);
    assert(Serial.output.find("cycle observed") == std::string::npos);
    const size_t commands = SPI.commands.size();
    // Repeated loading/error screens must not stall on a failed controller.
    assert(!EPD_7IN5_Display());
    assert(SPI.commands.size() == commands);
    assert(millis() - start == elapsed);
}
}

void testPinMode(int pin, int mode) { pinModes[pin] = mode; }

void testTransferByte(uint8_t value) {
    assert(testPins[PIN_CS] == LOW);
    if (testPins[PIN_DC] == LOW) {
        SPI.commands.push_back({value, {}});
#ifndef ELECROW_PANEL_JD79661
        if (value == 0x20) activation();
#endif
    } else {
        assert(!SPI.commands.empty());
        SPI.commands.back().bytes.push_back(value);
#ifdef ELECROW_PANEL_JD79661
        if (SPI.commands.back().address == 0x17 && value == 0xA5) activation();
#endif
    }
}

void testWritePin(int pin, int value) {
    const int previous = testPins[pin];
    testPins[pin] = value;
    pinWrites.push_back({pin, value, millis()});
    if (pin == PIN_RST && value == LOW) activated = false;
#ifndef ELECROW_PANEL_JD79661
    // Decode actual GPIO edges as the display would, independent of the driver's
    // helper names. This detects bit order, per-byte CS and clock regressions.
    if (pin == PIN_CS && value == LOW) {
        shiftByte = 0;
        shiftBits = 0;
    }
    if (pin == PIN_CLK && previous == LOW && value == HIGH && testPins[PIN_CS] == LOW) {
        assert(pinModes[PIN_CLK] == OUTPUT && pinModes[PIN_MOSI] == OUTPUT);
        shiftByte = static_cast<uint8_t>((shiftByte << 1) | testPins[PIN_MOSI]);
        ++shiftBits;
        ++clockEdges;
        if (shiftBits == 8) testTransferByte(shiftByte);
        assert(shiftBits <= 8);
    }
    if (pin == PIN_CS && value == HIGH && previous == LOW && shiftBits)
        assert(shiftBits == 8);
#else
    (void)previous;
#endif
}

int testReadPin(int pin) {
    if (pin != PIN_BUSY) return testPins[pin];
    if (forceActive) return ACTIVE;
    if (!activated || response == Response::NeverAssert) return IDLE;
    const uint32_t elapsed = millis() - activatedAt;
    if (elapsed < assertDelay) return IDLE;
    if (response == Response::NeverRelease || elapsed - assertDelay < activeDuration) return ACTIVE;
    return IDLE;
}

int main() {
    init();
    assert(testPins[7] == HIGH);
    assert(pinModes[9] == INPUT);
    assert(activations == 0); // Init must not erase the retained physical image.
#ifdef ELECROW_PANEL_JD79661
    assert(lastCommand(0x61).bytes == std::vector<uint8_t>({0x80, 0, 0xFA}));
    assert(SPI.starts == 1 && SPI.transfers > 0);
#else
    // Published original factory reset/configuration and RAM geometry. Payload
    // bytes are decoded from GPIO edges, not accepted directly by a fake SPI.
    const std::vector<uint8_t> initCommands = {0x12, 0x01, 0x11, 0x44, 0x45, 0x3C, 0x18, 0x4E, 0x4F, 0x26};
    std::vector<uint8_t> observed;
    for (const auto& command : SPI.commands) observed.push_back(command.address);
    assert(observed == initCommands);
    assert(lastCommand(0x01).bytes == std::vector<uint8_t>({249, 0, 0}));
    assert(lastCommand(0x44).bytes == std::vector<uint8_t>({0, 15}));
    assert(lastCommand(0x45).bytes == std::vector<uint8_t>({0, 0, 249, 0}));
    assert(SPI.starts == 0 && SPI.transfers == 0 && clockEdges > 0);
    std::vector<PinWrite> resets;
    for (const auto& write : pinWrites) if (write.pin == PIN_RST) resets.push_back(write);
    assert(resets.size() == 3);
    assert(resets[0].value == HIGH && resets[1].value == LOW && resets[2].value == HIGH);
    assert(resets[1].at - resets[0].at == 10 && resets[2].at - resets[1].at == 10);
#endif
    Paint_Clear(WHITE);
    Paint_DrawPixel(0, 0, BLACK);
    Paint_DrawPixel(249, 121, BLACK);
    Paint_DrawPixel(250, 0, BLACK); // Out-of-range pixels must not wrap.
    Paint_DrawPixel(0, 122, BLACK);
    uint32_t start = millis();
    assert(EPD_7IN5_Display());
    assert(millis() - start >= 650);
    assert(Serial.output.find("cycle observed") != std::string::npos);
    const auto frame = lastCommand(FRAME_COMMAND).bytes;
    assert(frame.size() == 4000);
    for (size_t i = 0; i < frame.size(); ++i) {
        uint8_t expected = i == 249 * 16 ? 0x7F : i == 15 ? 0xBF : 0xFF;
#ifdef ELECROW_PANEL_JD79661
        expected = ~expected;
#endif
        assert(frame[i] == expected);
    }
#ifndef ELECROW_PANEL_JD79661
    assert(lastCommand(0x22).bytes == std::vector<uint8_t>({0xF4}));
    assert(SPI.commands.back().address == 0x20);
#endif
    EPD_7IN5_Sleep();
    assert(EPD_7IN5_Display()); // Wake without erasing the pending canvas.
    assert(lastCommand(FRAME_COMMAND).bytes == frame);

    // A delayed assertion must not be mistaken for an instant completed refresh.
    // Exercise elapsed-time arithmetic across the 32-bit millis() rollover too.
    init(Response::Cycle, 47, 1234);
    testMillis = std::numeric_limits<uint32_t>::max() - 100;
    start = millis();
    assert(EPD_7IN5_Display());
    assert(millis() - start >= 1281 && millis() - start <= 1291);
    assert(Serial.output.find("asserted after 47 ms") != std::string::npos);

    // The old JD path returned success for a permanently HIGH line, and the old
    // SSD path did so for a permanently LOW line. Neither may acknowledge now.
    init(Response::NeverAssert);
    expectFailure("refresh: BUSY did not assert", 1000, 1010);
    init(Response::NeverRelease);
    expectFailure("refresh: BUSY did not release", 15000, 15010);

    init();
    forceActive = true;
    const unsigned before = activations;
    expectFailure("before refresh: BUSY did not release", 15000, 15010);
    assert(activations == before); // Do not start a refresh on a busy controller.
    forceActive = false;

    // Explicit initialization must recover from the latched failure.
    init(Response::Cycle, 5, 300);
    assert(EPD_7IN5_Display());

    uint8_t canvas[3906] = {};
    canvas[0] = 0xA5;
    canvas[3905] = 0x5A;
    Paint_NewImage(canvas + 1, 250, 122, 0, WHITE);
    Paint_DrawPixel(249, 121, BLACK);
    assert(canvas[0] == 0xA5 && canvas[3905] == 0x5A);
    Paint_NewImage(nullptr, 250, 122, 0, WHITE);
    Paint_DrawPixel(0, 0, BLACK);
    puts("Display BUSY traces, vendor protocol, GPIO transfer, sleep and memory guards passed");
}
