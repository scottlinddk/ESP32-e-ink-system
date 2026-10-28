#ifdef ELECROW_EPAPER_42
#include <Arduino.h>
#include "epd42_panel.h"
#include "epd42_bus.h"

bool Epd42Panel::begin() {
  unavailable_ = false;
  epd42::busBegin();
  ready_ = epd42::configure();
  unavailable_ = !ready_;
  return ready_;
}

bool Epd42Panel::write(const Epd42Frame& frame) {
  if (unavailable_) return false;
  if (!ready_ && !begin()) return false;
  if (!epd42::refresh(frame)) {
    unavailable_ = true;
    return false;
  }
  return true;
}

void Epd42Panel::sleep() {
  if (ready_) epd42::powerDown();
  ready_ = false;
}
#endif
