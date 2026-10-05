#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

// Pure protocol validation shared by firmware and host regression tests.
namespace feed {
inline bool hex(char c) { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'); }
inline bool validHash(const char* value) {
  if (!value || strlen(value) != 64) return false;
  for (size_t i = 0; i < 64; i++) if (!hex(value[i])) return false;
  return true;
}
inline bool validDeviceId(const char* value) {
  if (!value || strlen(value) != 36) return false;
  for (size_t i = 0; i < 36; i++) {
    if (i == 8 || i == 13 || i == 18 || i == 23) { if (value[i] != '-') return false; }
    else if (!hex(value[i]) && !(value[i] >= 'A' && value[i] <= 'F')) return false;
  }
  return true;
}
inline bool validToken(const char* value) {
  if (!value || strlen(value) != 49 || strncmp(value, "einkd_", 6)) return false;
  for (size_t i = 6; i < 49; i++) {
    const char c = value[i];
    if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-')) return false;
  }
  return true;
}
inline bool validBaseUrl(const char* value) {
  if (!value || strncmp(value, "https://", 8) || strlen(value) >= 192) return false;
  const char* host = value + 8;
  if (!*host || *host == '/' || *host == ':' || *host == '.') return false;
  const char* path = strchr(host, '/');
  for (const char* p = host; *p; p++) {
    if (static_cast<unsigned char>(*p) <= 32 || *p == '@' || *p == '?' || *p == '#' || *p == '\\' || *p == '"' || *p == '\'' || *p == '<' || *p == '>') return false;
  }
  return !path || !strcmp(path, "/") || !strcmp(path, "/api") || !strcmp(path, "/api/");
}
inline uint32_t retrySeconds(const char* value) {
  if (!value || !*value) return 60;
  uint32_t result = 0;
  for (const char* p = value; *p; p++) {
    if (*p < '0' || *p > '9') return 60;
    if (result > 86400) return 86400;
    result = result * 10 + (*p - '0');
  }
  return result < 1 ? 1 : result > 86400 ? 86400 : result;
}
// X-Instant-Updates: 1 = stay online and check for requests, 0 = deep sleep,
// -1 = absent/invalid (an error response); keep the previously known mode.
inline int instantMode(const char* value) {
  if (!value) return -1;
  if (!strcmp(value, "1")) return 1;
  if (!strcmp(value, "0")) return 0;
  return -1;
}
// Exact canonical decimal: "0122" or "122 " never match 122.
inline bool decimalIs(const char* value, uint32_t expected) {
  char text[11];
  snprintf(text, sizeof(text), "%lu", static_cast<unsigned long>(expected));
  return value && !strcmp(value, text);
}
// Clockwise content rotation applied by the server renderer.
inline bool validRotation(const char* value) {
  return value && (!strcmp(value, "0") || !strcmp(value, "90") || !strcmp(value, "180") || !strcmp(value, "270"));
}
// The server reports native panel geometry; rotation only changes the content.
inline bool frameGeometry(const char* width, const char* height, const char* rotation, const char* rowBytes,
                          uint16_t nativeWidth, uint16_t nativeHeight) {
  return decimalIs(width, nativeWidth) && decimalIs(height, nativeHeight) && validRotation(rotation) &&
         decimalIs(rowBytes, (nativeWidth + 7u) / 8u);
}
// Request checks are bounded so a bad hint can neither spin nor stall updates.
inline uint32_t instantCheckSeconds(const char* value) {
  if (!value || !*value) return 5;
  const uint32_t seconds = retrySeconds(value);
  return seconds < 2 ? 2 : seconds > 60 ? 60 : seconds;
}
}
