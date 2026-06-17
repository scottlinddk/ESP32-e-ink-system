#pragma once
// Compatibility shim: the Elecrow EPD library uses #include <arduino.h>
// (lowercase), which fails on case-sensitive Linux filesystems. PlatformIO
// unconditionally adds firmware/include/ to all -I paths, so this shim is
// resolved before any system header, and delegates to the real Arduino.h.
#include <Arduino.h>
