import { normalizeWeatherLocation } from './weatherLocation';

/** Used when no location is saved; matches the default weather location. */
const DEFAULT_WEATHER_LOCATION = '55.3,10.4';

/** Sun centre at -0.833°: the upper limb touches the horizon, allowing for refraction. This is the usual definition of sunrise and sunset. */
const HORIZON_DEGREES = -0.833;

const rad = (degrees: number) => (degrees * Math.PI) / 180;
const deg = (radians: number) => (radians * 180) / Math.PI;

/**
 * Height of the sun's centre above the horizon, in degrees (NOAA solar position equations, good to about a minute).
 * Needs no network call, so it also works in polar day and night, where a provider reports no sunrise or sunset.
 */
export function sunAltitude(date: Date, latitude: number, longitude: number): number {
  const julianDay = date.getTime() / 86_400_000 + 2_440_587.5;
  const t = (julianDay - 2_451_545) / 36_525;
  const meanLongitude = (280.46646 + t * (36_000.76983 + t * 0.0003032)) % 360;
  const meanAnomaly = 357.52911 + t * (35_999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const equationOfCentre = Math.sin(rad(meanAnomaly)) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(rad(2 * meanAnomaly)) * (0.019993 - 0.000101 * t)
    + Math.sin(rad(3 * meanAnomaly)) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const apparentLongitude = meanLongitude + equationOfCentre - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(rad(omega));
  const declination = Math.asin(Math.sin(rad(obliquity)) * Math.sin(rad(apparentLongitude)));

  const y = Math.tan(rad(obliquity) / 2) ** 2;
  const L0 = rad(meanLongitude);
  const M = rad(meanAnomaly);
  const equationOfTime = 4 * deg(y * Math.sin(2 * L0) - 2 * eccentricity * Math.sin(M)
    + 4 * eccentricity * y * Math.sin(M) * Math.cos(2 * L0) - 0.5 * y * y * Math.sin(4 * L0)
    - 1.25 * eccentricity * eccentricity * Math.sin(2 * M));

  const minutesUtc = (((date.getTime() % 86_400_000) + 86_400_000) % 86_400_000) / 60_000;
  const hourAngle = rad((minutesUtc + equationOfTime + 4 * longitude) / 4 - 180);
  const latitudeRad = rad(latitude);
  return deg(Math.asin(Math.sin(latitudeRad) * Math.sin(declination)
    + Math.cos(latitudeRad) * Math.cos(declination) * Math.cos(hourAngle)));
}

/** True between sunset and sunrise at a place (polar night included, polar day excluded). */
export function isDark(date: Date, latitude: number, longitude: number): boolean {
  return sunAltitude(date, latitude, longitude) < HORIZON_DEGREES;
}

/**
 * Whether a layout set to follow the sun is dark at `date`, for a saved "lat,lng" weather location.
 * An unusable location reads as daylight, so the screen stays in its normal colours rather than guessing.
 */
export function isDarkAt(date: Date, location: string | null | undefined): boolean {
  try {
    const [latitude, longitude] = normalizeWeatherLocation(location ?? DEFAULT_WEATHER_LOCATION).split(',').map(Number);
    return isDark(date, latitude, longitude);
  } catch {
    return false;
  }
}
