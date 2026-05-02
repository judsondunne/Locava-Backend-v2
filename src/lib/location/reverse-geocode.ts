import { searchPlacesIndexService } from "../../services/surfaces/search-places-index.service.js";

type ReverseGeocodeDetails = {
  addressDisplayName: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  county: string | null;
  matched: boolean;
  source: "index" | "network";
};

type ResolveReverseGeocodeInput = {
  lat: number;
  lng: number;
  allowNetwork?: boolean;
  timeoutMs?: number;
};

type CacheEntry = { value: ReverseGeocodeDetails | null; expiresAtMs: number };

const CACHE_TTL_MS = 10 * 60_000;
const reverseGeocodeCache = new Map<string, CacheEntry>();

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toCacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

function readCache(key: string): ReverseGeocodeDetails | null | undefined {
  const now = Date.now();
  const cached = reverseGeocodeCache.get(key);
  if (!cached) return undefined;
  if (cached.expiresAtMs <= now) {
    reverseGeocodeCache.delete(key);
    return undefined;
  }
  return cached.value;
}

function writeCache(key: string, value: ReverseGeocodeDetails | null): void {
  reverseGeocodeCache.set(key, {
    value,
    expiresAtMs: Date.now() + CACHE_TTL_MS,
  });
}

function fromSearchIndex(lat: number, lng: number): ReverseGeocodeDetails | null {
  const match = searchPlacesIndexService.reverseLookup(lat, lng);
  if (!match) return null;
  return {
    addressDisplayName: `${match.text}, ${match.stateName}`,
    city: match.text,
    region: match.stateName,
    country: match.countryCode,
    county: null,
    matched: true,
    source: "index",
  };
}

async function fromNominatim(lat: number, lng: number, timeoutMs: number): Promise<ReverseGeocodeDetails | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(100, timeoutMs));
  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    const response = await fetch(url, {
      headers: {
        "User-Agent": "LocavaBackendV2/1.0",
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      display_name?: unknown;
      address?: Record<string, unknown>;
    };
    const address = payload.address ?? {};
    const city =
      cleanString(address.town) ??
      cleanString(address.city) ??
      cleanString(address.village) ??
      cleanString(address.hamlet);
    const region = cleanString(address.state) ?? cleanString(address.region);
    const country =
      cleanString(address.country_code)?.toUpperCase() ??
      cleanString(address.country);
    const county = cleanString(address.county);
    const road = cleanString(address.road);
    const houseNumber = cleanString(address.house_number);
    const addressDisplayName =
      [houseNumber, road, city, county, region].filter(Boolean).join(", ") ||
      cleanString(payload.display_name) ||
      [city, county, region, country].filter(Boolean).join(", ") ||
      null;
    if (!addressDisplayName && !city && !region && !country && !county) return null;
    return {
      addressDisplayName,
      city,
      region,
      country,
      county,
      matched: true,
      source: "network",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveReverseGeocodeDetails(
  input: ResolveReverseGeocodeInput
): Promise<ReverseGeocodeDetails | null> {
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) return null;
  const startedAt = Date.now();
  const cacheKey = toCacheKey(input.lat, input.lng);
  console.info("[reverse_geocode] start", {
    lat: input.lat,
    lng: input.lng,
    cacheKey,
    allowNetwork: input.allowNetwork === true,
    timeoutMs: input.timeoutMs ?? 350,
  });
  const cached = readCache(cacheKey);
  const shouldUseNetwork =
    input.allowNetwork === true &&
    process.env.NODE_ENV !== "test" &&
    process.env.VITEST !== "true";
  if (cached !== undefined) {
    // Do not let a negative cache entry from fast/no-network mode block a later network-capable lookup.
    if (cached == null && shouldUseNetwork) {
      console.info("[reverse_geocode] cache_bypass_for_network_retry", {
        cacheKey,
      });
    } else {
    console.info("[reverse_geocode] cache_hit", {
      cacheKey,
      matched: Boolean(cached),
      source: cached?.source ?? null,
      elapsedMs: Date.now() - startedAt,
    });
    return cached;
    }
  }

  const indexResult = fromSearchIndex(input.lat, input.lng);
  console.info("[reverse_geocode] index_lookup", {
    cacheKey,
    matched: Boolean(indexResult),
    city: indexResult?.city ?? null,
    region: indexResult?.region ?? null,
    country: indexResult?.country ?? null,
  });

  if (!shouldUseNetwork && indexResult) {
    writeCache(cacheKey, indexResult);
    console.info("[reverse_geocode] resolved_index_only", {
      cacheKey,
      elapsedMs: Date.now() - startedAt,
    });
    return indexResult;
  }
  if (!shouldUseNetwork) {
    // In fast mode, only cache positive index hits so we don't poison later network-enabled lookups.
    if (indexResult) {
      writeCache(cacheKey, indexResult);
    }
    console.info("[reverse_geocode] resolved_without_network", {
      cacheKey,
      matched: Boolean(indexResult),
      elapsedMs: Date.now() - startedAt,
    });
    return indexResult ?? null;
  }

  console.info("[reverse_geocode] network_lookup_start", {
    cacheKey,
    timeoutMs: input.timeoutMs ?? 350,
    hadIndexResult: Boolean(indexResult),
  });
  const networkResult = await fromNominatim(input.lat, input.lng, input.timeoutMs ?? 350);
  console.info("[reverse_geocode] network_lookup_done", {
    cacheKey,
    matched: Boolean(networkResult),
    city: networkResult?.city ?? null,
    region: networkResult?.region ?? null,
    county: networkResult?.county ?? null,
    country: networkResult?.country ?? null,
    elapsedMs: Date.now() - startedAt,
  });
  const mergedResult =
    networkResult ??
    indexResult;
  writeCache(cacheKey, mergedResult ?? null);
  console.info("[reverse_geocode] resolved_final", {
    cacheKey,
    matched: Boolean(mergedResult),
    source: mergedResult?.source ?? null,
    elapsedMs: Date.now() - startedAt,
  });
  return mergedResult ?? null;
}
