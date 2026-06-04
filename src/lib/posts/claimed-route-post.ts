import { z } from "zod";
import {
  buildRouteSummaryForMapMarker,
  routeMapPreviewFromDoc,
  routeMapPreviewToNativeCoords,
  type RouteMapLonLat,
} from "../map/unexploredRouteMapGeometry.js";
import {
  getUnexploredRouteById,
  getUnexploredRouteGeometryChunks,
} from "../../repositories/source-of-truth/unexplored-read-firestore.adapter.js";

export const ClaimedRoutePostClientPayloadSchema = z
  .object({
    undiscoveredRouteId: z.string().trim().min(1).max(200),
    routeSource: z.literal("undiscovered_claim"),
    routeName: z.string().trim().max(300).optional(),
    routeActivity: z.string().trim().max(128).optional(),
    category: z.string().trim().max(128).optional(),
    routeSummary: z.record(z.unknown()).optional(),
  })
  .strict();

export type ClaimedRoutePostClientPayload = z.infer<typeof ClaimedRoutePostClientPayloadSchema>;

export const PostingFinalizeAssetLocationSchema = z.object({
  lat: z.number().finite().nullable().optional(),
  long: z.number().finite().nullable().optional(),
});

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function previewCoordCount(routeSummary: Record<string, unknown> | null | undefined): number {
  if (!routeSummary) return 0;
  const preview = routeSummary.routePreviewCoordinates;
  if (!Array.isArray(preview)) return 0;
  let count = 0;
  for (const row of preview) {
    const rec = asRecord(row);
    const lat = Number(rec?.lat ?? rec?.latitude);
    const lon = Number(rec?.lon ?? rec?.lng ?? rec?.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon)) count += 1;
  }
  return count;
}

function hasRouteGeometryHint(routeSummary: Record<string, unknown> | null | undefined): boolean {
  if (!routeSummary) return false;
  if (previewCoordCount(routeSummary) >= 2) return true;
  const encoded =
    (typeof routeSummary.encodedPolyline === "string" && routeSummary.encodedPolyline.trim()) ||
    (typeof routeSummary.encodedPolylinePreview === "string" &&
      routeSummary.encodedPolylinePreview.trim());
  return Boolean(encoded);
}

export function normalizePostingFinalizeAssetLocations(
  raw: unknown,
  assetCount: number,
): Array<{ lat: number | null; long: number | null }> | undefined {
  if (!Array.isArray(raw) || assetCount <= 0) return undefined;
  const parsed = raw
    .slice(0, assetCount)
    .map((row) => PostingFinalizeAssetLocationSchema.safeParse(row))
    .map((result, index) => {
      if (!result.success) return { lat: null, long: null, index };
      const lat =
        typeof result.data.lat === "number" && Number.isFinite(result.data.lat)
          ? result.data.lat
          : null;
      const long =
        typeof result.data.long === "number" && Number.isFinite(result.data.long)
          ? result.data.long
          : null;
      return { lat, long, index };
    });
  while (parsed.length < assetCount) {
    parsed.push({ lat: null, long: null, index: parsed.length });
  }
  return parsed.map(({ lat, long }) => ({ lat, long }));
}

async function resolveRoutePreviewFromDoc(data: Record<string, unknown>): Promise<RouteMapLonLat[]> {
  let preview = routeMapPreviewFromDoc(data);
  if (preview.length >= 2) return preview;
  const storage = data.geometryStorage as { mode?: string } | undefined;
  const routeId = typeof data.id === "string" ? data.id : "";
  if (routeId && storage?.mode === "chunked_subcollection") {
    const chunks = await getUnexploredRouteGeometryChunks(routeId);
    if (chunks.length >= 2) {
      preview = chunks.map((c) => ({ lat: c.latitude, lng: c.longitude }));
    }
  }
  return preview;
}

/**
 * Build Firestore fields for a normal post that carries route geometry from an undiscovered route claim.
 * Never synthesizes route geometry from asset GPS — caller must supply unexplored doc or client routeSummary.
 */
