// SD card support — ESP32-compatible rewrite of Elecrow's AVR-targeted file.
//
// Errors fixed in this file:
//
// Error 2a (line ~118): 'Sd2Card' was not declared in this scope
//   Root cause: Sd2Card is a low-level class from the AVR SD library that does
//   not exist in the ESP32 SD library.  The ESP32 Arduino core ships the
//   higher-level SD (SDFS) library instead.  Fix: use SD.begin() / SD.open().
//
// Error 2b (line ~119): 'SPI_FULL_SPEED' was not declared in this scope
//   Root cause: SPI_FULL_SPEED is an AVR-specific speed constant.  Fix:
//   removed — SD.begin() on ESP32 uses a configurable MHz argument directly.
//
// Error 3 (lines ~284-286): invalid conversion from 'char*' to 'uint8_t*'
//   Root cause: File::read() on ESP32 takes (uint8_t*, size_t); passing a
//   char* buffer causes a type-conversion error in C++.  Fix: cast to
//   uint8_t* with reinterpret_cast<uint8_t*>.

#include "EPD_SDCard.h"
#include <SD.h>
#include <SPI.h>

bool SDCard_Init(void) {
    // SD.begin() on ESP32 accepts (csPin) or (csPin, spi, freq).
    // No SPI_FULL_SPEED constant needed — the default is 4 MHz, which is fine.
    if (!SD.begin(SD_CS_PIN)) {
        Serial.println("[SDCard] SD.begin() failed");
        return false;
    }
    Serial.println("[SDCard] SD card initialized");
    return true;
}

// Read raw bytes from a file on the SD card into buf.
// Fix for error 3: File::read() requires uint8_t*, so we cast char* → uint8_t*.
bool SDCard_Read_RGB_7Color(const char *path, uint8_t *buf, uint32_t len) {
    File bmpFile = SD.open(path, FILE_READ);
    if (!bmpFile) {
        Serial.printf("[SDCard] Cannot open: %s\n", path);
        return false;
    }

    // Fix: reinterpret_cast converts buf (uint8_t*) — already correct type.
    // If the caller passes a char* buffer, wrap with reinterpret_cast<uint8_t*>.
    uint32_t bytesRead = bmpFile.read(reinterpret_cast<uint8_t*>(buf), len);
    bmpFile.close();

    if (bytesRead != len) {
        Serial.printf("[SDCard] Short read: got %u of %u bytes\n", bytesRead, len);
        return false;
    }
    return true;
}
