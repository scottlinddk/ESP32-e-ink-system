#pragma once
#include <vector>
#include <Arduino.h>
#define MSBFIRST 1
#define SPI_MODE0 0
struct SPISettings { SPISettings(int, int, int) {} };
struct SpiCommand { uint8_t address; std::vector<uint8_t> bytes; };
void testTransferByte(uint8_t value);
struct TestSPI {
    std::vector<SpiCommand> commands;
    unsigned starts = 0;
    unsigned transfers = 0;
    void begin(int, int, int, int) { ++starts; }
    void beginTransaction(SPISettings) {}
    void endTransaction() {}
    void end() {}
    uint8_t transfer(uint8_t value) {
        ++transfers;
        testTransferByte(value);
        return 0;
    }
};
extern TestSPI SPI;
