#pragma once
#include <vector>
#include <Arduino.h>
#define MSBFIRST 1
#define SPI_MODE0 0
struct SPISettings { SPISettings(int, int, int) {} };
struct SpiCommand { uint8_t address; std::vector<uint8_t> bytes; };
struct TestSPI {
    std::vector<SpiCommand> commands;
    void begin(int, int, int, int) {}
    void beginTransaction(SPISettings) {}
    void endTransaction() {}
    void end() {}
    uint8_t transfer(uint8_t value) {
        if (testPins[13] == LOW) commands.push_back({value, {}});
        else commands.back().bytes.push_back(value);
        return 0;
    }
};
extern TestSPI SPI;
