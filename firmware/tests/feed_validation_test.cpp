#include "../src/feed_validation.h"
#include <cassert>
#include <string>

int main() {
  assert(feed::validBaseUrl("https://esp32.scottlind.dk"));
  assert(feed::validBaseUrl("https://esp32.scottlind.dk/api/"));
  assert(!feed::validBaseUrl("http://esp32.scottlind.dk"));
  assert(!feed::validBaseUrl("https://user:secret@host/api"));
  assert(!feed::validBaseUrl("https:///api"));
  assert(!feed::validBaseUrl("https://host/api?token=secret"));
  assert(!feed::validBaseUrl("https://host/api#fragment"));
  assert(!feed::validBaseUrl("https://host/api/devices"));
  assert(!feed::validBaseUrl("https://host/\r\nAuthorization: injected"));
  assert(!feed::validBaseUrl(("https://" + std::string(192, 'a')).c_str()));
  assert(feed::validDeviceId("01234567-89ab-cdef-0123-456789abcdef"));
  assert(!feed::validDeviceId("01234567/89ab-cdef-0123-456789abcdef"));
  assert(!feed::validDeviceId("not-a-device"));
  assert(feed::validToken(("einkd_" + std::string(43, 'a')).c_str()));
  assert(!feed::validToken(("einkd_" + std::string(44, 'a')).c_str()));
  assert(!feed::validToken(("einkd_" + std::string(42, 'a') + "\n").c_str()));
  assert(!feed::validToken("legacy-license-key"));
  assert(feed::validHash(std::string(64, 'a').c_str()));
  assert(!feed::validHash(std::string(64, 'A').c_str()));
  assert(!feed::validHash(""));
  assert(feed::retrySeconds("300") == 300);
  assert(feed::retrySeconds("0") == 1);
  assert(feed::retrySeconds("999999999999999999999999") == 86400);
  assert(feed::retrySeconds("") == 60);
  assert(feed::retrySeconds("-10") == 60);
  assert(feed::retrySeconds("1a") == 60);
  assert(feed::instantMode("1") == 1);
  assert(feed::instantMode("0") == 0);
  assert(feed::instantMode("") == -1);
  assert(feed::instantMode("true") == -1);
  assert(feed::instantMode(nullptr) == -1);
  assert(feed::instantCheckSeconds("5") == 5);
  assert(feed::instantCheckSeconds("") == 5);
  assert(feed::instantCheckSeconds("0") == 2);
  assert(feed::instantCheckSeconds("3600") == 60);
  assert(feed::instantCheckSeconds("x") == 60);
  // Native geometry must match exactly; every server content rotation is accepted.
  for (const char* rotation : {"0", "90", "180", "270"})
    assert(feed::frameGeometry("250", "122", rotation, "32", 250, 122));
  assert(feed::frameGeometry("400", "300", "0", "50", 400, 300));
  assert(feed::frameGeometry("792", "272", "90", "99", 792, 272));
  assert(!feed::frameGeometry("792", "272", "0", "100", 792, 272));  // BMP stride is not the row size
  assert(!feed::frameGeometry("122", "250", "90", "16", 250, 122));  // swapped native size
  assert(!feed::frameGeometry("250", "122", "45", "32", 250, 122));
  assert(!feed::frameGeometry("250", "122", "", "32", 250, 122));
  assert(!feed::frameGeometry("0250", "122", "0", "32", 250, 122));
  assert(!feed::frameGeometry("250 ", "122", "0", "32", 250, 122));
  assert(!feed::frameGeometry(nullptr, "122", "0", "32", 250, 122));
  assert(!feed::validRotation("-90") && !feed::validRotation("360") && !feed::validRotation(nullptr));
}