export function buildClaimedRouteFieldsFromUnexploredDocSync(input: {
  undiscoveredRouteId: string;
  unexploredData: Record<string, unknown>;
  routeName?: string;
  routeActivity?: string;
  category?: string;
  clientRouteSummary?: Record<string, unknown> | null;
}): Record<string, unknown> | null {
  const data: Record<string, unknown> = { ...input.unexploredData, id: input.undiscoveredRouteId };
  let preview = routeMapPreviewFromDoc(data);
  const clientSummary = asRecord(input.clientRouteSummary);
  if (preview.length < 2 && clientSummary && hasRouteGeometryHint(clientSummary)) {
    preview = routeMapPreviewFromDoc({
      ...data,
      routeSummary: clientSummary,
      encodedPolyline:
        clientSummary.encodedPolyline ?? clientSummary.encodedPolylinePreview ?? data.encodedPolyline,
      routePreviewCoordinates: clientSummary.routePreviewCoordinates,
    });
  }
  if (preview.length < 2) return null;

  const routeSummary = buildRouteSummaryForMapMarker({ data, preview });
  const mergedSummary: Record<string, unknown> = {
    ...routeSummary,
    ...(clientSummary ?? {}),
    routePreviewCoordinates: routeMapPreviewToNativeCoords(preview),
    geometrySource:
      typeof clientSummary?.geometrySource === "string"
        ? clientSummary.geometrySource
        : routeSummary.geometryStorageMode ?? "inline",
  };

  return buildClaimedRouteFirestoreFields({
    undiscoveredRouteId: input.undiscoveredRouteId,
    routeSummary: mergedSummary,
    routeName: input.routeName,
    routeActivity: input.routeActivity,
    category: input.category,
    preview,
  });
}

export async function buildClaimedRouteFieldsFromUnexploredDoc(input: {
  undiscoveredRouteId: string;
  unexploredData: Record<string, unknown>;
  routeName?: string;
  routeActivity?: string;
  category?: string;
  clientRouteSummary?: Record<string, unknown> | null;
}): Promise<Record<string, unknown> | null> {
  const data: Record<string, unknown> = { ...input.unexploredData, id: input.undiscoveredRouteId };
  let preview = await resolveRoutePreviewFromDoc(data);
  const clientSummary = asRecord(input.clientRouteSummary);
  if (preview.length < 2 && clientSummary && hasRouteGeometryHint(clientSummary)) {
    preview = routeMapPreviewFromDoc({
      ...data,
      routeSummary: clientSummary,
      encodedPolyline:
        clientSummary.encodedPolyline ?? clientSummary.encodedPolylinePreview ?? data.encodedPolyline,
      routePreviewCoordinates: clientSummary.routePreviewCoordinates,
    });
  }
  if (preview.length < 2) return null;

  const routeSummary = buildRouteSummaryForMapMarker({ data, preview });
  const mergedSummary: Record<string, unknown> = {
    ...routeSummary,
    ...(clientSummary ?? {}),
    routePreviewCoordinates: routeMapPreviewToNativeCoords(preview),
    geometrySource:
      typeof clientSummary?.geometrySource === "string"
        ? clientSummary.geometrySource
        : routeSummary.geometryStorageMode ?? "inline",
  };

  return buildClaimedRouteFirestoreFields({
    undiscoveredRouteId: input.undiscoveredRouteId,
    routeSummary: mergedSummary,
    routeName: input.routeName,
    routeActivity: input.routeActivity,
    category: input.category,
    preview,
  });
}

export function buildClaimedRouteFieldsFromClientPayload(
  payload: ClaimedRoutePostClientPayload,
): Record<string, unknown> | null {
  const routeSummary = asRecord(payload.routeSummary);
  if (!hasRouteGeometryHint(routeSummary)) return null;

  let preview = routeMapPreviewFromDoc({
    routeSummary,
    encodedPolyline:
      typeof routeSummary?.encodedPolyline === "string"
        ? routeSummary.encodedPolyline
        : typeof routeSummary?.encodedPolylinePreview === "string"
          ? routeSummary.encodedPolylinePreview
          : undefined,
    routePreviewCoordinates: routeSummary?.routePreviewCoordinates,
  });
  if (preview.length < 2 && Array.isArray(routeSummary?.routePreviewCoordinates)) {
    const fromWire: RouteMapLonLat[] = [];
    for (const row of routeSummary.routePreviewCoordinates) {
      const rec = asRecord(row);
      const lat = Number(rec?.lat ?? rec?.latitude);
      const lng = Number(rec?.lon ?? rec?.lng ?? rec?.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lng)) fromWire.push({ lat, lng });
    }
    if (fromWire.length >= 2) preview = fromWire;
  }
  if (preview.length < 2) return null;

  const mergedSummary: Record<string, unknown> = {
    ...(routeSummary ?? {}),
    routePreviewCoordinates: routeMapPreviewToNativeCoords(preview),
  };

  return buildClaimedRouteFirestoreFields({
    undiscoveredRouteId: payload.undiscoveredRouteId,
    routeSummary: mergedSummary,
    routeName: payload.routeName,
    routeActivity: payload.routeActivity,
    category: payload.category,
    preview,
  });
}

