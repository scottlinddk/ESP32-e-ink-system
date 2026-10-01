#include "EPD.h"

// Logical landscape rows are padded to whole bytes. The controller stores
// 250 rows of 128 pixels; rotate/pack during transfer, never overrun the canvas.
static uint8_t s_imageBuffer[((EPD_W + 7) / 8) * EPD_H];
static bool s_ready = false;
#ifdef ELECROW_PANEL_JD79661
static bool s_alternateLut = false;
#endif
static bool s_sleeping = false;
static bool s_canvasBound = false;

#ifdef ELECROW_PANEL_JD79661
static constexpr int BUSY_LEVEL = LOW;
static constexpr const char* CONTROLLER = "JD79661";
#else
static constexpr int BUSY_LEVEL = HIGH;
static constexpr const char* CONTROLLER = "SSD1680";
#endif
static constexpr uint32_t BUSY_ASSERT_TIMEOUT_MS = 1000;
static constexpr uint32_t BUSY_RELEASE_TIMEOUT_MS = 15000;

static void transferByte(uint8_t value) {
#ifdef ELECROW_PANEL_JD79661
    SPI.transfer(value);
#else
    // Original Elecrow factory spi.cpp: MSB first, sample on the rising edge.
    // Keep this path aligned with the reference while diagnosing actual panels.
    for (uint8_t bit = 0; bit < 8; ++bit) {
        digitalWrite(PIN_CLK, LOW);
        digitalWrite(PIN_MOSI, value & 0x80 ? HIGH : LOW);
        digitalWrite(PIN_CLK, HIGH);
        value <<= 1;
    }
#endif
}
static void command(uint8_t value) {
    digitalWrite(PIN_DC, LOW);
    digitalWrite(PIN_CS, LOW);
    transferByte(value);
    digitalWrite(PIN_CS, HIGH);
    digitalWrite(PIN_DC, HIGH);
}
static void data(uint8_t value) {
    digitalWrite(PIN_DC, HIGH);
    digitalWrite(PIN_CS, LOW);
    transferByte(value);
    digitalWrite(PIN_CS, HIGH);
}
static void reg(uint8_t address, std::initializer_list<uint8_t> values) {
    command(address);
    for (uint8_t value : values) data(value);
}
static bool busyFailure(const char* stage, const char* reason, uint32_t elapsed) {
    Serial.printf("[EPD] %s %s: %s after %lu ms; BUSY GPIO%d=%d active=%d, power GPIO%d=%d, reset GPIO%d=%d\n",
        CONTROLLER, stage, reason, static_cast<unsigned long>(elapsed),
        PIN_BUSY, digitalRead(PIN_BUSY), BUSY_LEVEL,
        PIN_POWER, digitalRead(PIN_POWER), PIN_RST, digitalRead(PIN_RST));
    s_ready = false;
    return false;
}

// Reset/configuration can already be idle by the time they are sampled.
static bool waitIdle(const char* stage) {
    const uint32_t start = millis();
    while (digitalRead(PIN_BUSY) == BUSY_LEVEL) {
        if (millis() - start >= BUSY_RELEASE_TIMEOUT_MS)
            return busyFailure(stage, "BUSY did not release", millis() - start);
        delay(10);
    }
    // Match the original factory EPD_READBUSY post-idle settling guard.
    delayMicroseconds(100);
    return true;
}

// A permanently inactive (or wrong-polarity) BUSY pin is not a refresh ack.
// Observe assertion after activation and then release before acknowledging a
// frame. This checks the controller signal, not the visible image on the panel.
static bool waitRefreshCycle() {
    const uint32_t start = millis();
    while (digitalRead(PIN_BUSY) != BUSY_LEVEL) {
        if (millis() - start >= BUSY_ASSERT_TIMEOUT_MS)
            return busyFailure("refresh", "BUSY did not assert", millis() - start);
        delay(1);
    }
    const uint32_t asserted = millis();
    if (!waitIdle("refresh")) return false;
    Serial.printf("[EPD] %s refresh BUSY cycle observed: asserted after %lu ms, active for %lu ms\n",
        CONTROLLER, static_cast<unsigned long>(asserted - start),
        static_cast<unsigned long>(millis() - asserted));
    return true;
}

// Elecrow factory orientation USE_HORIZONTIAL=2: native x=y, native y=249-x.
static uint8_t panelByte(uint16_t nativeRow, uint16_t nativeByte) {
    uint8_t value = 0xFF;
    const uint16_t x = EPD_W - 1 - nativeRow;
    for (uint8_t bit = 0; bit < 8; ++bit) {
        const uint16_t y = nativeByte * 8 + bit;
        if (y < EPD_H && !(s_imageBuffer[y * ((EPD_W + 7) / 8) + x / 8] & (0x80 >> (x % 8)))) {
            value &= ~(0x80 >> bit);
        }
    }
    return value;
}
static void writeFrame(uint8_t address, bool blank = false) {
    command(address);
    for (uint16_t row = 0; row < 250; ++row) {
        for (uint16_t byte = 0; byte < 16; ++byte) {
            uint8_t value = blank ? 0xFF : panelByte(row, byte);
#ifdef ELECROW_PANEL_JD79661
            // Vendor V1.2 PSR/VCOM settings expect black bits set in new RAM.
            if (!blank) value = ~value;
#endif
            data(value);
        }
    }
}
#ifdef ELECROW_PANEL_JD79661
// Full-refresh waveform from Elecrow V1.2 EPD_Init.cpp (56 bytes per register).
// The five waveforms differ only at byte 1; bytes 8..55 are zero.
static void writeLut() {
    const uint8_t phases[] = {0x00, 0x60, 0x20, 0x10, 0x90};
    for (uint8_t index = 0; index < 5; ++index) {
        uint8_t target = index;
        if (s_alternateLut && (index == 2 || index == 3)) target = 5 - index;
        command(0x20 + target);
        const uint8_t prefix[] = {0x01, phases[index], 0x14, 0x14, 0x01, 0x00, 0x00, 0x01};
        for (uint8_t value : prefix) data(value);
        for (uint8_t i = 8; i < 56; ++i) data(0);
    }
    s_alternateLut = !s_alternateLut;
}
#endif

