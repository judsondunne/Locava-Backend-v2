import type { PbfCopierPreviewDoc } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierTypes.js";
import type { UndiscoveredPhotoSearchBody } from "../../contracts/surfaces/undiscovered-photo-search.contract.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeSourceTags(raw: unknown): Record<string, string> {
  const record = asRecord(raw);
  if (!record) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    const text = readString(value);
    if (text) out[key] = text;
  }
  return out;
}

function mergeTagSample(
  docTags: Record<string, string>,
  fallback?: Record<string, string>,
): Record<string, string> {
  const out = { ...docTags };
  if (!fallback) return out;
  for (const [key, value] of Object.entries(fallback)) {
    if (!out[key] && value.trim()) out[key] = value.trim();
  }
  return out;
}

function parseOsmIdentity(doc: Record<string, unknown>): { osmType: "node" | "way" | "relation"; osmId: number } {
  const source = asRecord(doc.source);
  const osmTypeRaw = readString(source?.osmType ?? source?.type) ?? "node";
  const osmType =
    osmTypeRaw === "way" || osmTypeRaw === "relation" || osmTypeRaw === "node" ? osmTypeRaw : "node";
  const parsedFromId = Number.parseInt(
    String(doc.id ?? "0").split("/").pop()?.replace(/\D/g, "") || "0",
    10,
  );
  const osmId =
    readNumber(source?.osmId) ??
    readNumber(source?.id) ??
    readNumber(doc.osmId) ??
    (Number.isFinite(parsedFromId) ? Math.abs(parsedFromId) : 0);
  return { osmType, osmId: Math.trunc(osmId) };
}

function readLocation(doc: Record<string, unknown>, fallback?: UndiscoveredPhotoSearchBody) {
  const location = asRecord(doc.location);
  const town =
    readString(location?.city) ??
    readString(location?.town) ??
    readString(doc.city) ??
    (fallback?.town?.trim() || undefined);
  const state =
    readString(location?.state) ??
    readString(doc.stateCode) ??
    readString(doc.state) ??
    (fallback?.state?.trim() || undefined);
  return { town, state };
}

function readCoordinates(
  doc: Record<string, unknown>,
  fallback?: UndiscoveredPhotoSearchBody,
): { lat: number; lng: number } {
  const center = asRecord(doc.center);
  const location = asRecord(doc.location);
  const lat =
    readNumber(doc.lat) ??
    readNumber(center?.lat) ??
    readNumber(location?.lat) ??
    fallback?.lat;
  const lng =
    readNumber(doc.lng) ??
    readNumber(doc.long) ??
    readNumber(center?.lng) ??
    readNumber(location?.lng) ??
    readNumber(location?.long) ??
    fallback?.long;
  return {
    lat: lat ?? 0,
    lng: lng ?? 0,
  };
}

export function unexploredDocToPbfPreviewDoc(input: {
  collection: "unexploredSpots" | "unexploredRoutes";
  doc: Record<string, unknown>;
  fallback?: Pick<
    UndiscoveredPhotoSearchBody,
    "name" | "town" | "state" | "lat" | "long" | "osmTags" | "type"
  >;
}): PbfCopierPreviewDoc {
  const { doc, collection, fallback } = input;
  const isRoute = collection === "unexploredRoutes";
  const { lat, lng } = readCoordinates(doc, fallback);
  const { town, state } = readLocation(doc, fallback);
  const sourceTags = mergeTagSample(
    normalizeSourceTags(doc.sourceTags),
    fallback?.osmTags,
  );
  if (town && !sourceTags["addr:city"]) sourceTags["addr:city"] = town;
  if (state && !sourceTags["addr:state"]) sourceTags["addr:state"] = state;

  const displayName =
    readString(doc.displayName) ??
    readString(doc.title) ??
    readString(doc.name) ??
    fallback?.name?.trim() ??
    "Unnamed place";

  const primaryCategory =
    readString(doc.primaryCategory) ??
    readString(doc.category) ??
    readString(fallback?.type) ??
    (isRoute ? "hiking" : "osm");

  const primaryActivity =
    readString(doc.primaryActivity) ?? readString(primaryCategory) ?? (isRoute ? "hiking" : "osm");

  const activitiesRaw = Array.isArray(doc.activities) ? doc.activities : [];
  const activities = [
    ...new Set(
      activitiesRaw
        .map((value) => readString(value))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  if (primaryActivity && !activities.includes(primaryActivity)) {
    activities.unshift(primaryActivity);
  }

  const { osmType, osmId } = parseOsmIdentity(doc);
  const sourceKeys = Array.isArray(doc.sourceKeys)
    ? doc.sourceKeys.map((value) => readString(value)).filter((value): value is string => Boolean(value))
    : [];
  const sourceIds = Array.isArray(doc.sourceIds)
    ? doc.sourceIds.map((value) => readString(value)).filter((value): value is string => Boolean(value))
    : [];

  const writePayload: Record<string, unknown> = {
    ...doc,
    source: {
      ...(asRecord(doc.source) ?? {}),
      tags: sourceTags,
    },
    location: {
      ...(asRecord(doc.location) ?? {}),
      city: town,
      state,
    },
  };

  return {
    id: readString(doc.id) ?? "unknown",
    kind: isRoute ? "unexplored_route" : "unexplored_spot",
    collection,
    displayName,
    primaryActivity,
    activities,
    primaryCategory,
    lat,
    lng,
    center: isRoute ? { lat, lng } : undefined,
    sourceFamily: readString(doc.sourceFamily) ?? "osm",
    sourceKeys,
    sourceIds,
    osmType,
    osmId,
    origin: "generated_osm",
    mapReadiness: (readString(doc.mapReadiness) as PbfCopierPreviewDoc["mapReadiness"]) ?? "ready",
    publicMapEligible: doc.publicMapEligible !== false,
    undiscovered: true,
    needsCapture: true,
    hasUserMedia: false,
    importRunId: readString(doc.importRunId) ?? "undiscovered-photo-search",
    importPipelineVersion: readString(doc.importPipelineVersion) ?? "v1",
    pbfFilePath: readString(doc.pbfFilePath) ?? "",
    sourceProvider: readString(doc.sourceProvider) ?? "osm",
    sourceTagSample: sourceTags,
    writePayload,
    warnings: [],
  };
}

export function readUndiscoveredDisplayMeta(doc: Record<string, unknown>, fallback?: UndiscoveredPhotoSearchBody) {
  const { town, state } = readLocation(doc, fallback);
  const title =
    readString(doc.displayName) ??
    readString(doc.title) ??
    readString(doc.name) ??
    fallback?.name?.trim() ??
    "Unnamed place";
  return { title, town: town ?? null, state: state ?? null };
}
