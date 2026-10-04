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
}
