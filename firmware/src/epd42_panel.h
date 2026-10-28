#pragma once
#include "epd42_frame.h"

// Driver for the Elecrow CrowPanel 4.2" e-paper. Two hardware revisions use
// different display controllers with incompatible command sets; the PlatformIO
// environment links exactly one controller implementation:
//   elecrow_42     epd42_controller_ssd1683.cpp  original board (SSD1683)
//   elecrow_42_v2  epd42_controller_v2.cpp       board with the green circular
//                                                sticker on the back (-D ELECROW_PANEL_42_V2)
// Only full refresh is implemented.

namespace epd42 {
// Controller hooks, one implementation per revision. The bus is already powered.
bool configure();                    // reset and register setup; never refreshes
bool refresh(const Epd42Frame& frame);  // write image RAM, full refresh, wait for the BUSY cycle
void powerDown();                    // deep sleep; configure() wakes it with a hardware reset
}  // namespace epd42

class Epd42Panel {
public:
  // Powers the rail and configures the controller without refreshing, so the
  // retained image survives a reboot.
  bool begin();
  // Replaces the whole image. True once a BUSY refresh cycle was observed.
  bool write(const Epd42Frame& frame);
  void sleep();

private:
  bool ready_ = false;
  // A timeout latches the driver unavailable for the rest of the awake session
  // so later screens do not each stall for another timeout. begin() clears it.
  bool unavailable_ = false;
};
