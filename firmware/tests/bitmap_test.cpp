#include <assert.h>
#include <stdio.h>
#include <vector>
#include "bitmap.h"

void put32(std::vector<uint8_t>& b, size_t at, uint32_t value) {
    for (int i = 0; i < 4; ++i) b[at + i] = value >> (8 * i);
}
std::vector<uint8_t> valid() {
    std::vector<uint8_t> b(62 + 32 * 122, 0);
    b[0] = 'B'; b[1] = 'M';
    put32(b, 2, b.size()); put32(b, 10, 62); put32(b, 14, 40);
    put32(b, 18, 250); put32(b, 22, 122);
    b[26] = 1; b[28] = 1;
    b[58] = b[59] = b[60] = 255;
    for (size_t i = 62; i < b.size(); ++i) b[i] = 255;
    b[62 + 121 * 32] = 0x7F; // Bottom-up BMP: first visible pixel black.
    return b;
}
int main() {
    MonochromeBitmap bmp;
    auto b = valid();
    assert(bmp.parse(b.data(), b.size(), 250, 122));
    assert(bmp.blackAt(0, 0) && !bmp.blackAt(1, 0) && !bmp.blackAt(0, 121));
    put32(b, 22, uint32_t(-122));
    assert(bmp.parse(b.data(), b.size(), 250, 122));
    assert(!bmp.blackAt(0, 0) && bmp.blackAt(0, 121));
    b[54] = b[55] = b[56] = 255;
    b[58] = b[59] = b[60] = 0;
    assert(bmp.parse(b.data(), b.size(), 250, 122));
    assert(bmp.blackAt(0, 0) && !bmp.blackAt(0, 121));
    assert(!bmp.parse(nullptr, 0, 250, 122));
    for (size_t length = 0; length < b.size(); ++length)
        assert(!bmp.parse(b.data(), length, 250, 122));
    for (auto pair : std::vector<std::pair<size_t, uint32_t>>{
            {10, 0xFFFFFFFF}, {10, 40}, {14, 0xFFFFFFFF}, {14, 39},
            {18, 0xFFFFFFFF}, {18, 0}, {22, 0x80000000}, {22, 0}, {30, 1}}) {
        b = valid(); put32(b, pair.first, pair.second);
        assert(!bmp.parse(b.data(), b.size(), 250, 122));
    }
    b = valid(); b[0] = 'Z'; assert(!bmp.parse(b.data(), b.size(), 250, 122));
    b = valid(); b[28] = 24; assert(!bmp.parse(b.data(), b.size(), 250, 122));
    b = valid(); b[26] = 0; assert(!bmp.parse(b.data(), b.size(), 250, 122));
    puts("BMP dimensions, orientation, palette and malformed data checks passed");
}