bool EPD_7IN5_Init() {
    if (!s_canvasBound) {
        Paint_NewImage(s_imageBuffer, EPD_W, EPD_H, ROTATE_0, WHITE);
        s_canvasBound = true;
    }
    pinMode(PIN_POWER, OUTPUT);
    digitalWrite(PIN_POWER, HIGH);
    delay(100);
    pinMode(PIN_CS, OUTPUT);
    pinMode(PIN_DC, OUTPUT);
    pinMode(PIN_RST, OUTPUT);
    pinMode(PIN_BUSY, INPUT);
    digitalWrite(PIN_CS, HIGH);
#ifdef ELECROW_PANEL_JD79661
    SPI.begin(PIN_CLK, PIN_MISO, PIN_MOSI, PIN_CS);
    SPI.beginTransaction(SPISettings(4000000, MSBFIRST, SPI_MODE0));
#else
    pinMode(PIN_CLK, OUTPUT);
    pinMode(PIN_MOSI, OUTPUT);
    digitalWrite(PIN_CLK, LOW);
#endif
    digitalWrite(PIN_RST, HIGH);
    delay(10);
    digitalWrite(PIN_RST, LOW);
#ifdef ELECROW_PANEL_JD79661
    delay(100);
    digitalWrite(PIN_RST, HIGH);
    delay(100);
#else
    // Original factory EPD_HW_SW_RESET uses 10 ms low and 10 ms high.
    delay(10);
    digitalWrite(PIN_RST, HIGH);
    delay(10);
#endif
    s_ready = true;
    s_sleeping = false;
#ifdef ELECROW_PANEL_JD79661
    s_alternateLut = false;
    // Elecrow V1.2 / JD79661 sequence. It is NOT SSD1680-compatible.
    reg(0x00, {0xF7, 0x8A});
    reg(0x01, {0x03, 0x00, 0x3F, 0x3F, 0x03});
    reg(0x03, {0x00});
    reg(0x06, {0x27, 0x27, 0x2F});
    reg(0x30, {0x0D});
    reg(0x60, {0x22});
    reg(0x82, {0x07});
    reg(0xE3, {0x88});
    reg(0x41, {0x00});
    reg(0x61, {0x80, 0x00, 0xFA});
    reg(0x65, {0x00, 0x00, 0x00});
    reg(0x50, {0xB7});
    writeFrame(0x10, true);
#else
    if (!waitIdle("hardware reset")) return false;
    command(0x12);
    if (!waitIdle("software reset")) return false;
    reg(0x01, {0xF9, 0x00, 0x00}); // 250 gate lines, not 122
    reg(0x11, {0x03});
    reg(0x44, {0x00, 0x0F});       // 16 native bytes per row
    reg(0x45, {0x00, 0x00, 0xF9, 0x00});
    reg(0x3C, {0x01});
    if (!waitIdle("border configuration")) return false;
    reg(0x18, {0x80});
    reg(0x4E, {0x00});
    reg(0x4F, {0x00, 0x00});
    writeFrame(0x26, true);
#endif
    return waitIdle("initialization");
}

bool EPD_7IN5_Display() {
    if (s_sleeping && !EPD_7IN5_Init()) return false;
    if (!s_ready) return false;
    if (!waitIdle("before refresh")) return false;
#ifdef ELECROW_PANEL_JD79661
    reg(0x50, {0xD7});
    writeFrame(0x13);
    writeLut();
    if (!waitIdle("before activation")) return false;
    reg(0x17, {0xA5});
#else
    reg(0x4E, {0x00});
    reg(0x4F, {0x00, 0x00});
    writeFrame(0x24);
    if (!waitIdle("before activation")) return false;
    // Original factory full update keeps DC/DC and oscillator on (0xF4).
    // Sleep is issued separately when this application finishes its work.
    reg(0x22, {0xF4});
    command(0x20);
#endif
    return waitRefreshCycle();
}
void EPD_7IN5_Clear() {
    Paint_Clear(WHITE);
    EPD_7IN5_Display();
}
void EPD_7IN5_Sleep() {
    if (s_ready) {
#ifdef ELECROW_PANEL_JD79661
        reg(0x07, {0xA5});
#else
        reg(0x10, {0x01});
        reg(0x3C, {0x01});
#endif
        delay(100);
    }
#ifdef ELECROW_PANEL_JD79661
    SPI.endTransaction();
    SPI.end();
#endif
    s_ready = false;
    s_sleeping = true;
}
