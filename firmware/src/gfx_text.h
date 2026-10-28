#pragma once
#include <Adafruit_GFX.h>
#include <string.h>

// Centres each '\n'-separated line on a GFXcanvas1 and word-wraps lines wider
// than maxWidth. Header-only so boards without Adafruit GFX never compile it.
inline void drawCenteredLines(GFXcanvas1& canvas, const char* text, int16_t top, const GFXfont* font, int16_t maxWidth) {
  if (!text) return;
  canvas.setFont(font);
  canvas.setTextColor(1);
  canvas.setTextWrap(false);
  const int16_t lineHeight = font->yAdvance;
  int16_t baseline = top + lineHeight;
  char line[96];
  size_t length = 0;
  auto widthOf = [&](const char* value) {
    int16_t x1, y1;
    uint16_t w, h;
    canvas.getTextBounds(value, 0, 0, &x1, &y1, &w, &h);
    return int16_t(w);
  };
  auto emit = [&]() {
    line[length] = '\0';
    if (baseline <= canvas.height()) {
      canvas.setCursor((canvas.width() - widthOf(line)) / 2, baseline);
      canvas.print(line);
    }
    baseline += lineHeight;
    length = 0;
  };
  while (*text) {
    if (*text == '\n') { emit(); ++text; continue; }
    // Next word plus its leading space, if the line already has content.
    const char* end = text;
    while (*end && *end != ' ' && *end != '\n') ++end;
    const size_t word = size_t(end - text);
    char candidate[sizeof(line)];
    const size_t prefix = length ? length + 1 : 0;
    if (prefix + word < sizeof(candidate)) {
      memcpy(candidate, line, length);
      if (length) candidate[length] = ' ';
      memcpy(candidate + prefix, text, word);
      candidate[prefix + word] = '\0';
      if (length && widthOf(candidate) > maxWidth) {
        emit();
        continue;  // Retry the word on a fresh line.
      }
      memcpy(line, candidate, prefix + word + 1);
      length = prefix + word;
    } else if (length) {
      emit();
      continue;
    } else {
      // A single overlong word: truncate it to the line buffer.
      length = sizeof(line) - 1;
      memcpy(line, text, length);
    }
    text = end;
    while (*text == ' ') ++text;
  }
  if (length) emit();
}
