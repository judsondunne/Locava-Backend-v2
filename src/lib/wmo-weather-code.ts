/**
 * Map Open-Meteo WMO weather codes to OpenWeather-style `main` strings
 * so native map icons (Clear, Clouds, Rain, Snow, Few Clouds) stay consistent.
 * @see https://open-meteo.com/en/docs
 */
export function wmoCodeToOpenWeatherMain(code: number): string {
  if (code === 0) return "Clear";
  if (code === 1 || code === 2) return "Few Clouds";
  if (code === 3) return "Clouds";
  if (code === 45 || code === 48) return "Clouds";
  if (code >= 51 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Rain";
  if (code === 85 || code === 86) return "Snow";
  if (code >= 95 && code <= 99) return "Rain";
  return "Clouds";
}
