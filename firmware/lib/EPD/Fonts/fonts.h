#pragma once
// ESP32-compatible: Arduino.h provides pgmspace.h compatibility (PROGMEM is a no-op,
// pgm_read_byte reads normally from flash-mapped memory).
#include <Arduino.h>
#include <stdint.h>

typedef struct {
    const uint8_t *table;
    uint16_t       Width;
    uint16_t       Height;
} sFONT;

extern sFONT Font8;   // 5 × 8  px
extern sFONT Font12;  // 7 × 12 px
extern sFONT Font16;  // 11 × 16 px
