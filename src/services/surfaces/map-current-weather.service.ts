import { wmoCodeToOpenWeatherMain } from "../../lib/wmo-weather-code.js";
import type { MapCurrentWeatherResponse } from "../../contracts/surfaces/map-current-weather.contract.js";

const OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast";
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 400;

type CacheEntry = { expiresAt: number; value: MapCurrentWeatherResponse };

const cache = new Map<string, CacheEntry>();

function cacheKey(provider: "open_meteo" | "openweathermap", lat: number, lon: number): string {
  return `${provider}:${lat.toFixed(2)}:${lon.toFixed(2)}`;
}

function pruneCache(): void {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (v.expiresAt <= now) cache.delete(k);
  }
  if (cache.size <= CACHE_MAX) return;
  const entries = [...cache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  const overflow = cache.size - CACHE_MAX;
  for (let i = 0; i < overflow; i += 1) {
    cache.delete(entries[i]![0]);
  }
}

type OpenMeteoJson = {
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    weather_code?: number;
  };
  daily?: {
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
  };
};

type OpenWeatherJson = {
  main?: { temp?: number; temp_max?: number; temp_min?: number; feels_like?: number };
  weather?: Array<{ main?: string }>;
};

export class MapCurrentWeatherService {
  constructor(private readonly openWeatherApiKey?: string) {}

  async getCurrent(params: {
    lat: number;
    lon: number;
    signal?: AbortSignal;
  }): Promise<MapCurrentWeatherResponse | null> {
    const provider: "open_meteo" | "openweathermap" = this.openWeatherApiKey ? "openweathermap" : "open_meteo";
    const key = cacheKey(provider, params.lat, params.lon);
    const now = Date.now();
    pruneCache();
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now) {
      return hit.value;
    }

    const value =
      provider === "openweathermap"
        ? await this.fetchOpenWeather(params.lat, params.lon, params.signal)
        : await this.fetchOpenMeteo(params.lat, params.lon, params.signal);

    if (value) {
      cache.set(key, { expiresAt: now + CACHE_TTL_MS, value });
    }
    return value;
  }

  private async fetchOpenMeteo(lat: number, lon: number, signal?: AbortSignal): Promise<MapCurrentWeatherResponse | null> {
    const url = new URL(OPEN_METEO_BASE);
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lon));
    url.searchParams.set("current", "temperature_2m,apparent_temperature,weather_code");
    url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min");
    url.searchParams.set("temperature_unit", "fahrenheit");
    url.searchParams.set("forecast_days", "1");
    url.searchParams.set("timezone", "auto");

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: "GET",
        signal,
        headers: { accept: "application/json" }
      });
    } catch {
      return null;
    }
    if (!res.ok) return null;

    let body: OpenMeteoJson;
    try {
      body = (await res.json()) as OpenMeteoJson;
    } catch {
      return null;
    }

    const cur = body.current;
    const temp = cur?.temperature_2m;
    const feels = cur?.apparent_temperature;
    const wmo = cur?.weather_code;
    if (typeof temp !== "number" || !Number.isFinite(temp)) return null;

    const dailyMax = body.daily?.temperature_2m_max?.[0];
    const dailyMin = body.daily?.temperature_2m_min?.[0];
    const tempMax = typeof dailyMax === "number" && Number.isFinite(dailyMax) ? dailyMax : temp;
    const tempMin = typeof dailyMin === "number" && Number.isFinite(dailyMin) ? dailyMin : temp;
    const feelsLike = typeof feels === "number" && Number.isFinite(feels) ? feels : temp;
    const code = typeof wmo === "number" && Number.isFinite(wmo) ? Math.round(wmo) : 3;
    const condition = wmoCodeToOpenWeatherMain(code);

    return {
      routeName: "map.current_weather.get",
      temp,
      tempMax,
      tempMin,
      feelsLike,
      condition,
      weatherCode: code,
      source: "open_meteo"
    };
  }

  private async fetchOpenWeather(lat: number, lon: number, signal?: AbortSignal): Promise<MapCurrentWeatherResponse | null> {
    const apiKey = this.openWeatherApiKey?.trim();
    if (!apiKey) return null;

    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lon))}&units=imperial&appid=${encodeURIComponent(apiKey)}`;

    let res: Response;
    try {
      res = await fetch(url, { method: "GET", signal, headers: { accept: "application/json" } });
    } catch {
      return null;
    }
    if (!res.ok) return null;

    let body: OpenWeatherJson;
    try {
      body = (await res.json()) as OpenWeatherJson;
    } catch {
      return null;
    }

    const main = body.main;
    const condition = body.weather?.[0]?.main ?? "Clouds";
    const temp = main?.temp;
    if (typeof temp !== "number" || !Number.isFinite(temp)) return null;

    return {
      routeName: "map.current_weather.get",
      temp,
      tempMax: typeof main?.temp_max === "number" && Number.isFinite(main.temp_max) ? main.temp_max : temp,
      tempMin: typeof main?.temp_min === "number" && Number.isFinite(main.temp_min) ? main.temp_min : temp,
      feelsLike:
        typeof main?.feels_like === "number" && Number.isFinite(main.feels_like) ? main.feels_like : temp,
      condition,
      source: "openweathermap"
    };
  }
}