export const PERSISTED_ROUTE_POST_FIELD_KEYS = [
  "isRoute",
  "postType",
  "routeSource",
  "undiscoveredRouteId",
  "sourceUnexploredRouteId",
  "routeId",
  "routeName",
  "routeActivity",
  "routeKind",
  "routeType",
  "category",
  "routeSummary",
  "routePreviewCoordinates",
  "routeCoordinates",
  "encodedPolyline",
  "bbox",
  "distanceMeters",
  "distanceMiles",
  "route",
  "capture",
  "privacy",
  "classification",
] as const;

function routeGeometryPointCount(postData: Record<string, unknown>): number {
  const summary = asRecord(postData.routeSummary);
  if (previewCoordCount(summary) >= 2) return previewCoordCount(summary);
  if (Array.isArray(postData.routePreviewCoordinates) && postData.routePreviewCoordinates.length >= 2) {
    return postData.routePreviewCoordinates.length;
  }
  const routeBlock = asRecord(postData.route);
  const coords = routeBlock?.coordinates;
  if (Array.isArray(coords) && coords.length >= 2) return coords.length;
  const line = lineFromCoordinateFields(postData);
  return line.length;
}

function lineFromCoordinateFields(data: Record<string, unknown>): RouteMapLonLat[] {
  const candidates = [data.routeCoordinates, data.routeLineCoordinates];
  for (const raw of candidates) {
    if (!Array.isArray(raw) || raw.length < 2) continue;
    const out: RouteMapLonLat[] = [];
    for (const pt of raw) {
      const row = asRecord(pt);
      const lat = Number(row?.lat ?? row?.latitude);
      const lng = Number(row?.lng ?? row?.longitude ?? row?.lon);
      if (Number.isFinite(lat) && Number.isFinite(lng)) out.push({ lat, lng });
    }
    if (out.length >= 2) return out;
  }
  return [];
}

export function resolveSourceUnexploredRouteId(postData: Record<string, unknown>): string | null {
  const id = asString(postData.sourceUnexploredRouteId) ??
    asString(postData.undiscoveredRouteId) ??
    asString(postData.routeId) ??
    asString(asRecord(postData.capture)?.itemId);
  return id?.trim() || null;
}

export function detectColdOpenRoutePost(postData: Record<string, unknown>): {
  isRoutePost: boolean;
  routeGeometryPresent: boolean;
  sourceUnexploredRouteId: string | null;
} {
  const sourceUnexploredRouteId = resolveSourceUnexploredRouteId(postData);
  const capture = asRecord(postData.capture);
  const captureIsRoute =
    capture?.itemType === "unexploredRoute" || capture?.sourceCollection === "unexploredRoutes";
  const isRoutePost =
    postData.isRoute === true ||
    postData.postType === "route" ||
    postData.routeSource === "undiscovered_claim" ||
    captureIsRoute;
  const routeGeometryPresent = routeGeometryPointCount(postData) >= 2;
  return { isRoutePost, routeGeometryPresent, sourceUnexploredRouteId };
}

export function extractPersistedRouteFieldsForApi(
  postData: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of PERSISTED_ROUTE_POST_FIELD_KEYS) {
    if (postData[key] !== undefined) out[key] = postData[key];
  }
  const sourceUnexploredRouteId = resolveSourceUnexploredRouteId(postData);
  if (sourceUnexploredRouteId) {
    out.sourceUnexploredRouteId = sourceUnexploredRouteId;
    if (out.undiscoveredRouteId == null) out.undiscoveredRouteId = sourceUnexploredRouteId;
    if (out.routeId == null) out.routeId = sourceUnexploredRouteId;
  }
  if (detectColdOpenRoutePost(postData).isRoutePost) {
    out.isRoute = true;
    if (typeof out.postType !== "string") out.postType = "route";
  }
  return out;
}

