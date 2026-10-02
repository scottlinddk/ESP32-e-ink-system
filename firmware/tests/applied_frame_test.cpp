#include "../src/applied_frame.h"
#include <cassert>
#include <string>
#include <type_traits>

static_assert(std::is_trivial<feed::AppliedFrame>::value, "RTC state must not run an initializer after timer wake");

int main() {
  feed::AppliedFrame state{};
  const std::string hash(64, 'a'), changedHash(64, 'b');
  const char* first = "01234567-89ab-4def-8123-456789abcdef";
  const char* second = "01234567-89ab-4def-8123-456789abcdee";
  int draws = 0;
  bool panelWorks = true;
  const auto render = [&]() { ++draws; return panelWorks; };

  assert(state.apply(hash.c_str(), "", render));
  assert(draws == 1 && !strcmp(state.hash, hash.c_str()) && !*state.refreshRequestId);
  assert(state.apply(hash.c_str(), first, render));  // Same pixels, new request.
  assert(draws == 2 && !strcmp(state.refreshRequestId, first));
  assert(state.apply(hash.c_str(), first, render));  // Lost ACK; no second draw.
  assert(draws == 2);
  assert(state.apply(hash.c_str(), second, render));
  assert(draws == 3 && !strcmp(state.refreshRequestId, second));
  assert(state.apply(changedHash.c_str(), second, render));  // ID alone is insufficient.
  assert(draws == 4 && !strcmp(state.hash, changedHash.c_str()));

  panelWorks = false;
  assert(!state.apply(hash.c_str(), first, render));
  assert(draws == 5 && !*state.hash && !*state.refreshRequestId);
  panelWorks = true;
  assert(state.apply(hash.c_str(), first, render));  // Failed panel apply must retry.
  assert(draws == 6);
  assert(state.apply(hash.c_str(), "", render));  // A normal frame forgets the old request.
  assert(draws == 7 && !*state.refreshRequestId);
  assert(state.apply(hash.c_str(), first, render));
  assert(draws == 8);
  state.clear();  // Setup, cold boot or an unknown panel invalidates RTC knowledge.
  assert(!*state.hash && !*state.refreshRequestId);
  assert(state.apply(hash.c_str(), first, render));
  assert(draws == 9);
  for (const char* invalid : {"not-a-uuid", "01234567-89ab-4def-8123-456789abcdefextra", "01234567-89ab-4def-8123-456789abcdeg"}) {
    assert(!state.apply(hash.c_str(), invalid, render));
  }
  assert(!state.apply("bad-hash", second, render));
  assert(draws == 9 && !strcmp(state.refreshRequestId, first));
}
