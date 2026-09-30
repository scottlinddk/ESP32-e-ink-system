#pragma once
#include <cstdint>
#include <cstddef>
#include <cstdarg>
#include <cstdio>
#include <functional>
#include <string>

inline uint32_t testMillis = 0;
inline std::function<void()> testDelayHook;
inline uint32_t millis() { return testMillis; }
inline void delay(uint32_t amount) {
  testMillis += amount;
  if (testDelayHook) testDelayHook();
}
struct TestSerial {
  std::string output;
  void printf(const char* format, ...) {
    char message[512];
    va_list args;
    va_start(args, format);
    std::vsnprintf(message, sizeof(message), format, args);
    va_end(args);
    output += message;
  }
};
inline TestSerial Serial;
