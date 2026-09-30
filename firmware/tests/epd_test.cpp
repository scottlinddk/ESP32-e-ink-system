#include <assert.h>
#include <algorithm>
#include <stdio.h>
#include "EPD.h"

int testPins[64] = {};
uint32_t testMillis = 0;
TestSerial Serial;
TestSPI SPI;

const SpiCommand& lastCommand(uint8_t address) {
    for (auto it = SPI.commands.rbegin(); it != SPI.commands.rend(); ++it) {
        if (it->address == address) return *it;
    }
    assert(false && "Missing controller command");
    return SPI.commands[0];
}

int main() {
#ifdef ELECROW_PANEL_JD79661
    const int idle = HIGH;
    const uint8_t frameCommand = 0x13;
#else
    const int idle = LOW;
    const uint8_t frameCommand = 0x24;
#endif
    testPins[PIN_BUSY] = idle;
    assert(EPD_7IN5_Init());
    assert(testPins[7] == HIGH);
    // Initializing after a timer wake must preserve the previously visible frame.
    for (const auto& command : SPI.commands) {
        assert(command.address != 0x17);
        assert(command.address != 0x20);
    }
#ifdef ELECROW_PANEL_JD79661
    assert(lastCommand(0x61).bytes == std::vector<uint8_t>({0x80, 0, 0xFA}));
#else
    assert(lastCommand(0x44).bytes == std::vector<uint8_t>({0, 15}));
    assert(lastCommand(0x45).bytes == std::vector<uint8_t>({0, 0, 249, 0}));
#endif
    Paint_Clear(WHITE);
    Paint_DrawPixel(0, 0, BLACK);
    Paint_DrawPixel(249, 121, BLACK);
    // These are outside the visible canvas and must not wrap into valid memory.
    Paint_DrawPixel(250, 0, BLACK);
    Paint_DrawPixel(0, 122, BLACK);
    assert(EPD_7IN5_Display());
    const auto frame = lastCommand(frameCommand).bytes;
    assert(frame.size() == 4000);
    for (size_t i = 0; i < frame.size(); ++i) {
        uint8_t expected = i == 249 * 16 ? 0x7F : i == 15 ? 0xBF : 0xFF;
#ifdef ELECROW_PANEL_JD79661
        expected = ~expected;
#endif
        assert(frame[i] == expected);
    }
    EPD_7IN5_Sleep();
    assert(EPD_7IN5_Display()); // Reinitialize without erasing the pending canvas.
    assert(lastCommand(frameCommand).bytes == frame);
    testPins[PIN_BUSY] = !idle;
    const uint32_t before = millis();
    assert(!EPD_7IN5_Display());
    assert(millis() - before >= 15000 && millis() - before <= 15100);
    assert(!EPD_7IN5_Display()); // A failed panel must not stall every screen.

    // Exact row-padded allocation plus two guards catches the original overflow.
    uint8_t canvas[3906] = {};
    canvas[0] = 0xA5;
    canvas[3905] = 0x5A;
    Paint_NewImage(canvas + 1, 250, 122, 0, WHITE);
    Paint_DrawPixel(249, 121, BLACK);
    assert(canvas[0] == 0xA5 && canvas[3905] == 0x5A);
    Paint_NewImage(nullptr, 250, 122, 0, WHITE);
    Paint_DrawPixel(0, 0, BLACK); // Defensively safe even if caller misbinds canvas.
    puts("Display protocol, packed pixels, sleep, timeout and memory guards passed");
}