export function mergePersistedRouteFieldsIntoRecord<T extends Record<string, unknown>>(
  record: T,
  postData: Record<string, unknown>,
): T & Record<string, unknown> {
  const routeFields = extractPersistedRouteFieldsForApi(postData);
  if (Object.keys(routeFields).length === 0) return record;
  return {
    ...record,
    ...routeFields,
    routeSummary: {
      ...(asRecord(record.routeSummary) ?? {}),
      ...(asRecord(routeFields.routeSummary) ?? {}),
    },
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function buildClaimedRouteFirestoreFields(input: {
  undiscoveredRouteId: string;
  routeSummary: Record<string, unknown>;
  routeName?: string;
  routeActivity?: string;
  category?: string;
  preview: RouteMapLonLat[];
}): Record<string, unknown> {
  const routePreviewCoordinates = routeMapPreviewToNativeCoords(input.preview);
  const bbox = input.routeSummary.bbox;
  const distanceMeters =
    typeof input.routeSummary.distanceMeters === "number"
      ? input.routeSummary.distanceMeters
      : typeof input.routeSummary.distanceMiles === "number"
        ? input.routeSummary.distanceMiles * 1609.344
        : undefined;
  const routeActivity = input.routeActivity?.trim() || undefined;
  const routePrivacyLabel = "Public Route";

  return {
    isRoute: true,
    postType: "route",
    routeSource: "undiscovered_claim",
    undiscoveredRouteId: input.undiscoveredRouteId,
    sourceUnexploredRouteId: input.undiscoveredRouteId,
    routeId: input.undiscoveredRouteId,
    privacy: routePrivacyLabel,
    ...(input.routeName ? { routeName: input.routeName, title: input.routeName } : {}),
    ...(routeActivity ? { routeActivity, routeKind: routeActivity, routeType: routeActivity } : {}),
    ...(input.category ? { category: input.category } : {}),
    classification: {
      privacyLabel: routePrivacyLabel,
      settingType: "outdoor",
    },
    routeSummary: input.routeSummary,
    routePreviewCoordinates,
    routeCoordinates: input.preview.map((p) => ({ lat: p.lat, lng: p.lng })),
    ...(typeof input.routeSummary.encodedPolyline === "string"
      ? { encodedPolyline: input.routeSummary.encodedPolyline }
      : {}),
    ...(bbox && typeof bbox === "object" ? { bbox } : {}),
    ...(typeof distanceMeters === "number" ? { distanceMeters } : {}),
    route: {
      hasRoute: true,
      geometrySource: "inline",
      coordinates: input.preview.map((p) => ({
        latitude: p.lat,
        longitude: p.lng,
      })),
      ...(typeof distanceMeters === "number" ? { distanceMeters } : {}),
      routeType:
        typeof input.routeActivity === "string"
          ? input.routeActivity
          : typeof input.routeSummary.routeType === "string"
            ? input.routeSummary.routeType
            : undefined,
    },
  };
}

/**
 * Resolve route Firestore fields for finalize: client payload first, then unexplored route doc (incl. chunked geometry).
 */
export async function resolveClaimedRouteFieldsForFinalize(
  payload: ClaimedRoutePostClientPayload,
): Promise<Record<string, unknown> | null> {
  const fromClient = buildClaimedRouteFieldsFromClientPayload(payload);
  if (fromClient) return fromClient;

  const unexploredData = await getUnexploredRouteById(payload.undiscoveredRouteId);
  if (!unexploredData) return null;

  return buildClaimedRouteFieldsFromUnexploredDoc({
    undiscoveredRouteId: payload.undiscoveredRouteId,
    unexploredData,
    routeName: payload.routeName,
    routeActivity: payload.routeActivity,
    category: payload.category,
    clientRouteSummary: asRecord(payload.routeSummary),
  });
}

export function mergeClaimedRouteFieldsIntoPostDoc(
  postDoc: Record<string, unknown>,
  routeFields: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...postDoc,
    ...routeFields,
    routeSummary: {
      ...(asRecord(postDoc.routeSummary) ?? {}),
      ...(asRecord(routeFields.routeSummary) ?? {}),
    },
  };
}
