#include "EPD.h"
#include "GUI_Paint.h"

// ── Internal image buffer ─────────────────────────────────────────────────────
// 1 bit per pixel, packed, row-major.  Size = ceil(W/8) * H bytes.
static uint8_t s_imageBuffer[(EPD_W * EPD_H + 7) / 8];

// ── Low-level SPI helpers ─────────────────────────────────────────────────────
static void epd_delay(uint32_t ms) { delay(ms); }

static void epd_send_byte(uint8_t data) {
    SPI.transfer(data);
}

static void epd_send_cmd(uint8_t cmd) {
    digitalWrite(PIN_DC, LOW);
    digitalWrite(PIN_CS, LOW);
    epd_send_byte(cmd);
    digitalWrite(PIN_CS, HIGH);
}

static void epd_send_data(uint8_t data) {
    digitalWrite(PIN_DC, HIGH);
    digitalWrite(PIN_CS, LOW);
    epd_send_byte(data);
    digitalWrite(PIN_CS, HIGH);
}

static void epd_wait_busy(void) {
    // BUSY pin is active HIGH on SSD1680
    while (digitalRead(PIN_BUSY) == HIGH) {
        epd_delay(10);
    }
}

static void epd_reset(void) {
    digitalWrite(PIN_RST, HIGH);
    epd_delay(10);
    digitalWrite(PIN_RST, LOW);
    epd_delay(10);
    digitalWrite(PIN_RST, HIGH);
    epd_delay(10);
}

// ── Public API ────────────────────────────────────────────────────────────────

void EPD_7IN5_Init(void) {
    // Configure SPI with board-defined pins
    SPI.begin(PIN_CLK, PIN_MISO, PIN_MOSI, PIN_CS);
    SPI.beginTransaction(SPISettings(4000000, MSBFIRST, SPI_MODE0));

    pinMode(PIN_CS,   OUTPUT);
    pinMode(PIN_DC,   OUTPUT);
    pinMode(PIN_RST,  OUTPUT);
    pinMode(PIN_BUSY, INPUT);

    digitalWrite(PIN_CS, HIGH);

    epd_reset();
    epd_wait_busy();

    // Software reset
    epd_send_cmd(0x12);
    epd_wait_busy();

    // Driver output control: MUX = 121 (EPD_H-1), TB=0, SM=0, GD=0
    epd_send_cmd(0x01);
    epd_send_data((EPD_H - 1) & 0xFF);
    epd_send_data(((EPD_H - 1) >> 8) & 0xFF);
    epd_send_data(0x00);

    // Data entry mode: X/Y increment, address update in X direction
    epd_send_cmd(0x11);
    epd_send_data(0x03);

    // Set RAM X address range: 0 to (EPD_W/8 - 1)
    epd_send_cmd(0x44);
    epd_send_data(0x00);
    epd_send_data((EPD_W / 8) - 1);

    // Set RAM Y address range: 0 to (EPD_H - 1)
    epd_send_cmd(0x45);
    epd_send_data(0x00);
    epd_send_data(0x00);
    epd_send_data((EPD_H - 1) & 0xFF);
    epd_send_data(((EPD_H - 1) >> 8) & 0xFF);

    // Border waveform: follow VSS
    epd_send_cmd(0x3C);
    epd_send_data(0x05);

    // Temperature sensor: use internal
    epd_send_cmd(0x18);
    epd_send_data(0x80);

    // Display update control 2
    epd_send_cmd(0x22);
    epd_send_data(0xB1);

    // Master activation — loads LUT from OTP
    epd_send_cmd(0x20);
    epd_wait_busy();

    // Set RAM X cursor to start
    epd_send_cmd(0x4E);
    epd_send_data(0x00);

    // Set RAM Y cursor to start
    epd_send_cmd(0x4F);
    epd_send_data(0x00);
    epd_send_data(0x00);

    // Register image buffer with the paint layer
    Paint_NewImage(s_imageBuffer, EPD_W, EPD_H, ROTATE_0, WHITE);
}

void EPD_7IN5_Display(void) {
    uint32_t bufferSize = (EPD_W * EPD_H + 7) / 8;

    // Set RAM X cursor to start
    epd_send_cmd(0x4E);
    epd_send_data(0x00);

    // Set RAM Y cursor to start
    epd_send_cmd(0x4F);
    epd_send_data(0x00);
    epd_send_data(0x00);

    // Write RAM (black/white)
    epd_send_cmd(0x24);
    for (uint32_t i = 0; i < bufferSize; i++) {
        epd_send_data(s_imageBuffer[i]);
    }

    // Display update control 2: enable clock, enable analog, display
    epd_send_cmd(0x22);
    epd_send_data(0xF7);

    // Master activation
    epd_send_cmd(0x20);
    epd_wait_busy();
}

void EPD_7IN5_Clear(void) {
    uint32_t bufferSize = (EPD_W * EPD_H + 7) / 8;

    epd_send_cmd(0x4E); epd_send_data(0x00);
    epd_send_cmd(0x4F); epd_send_data(0x00); epd_send_data(0x00);

    epd_send_cmd(0x24);
    for (uint32_t i = 0; i < bufferSize; i++) {
        epd_send_data(0xFF); // all white
    }

    epd_send_cmd(0x22);
    epd_send_data(0xF7);
    epd_send_cmd(0x20);
    epd_wait_busy();
}

void EPD_7IN5_Sleep(void) {
    epd_send_cmd(0x10); // Enter deep sleep mode 1
    epd_send_data(0x01);
    epd_delay(100);
    SPI.endTransaction();
}
