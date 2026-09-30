#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#define HIGH 1
#define LOW 0
#define OUTPUT 1
#define INPUT 0
#define PROGMEM
extern int testPins[64];
extern uint32_t testMillis;
inline void pinMode(int, int) {}
inline void digitalWrite(int pin, int value) { testPins[pin] = value; }
inline int digitalRead(int pin) { return testPins[pin]; }
inline uint32_t millis() { return testMillis; }
inline void delay(uint32_t amount) { testMillis += amount; }
struct TestSerial { void println(const char*) {} };
extern TestSerial Serial;
