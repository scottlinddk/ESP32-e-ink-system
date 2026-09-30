#pragma once
#include <stddef.h>
#include <stdint.h>

// Validate all offsets before touching network-supplied BMP pixel data.
// Only uncompressed, 1-bit Windows BMPs matching our display are accepted.
struct MonochromeBitmap {
    const uint8_t* pixels;
    size_t stride;
    uint16_t width;
    uint16_t height;
    bool topDown;
    uint8_t blackIndex;

    static uint32_t u32(const uint8_t* p) {
        return uint32_t(p[0]) | uint32_t(p[1]) << 8 |
               uint32_t(p[2]) << 16 | uint32_t(p[3]) << 24;
    }
    static uint16_t u16(const uint8_t* p) { return p[0] | uint16_t(p[1]) << 8; }
    bool parse(const uint8_t* bytes, size_t length, uint16_t expectedWidth, uint16_t expectedHeight) {
        if (!bytes || length < 62 || bytes[0] != 'B' || bytes[1] != 'M') return false;
        const uint32_t dibSize = u32(bytes + 14);
        const uint32_t offset = u32(bytes + 10);
        if (dibSize < 40 || dibSize > length - 22 || offset > length || offset < 14 + dibSize + 8) return false;
        const int32_t bitmapWidth = static_cast<int32_t>(u32(bytes + 18));
        const int32_t bitmapHeight = static_cast<int32_t>(u32(bytes + 22));
        if (bitmapWidth != expectedWidth ||
            (bitmapHeight != expectedHeight && bitmapHeight != -int32_t(expectedHeight))) return false;
        if (u16(bytes + 26) != 1 || u16(bytes + 28) != 1 || u32(bytes + 30) != 0) return false;
        width = expectedWidth;
        height = expectedHeight;
        stride = ((size_t(width) + 31) / 32) * 4;
        if (stride * height > length - offset) return false;
        const uint8_t* palette = bytes + 14 + dibSize;
        const unsigned first = unsigned(palette[0]) + palette[1] + palette[2];
        const unsigned second = unsigned(palette[4]) + palette[5] + palette[6];
        if (first == second) return false;
        blackIndex = first < second ? 0 : 1;
        topDown = bitmapHeight < 0;
        pixels = bytes + offset;
        return true;
    }
    bool blackAt(uint16_t x, uint16_t y) const {
        const size_t row = topDown ? y : height - 1 - y;
        return ((pixels[row * stride + x / 8] >> (7 - x % 8)) & 1) == blackIndex;
    }
};
