#include <cassert>
#include <cstdio>
#include <cstring>
#include "board_profile.h"

// Compiled once per PlatformIO board define by run_host_tests.py.
int main() {
  static_assert(kBoard.width == 250 && kBoard.height == 122, "2.13-inch geometry");
  static_assert(kBoard.rowBytes() == 32 && kBoard.bmpStride() == 32 && kBoard.bmpBytes() == 3966,
                "backend BMP size for 250x122");
  constexpr BoardProfile large = {"test", "test", 792, 272, 2, false};
  static_assert(large.rowBytes() == 99 && large.bmpStride() == 100 && large.bmpBytes() == 27262,
                "row padding differs from the server row size");
#if defined(ELECROW_PANEL_JD79661)
  assert(!strcmp(kBoard.id, "elecrow-crowpanel-213-v12"));
#elif defined(ELECROW_EPAPER_213)
  assert(!strcmp(kBoard.id, "elecrow-crowpanel-213"));
#else
  assert(!strcmp(kBoard.id, "waveshare-esp32-213-v2"));
#endif
  assert(kBoard.setupButtonIsBootStrap == (kBoard.setupButton == 0));
  printf("Board profile %s: %ux%u\n", kBoard.id, unsigned(kBoard.width), unsigned(kBoard.height));
}
