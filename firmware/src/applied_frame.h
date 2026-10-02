#pragma once
#include "feed_validation.h"

namespace feed {
// Retained only while the physical panel is known to contain this frame.
struct AppliedFrame {
  char hash[65];
  char refreshRequestId[37];

  void clear() { hash[0] = 0; refreshRequestId[0] = 0; }

  template <typename Render>
  bool apply(const char* frameHash, const char* requestId, Render render) {
    if (!validHash(frameHash) || !requestId || (*requestId && !validDeviceId(requestId))) return false;
    // A lost heartbeat can repeat the same request. Only this exact pair proves
    // that its requested physical refresh already completed.
    if (*requestId && !strcmp(hash, frameHash) && !strcmp(refreshRequestId, requestId)) return true;
    clear();  // A failed or partial draw invalidates both prior acknowledgements.
    if (!render()) return false;
    strcpy(hash, frameHash);
    strcpy(refreshRequestId, requestId);  // A normal frame clears the request ID.
    return true;
  }
};
}
