#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdarg.h>
#include <stdio.h>
#include <string>
#define HIGH 1
#define LOW 0
#define OUTPUT 1
#define INPUT 0
#define PROGMEM
extern int testPins[64];
extern uint32_t testMillis;
void testPinMode(int pin, int mode);
void testWritePin(int pin, int value);
int testReadPin(int pin);
inline void pinMode(int pin, int mode) { testPinMode(pin, mode); }
inline void digitalWrite(int pin, int value) { testWritePin(pin, value); }
inline int digitalRead(int pin) { return testReadPin(pin); }
inline uint32_t millis() { return testMillis; }
inline void delay(uint32_t amount) { testMillis += amount; }
inline void delayMicroseconds(uint32_t amount) { testMillis += amount / 1000; }
struct TestSerial {
    std::string output;
    void println(const char* value) { output += value; output += '\n'; }
    void printf(const char* format, ...) {
        char buffer[512];
        va_list args;
        va_start(args, format);
        vsnprintf(buffer, sizeof(buffer), format, args);
        va_end(args);
        output += buffer;
    }
};
extern TestSerial Serial;
