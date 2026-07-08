import type { PbfCopierPreviewDoc } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierTypes.js";
import {
  normalizeDiscoveryCategory,
  type DiscoveryCandidate,
} from "../../contracts/surfaces/undiscovered-candidate.contract.js";

/**
 * Adapt an OSM PBF v2 preview doc into a unified discovery candidate.
 *
 * This is the seam that plugs the existing PBF pipeline into the Dashboard v1
 * review workflow without changing the PBF engine. A preview doc whose
 * `mapReadiness` is "hidden" is treated as failing the quality gate; its
 * hidden reason(s) surface as gate reasons for the reviewer.
 */
export function pbfPreviewToDiscoveryCandidate(
  doc: PbfCopierPreviewDoc,
  opts: { region: string; nowIso?: string; qualityReasons?: string[] },
): DiscoveryCandidate {
  const now = opts.nowIso ?? new Date().toISOString();
  const kind = doc.kind === "unexplored_route" ? "route" : "spot";
  const passed = doc.mapReadiness !== "hidden";
  const reasons =
    opts.qualityReasons && opts.qualityReasons.length > 0
      ? opts.qualityReasons
      : passed
        ? []
        : ["hidden_by_quality_filter"];

  return {
    id: `osm_pbf:${doc.osmType}:${doc.osmId}`,
    region: opts.region,
    sourceChannel: "osm_pbf",
    kind,
    targetCollection: kind === "route" ? "unexploredRoutes" : "unexploredSpots",
    displayName: doc.displayName,
    primaryCategory: normalizeDiscoveryCategory(doc.primaryCategory || doc.primaryActivity),
    categories: Array.from(
      new Set(
        [doc.primaryCategory, ...(doc.activities ?? [])]
          .filter(Boolean)
          .map((c) => normalizeDiscoveryCategory(c)),
      ),
    ),
    primaryActivity: doc.primaryActivity ?? null,
    activities: doc.activities ?? [],
    lat: doc.center?.lat ?? doc.lat,
    lng: doc.center?.lng ?? doc.lng,
    reviewStatus: "candidate",
    qualityGate: { passed, reasons },
    provenance: {
      sourceProvider: doc.sourceProvider,
      sourceIds: doc.sourceIds ?? [],
      sourceKeys: doc.sourceKeys ?? [],
      // Deep-link to the source OSM object so a reviewer can inspect it on the map.
      sourceUrl: `https://www.openstreetmap.org/${doc.osmType}/${doc.osmId}`,
      importRunId: doc.importRunId,
    },
    createdAt: now,
    updatedAt: now,
  };
}
