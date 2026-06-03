import type { OverpassElement } from "../osmFeatureParse.js";

/**
 * PBF → Overpass-shape adapter.
 *
 * The existing Locava classifier consumes Overpass-style elements through
 * `parseOverpassElement` / `parseOverpassRaw`. To avoid changing the
 * classifier or the algorithm, this adapter takes raw PBF entities (as
 * yielded by `osm-pbf-parser-node` or any compatible streaming parser) and
 * shapes them into the same `OverpassElement` structure with:
 *   - `type` ∈ "node" | "way" | "relation"
 *   - `id`, `tags`
 *   - `lat` / `lon` for nodes
 *   - `geometry: [{lat,lon}]` for ways (requires the streaming layer to
 *     resolve way node refs into coordinates; if unresolved, the geometry
 *     is omitted and the classifier will treat the way as having no
 *     coordinates — which the existing pipeline already handles)
 *
 * Relations are forwarded with their members. The existing classifier does
 * not currently reconstruct relation geometry from PBF members, so V1 of
 * the importer counts skipped relations and surfaces them in the UI.
 */

export type PbfRawNode = {
  type: "node";
  id: number | string;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
  info?: Record<string, unknown>;
};

export type PbfRawWay = {
  type: "way";
  id: number | string;
  refs?: Array<number | string>;
  /**
   * Pre-resolved geometry, when the reader is in geometry-resolution mode.
   * Each entry is a `{lat, lon}` (or `{lat, lng}`) pair.
   */
  geometry?: Array<{ lat?: number; lon?: number; lng?: number }>;
  tags?: Record<string, string>;
  info?: Record<string, unknown>;
};

export type PbfRawRelation = {
  type: "relation";
  id: number | string;
  members?: Array<{ type: string; ref: number | string; role?: string }>;
  tags?: Record<string, string>;
  info?: Record<string, unknown>;
};

export type PbfRawEntity = PbfRawNode | PbfRawWay | PbfRawRelation;

export type PbfAdapterMetadata = {
  /** Geofabrik / source provider tag. */
  sourceProvider: "geofabrik_pbf" | "pbf_local" | "pbf_unknown";
  /** Path the PBF was read from (informational only). */
  pbfFilePath: string;
  /** Timestamp captured by the reader, if available. */
  sourceTimestamp?: string;
  /** Importer version that emitted the doc. */
  importerVersion: string;
  /** Parser library identifier (e.g. "osm-pbf-parser-node@1.1.4"). */
  parserVersion?: string;
};

export type PbfAdapterResult = {
  element: OverpassElement;
  /** Source metadata to attach to downstream docs. */
  sourceMetadata: {
    osmType: "node" | "way" | "relation";
    osmId: number;
    osmTags: Record<string, string>;
  } & PbfAdapterMetadata;
};

function normalizeTags(input: Record<string, string> | undefined | null): Record<string, string> {
  if (!input) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value == null) continue;
    out[key] = String(value);
  }
  return out;
}

function pickLat(point: { lat?: number; lon?: number; lng?: number }): number | undefined {
  return typeof point.lat === "number" && Number.isFinite(point.lat) ? point.lat : undefined;
}

function pickLng(point: { lat?: number; lon?: number; lng?: number }): number | undefined {
  if (typeof point.lon === "number" && Number.isFinite(point.lon)) return point.lon;
  if (typeof point.lng === "number" && Number.isFinite(point.lng)) return point.lng;
  return undefined;
}

export function adaptPbfEntityToOverpassElement(
  entity: PbfRawEntity,
  metadata: PbfAdapterMetadata
): PbfAdapterResult | null {
  if (!entity || !entity.type || entity.id == null) return null;
  const osmId = Number(entity.id);
  if (!Number.isFinite(osmId)) return null;
  const tags = normalizeTags(entity.tags);

  if (entity.type === "node") {
    const lat = pickLat({ lat: entity.lat });
    const lon = pickLng({ lon: entity.lon });
    if (lat == null || lon == null) return null;
    const element: OverpassElement = {
      type: "node",
      id: osmId,
      lat,
      lon,
      tags,
    };
    return {
      element,
      sourceMetadata: {
        ...metadata,
        osmType: "node",
        osmId,
        osmTags: tags,
      },
    };
  }

  if (entity.type === "way") {
    const geometry: Array<{ lat: number; lon: number }> = [];
    for (const point of entity.geometry ?? []) {
      const lat = pickLat(point);
      const lon = pickLng(point);
      if (lat != null && lon != null) geometry.push({ lat, lon });
    }
    const element: OverpassElement = {
      type: "way",
      id: osmId,
      tags,
      geometry: geometry.length > 0 ? geometry : undefined,
    };
    return {
      element,
      sourceMetadata: {
        ...metadata,
        osmType: "way",
        osmId,
        osmTags: tags,
      },
    };
  }

  if (entity.type === "relation") {
    const element: OverpassElement = {
      type: "relation",
      id: osmId,
      tags,
      members: (entity.members ?? []).map((m) => ({
        type: String(m.type ?? ""),
        ref: m.ref,
        role: m.role,
      })),
    };
    return {
      element,
      sourceMetadata: {
        ...metadata,
        osmType: "relation",
        osmId,
        osmTags: tags,
      },
    };
  }

  return null;
}

export function isPbfEntitySupportedForCopier(entity: PbfRawEntity): boolean {
  if (!entity || !entity.type) return false;
  if (entity.type === "node") return true;
  if (entity.type === "way") return true;
  // Relations are forwarded but V1 does not reconstruct geometry from PBF
  // members; the runner counts and reports them as a limitation.
  if (entity.type === "relation") return true;
  return false;
}
