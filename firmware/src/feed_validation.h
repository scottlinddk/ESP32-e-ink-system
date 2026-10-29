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

// Clock floor (2025-01-01T00:00:00Z): below this the clock was never set.
constexpr uint32_t kMinValidEpoch = 1735689600u;
// time_t is 32-bit signed on the ESP32 Arduino 2.x core.
constexpr uint32_t kMaxValidEpoch = 2147483647u;

// Two ASCII digits at text[0..1], or -1.
inline int twoDigits(const char* text) {
  return text[0] >= '0' && text[0] <= '9' && text[1] >= '0' && text[1] <= '9' ? (text[0] - '0') * 10 + (text[1] - '0') : -1;
}

// Strict RFC 9110 IMF-fixdate, the only form origin servers may send:
// "Sun, 06 Nov 1994 08:49:37 GMT". Writes Unix seconds and returns true only
// for a well-formed date inside [kMinValidEpoch, kMaxValidEpoch].
inline bool parseHttpDate(const char* value, uint32_t* epoch) {
  static const char* const kDays[] = {"Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"};
  static const char* const kMonths[] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
  if (!value || !epoch || strlen(value) != 29) return false;
  bool dayName = false;
  for (const char* day : kDays) dayName = dayName || !strncmp(value, day, 3);
  if (!dayName || strncmp(value + 3, ", ", 2) || value[7] != ' ' || value[11] != ' ' || value[16] != ' ' ||
      value[19] != ':' || value[22] != ':' || strcmp(value + 25, " GMT")) return false;
  int month = 0;
  while (month < 12 && strncmp(value + 8, kMonths[month], 3)) ++month;
  const int day = twoDigits(value + 5), centuries = twoDigits(value + 12), years = twoDigits(value + 14);
  const int hour = twoDigits(value + 17), minute = twoDigits(value + 20), second = twoDigits(value + 23);
  if (month == 12 || day < 1 || centuries < 0 || years < 0 || hour < 0 || hour > 23 || minute < 0 || minute > 59 ||
      second < 0 || second > 60) return false;  // 60 = leap second; the next second is close enough
  const int year = centuries * 100 + years;
  const bool leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
  static const int kMonthDays[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
  if (day > kMonthDays[month] + (month == 1 && leap)) return false;
  // Days since 1970-01-01 (H. Hinnant's days_from_civil), no timegm() needed.
  const int m = month + 1;  // the algorithm uses months 1..12
  const int y = year - (m <= 2);
  const int era = y / 400;  // year >= 1900 here, so no negative-era correction
  const int yoe = y - era * 400;
  const int mp = (m + 9) % 12;
  const int doy = (153 * mp + 2) / 5 + day - 1;
  const int doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  const int64_t days = int64_t(era) * 146097 + doe - 719468;
  const int64_t seconds = days * 86400 + hour * 3600 + minute * 60 + second;
  if (seconds < kMinValidEpoch || seconds > kMaxValidEpoch) return false;
  *epoch = static_cast<uint32_t>(seconds);
  return true;
}

// Server clock from a response: Date plus Age (seconds a cache held it). An
// absent or malformed Age counts as 0; an Age over a day means the response is
// too stale to trust as a clock.
inline bool serverEpoch(const char* date, const char* age, uint32_t* epoch) {
  uint32_t value;
  if (!parseHttpDate(date, &value)) return false;
  uint32_t held = 0;
  if (age && *age) {
    for (const char* p = age; *p; ++p) {
      if (*p < '0' || *p > '9') { held = 0; break; }
      held = held * 10 + uint32_t(*p - '0');
      if (held > 86400) return false;
    }
  }
  if (value > kMaxValidEpoch - held) return false;
  *epoch = value + held;
  return true;
}
}  // namespace feed
