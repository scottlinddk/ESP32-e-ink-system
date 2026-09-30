#pragma once
// Local overrides are optional; web-install images provision credentials at runtime.
#if __has_include("../config.h")
#include "../config.h"
#else
#include "../config.h.example"
#endif
