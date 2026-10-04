#pragma once
// Local overrides are optional; web-install images provision credentials at runtime.
#if __has_include("../config.h")
#include "../config.h"
#else
#include "../config.h.example"
#endif

// Older local config.h files predate this flag.
#ifndef FEATURE_BLE_WHILE_AWAKE
#define FEATURE_BLE_WHILE_AWAKE 1
#endif
