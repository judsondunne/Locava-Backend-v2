import type { PbfCopierPreviewDoc } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierTypes.js";
import { resolveReverseGeocodeDetails } from "../location/reverse-geocode.js";

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeCountry(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "United States";
  if (/^us$/i.test(raw) || raw.toUpperCase() === "USA") return "United States";
  return raw;
}

function normalizeState(value: string | null | undefined): string | undefined {
  const raw = readString(value);
  if (!raw) return undefined;
  if (/^vt$/i.test(raw)) return "Vermont";
  return raw;
}

/** County seats / hubs that match how hikers caption trail photos better than micro-hamlet reverse geocode. */
const VT_COUNTY_PHOTO_SEARCH_TOWN: Record<string, string> = {
  "bennington county": "Bennington",
  "windham county": "Brattleboro",
  "rutland county": "Rutland",
  "windsor county": "Woodstock",
  "addison county": "Middlebury",
  "chittenden county": "Burlington",
  "washington county": "Montpelier",
};

function preferPhotoSearchTown(city: string | undefined, county: string | undefined): string | undefined {
  const countyKey = county?.trim().toLowerCase();
  if (countyKey && VT_COUNTY_PHOTO_SEARCH_TOWN[countyKey]) {
    return VT_COUNTY_PHOTO_SEARCH_TOWN[countyKey];
  }
  return city;
}

/**
 * Ensure every undiscovered photo lookup has town + region + country context.
 * OSM spots often lack addr:city — resolve from coordinates when possible.
 */
export async function enrichPreviewDocForPhotoSearch(
  doc: PbfCopierPreviewDoc,
): Promise<PbfCopierPreviewDoc> {
  const payload = (doc.writePayload ?? {}) as {
    location?: { city?: string; state?: string; country?: string; county?: string };
  };
  const existingCity =
    readString(payload.location?.city) ??
    readString(doc.sourceTagSample?.["addr:city"]);
  const existingState =
    normalizeState(payload.location?.state) ??
    normalizeState(doc.sourceTagSample?.["addr:state"]) ??
    "Vermont";
  const existingCountry =
    normalizeCountry(payload.location?.country) ??
    normalizeCountry(doc.sourceTagSample?.["addr:country"]);

  let city = existingCity;
  let state = existingState;
  let country = existingCountry;
  let county = readString(payload.location?.county);

  const lat = Number(doc.lat);
  const lng = Number(doc.lng);
  if ((!city || !county) && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90) {
    const geo = await resolveReverseGeocodeDetails({
      lat,
      lng,
      allowNetwork: true,
      timeoutMs: 900,
    });
    if (geo?.matched) {
      city = city ?? readString(geo.city);
      state = normalizeState(geo.region) ?? state;
      country = normalizeCountry(geo.country) ?? country;
      county = county ?? readString(geo.county);
    }
  }

  city = preferPhotoSearchTown(city, county);

  const sourceTagSample = {
    ...(doc.sourceTagSample ?? {}),
    ...(city ? { "addr:city": city } : {}),
    ...(state ? { "addr:state": state } : {}),
    ...(country ? { "addr:country": country } : {}),
    ...(county ? { "addr:county": county } : {}),
  };

  const writePayload = {
    ...payload,
    location: {
      ...(payload.location ?? {}),
      ...(city ? { city } : {}),
      ...(state ? { state } : {}),
      ...(country ? { country } : {}),
      ...(county ? { county } : {}),
    },
  };

  return {
    ...doc,
    sourceTagSample,
    writePayload,
  };
}
