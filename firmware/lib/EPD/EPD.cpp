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

static void command(uint8_t value) {
    digitalWrite(PIN_DC, LOW);
    digitalWrite(PIN_CS, LOW);
    SPI.transfer(value);
    digitalWrite(PIN_CS, HIGH);
}
static void data(uint8_t value) {
    digitalWrite(PIN_DC, HIGH);
    digitalWrite(PIN_CS, LOW);
    SPI.transfer(value);
    digitalWrite(PIN_CS, HIGH);
}
static void reg(uint8_t address, std::initializer_list<uint8_t> values) {
    command(address);
    for (uint8_t value : values) data(value);
}
static bool waitReady() {
#ifdef ELECROW_PANEL_JD79661
    const int busyLevel = LOW;
#else
    const int busyLevel = HIGH;
#endif
    // Allow the controller to assert BUSY after a refresh command.
    delay(10);
    const uint32_t start = millis();
    while (digitalRead(PIN_BUSY) == busyLevel) {
        if (millis() - start >= 15000) {
            Serial.println("[EPD] BUSY timeout; check panel revision, power and connection");
            s_ready = false;
            return false;
        }
        delay(10);
    }
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
    SPI.begin(PIN_CLK, PIN_MISO, PIN_MOSI, PIN_CS);
    SPI.beginTransaction(SPISettings(4000000, MSBFIRST, SPI_MODE0));
    digitalWrite(PIN_RST, HIGH);
    delay(10);
    digitalWrite(PIN_RST, LOW);
    delay(100);
    digitalWrite(PIN_RST, HIGH);
    delay(100);
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
    if (!waitReady()) return false;
    command(0x12);
    if (!waitReady()) return false;
    reg(0x01, {0xF9, 0x00, 0x00}); // 250 gate lines, not 122
    reg(0x11, {0x03});
    reg(0x44, {0x00, 0x0F});       // 16 native bytes per row
    reg(0x45, {0x00, 0x00, 0xF9, 0x00});
    reg(0x3C, {0x01});
    reg(0x18, {0x80});
    reg(0x4E, {0x00});
    reg(0x4F, {0x00, 0x00});
    writeFrame(0x26, true);
#endif
    return waitReady();
}

bool EPD_7IN5_Display() {
    if (s_sleeping && !EPD_7IN5_Init()) return false;
    if (!s_ready) return false;
#ifdef ELECROW_PANEL_JD79661
    reg(0x50, {0xD7});
    writeFrame(0x13);
    writeLut();
    reg(0x17, {0xA5});
#else
    reg(0x4E, {0x00});
    reg(0x4F, {0x00, 0x00});
    writeFrame(0x24);
    reg(0x22, {0xF7});
    command(0x20);
#endif
    return waitReady();
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
#endif
        delay(100);
    }
    SPI.endTransaction();
    SPI.end();
    s_ready = false;
    s_sleeping = true;
}
