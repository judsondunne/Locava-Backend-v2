/**
 * Whether an unexploredSpots / unexploredRoutes Firestore doc should appear on the native map layer.
 * PBF Copier V2 blank writes set `publicMapEligible: false` + `mapReadiness: review` by design;
 * they remain displayable when tagged as intentional undiscovered OSM inventory.
 */

export function readMapReadiness(data: Record<string, unknown>): string | null {
  if (typeof data.mapReadiness === "string" && data.mapReadiness.trim()) {
    return data.mapReadiness.trim();
  }
  const status = data.status as { mapReadiness?: unknown } | undefined;
  if (typeof status?.mapReadiness === "string" && status.mapReadiness.trim()) {
    return status.mapReadiness.trim();
  }
  return null;
}

/** True when doc is allowed on `/v2/map/layers/undiscovered` and native undiscovered rendering. */
export function isUndiscoveredFirestoreMapEligible(data: Record<string, unknown>): boolean {
  const readiness = readMapReadiness(data);
  if (readiness === "hidden") return false;

  if (data.publicMapEligible === true) return true;

  if (data.undiscovered !== true) return false;

  const audit = data.audit as { createdBy?: unknown } | undefined;
  if (audit?.createdBy === "pbf_copier_v2") return true;

  const importMeta = data.import as { chunkId?: unknown } | undefined;
  if (typeof importMeta?.chunkId === "string" && importMeta.chunkId.includes("pbf_v2_write")) {
    return true;
  }

  const classification = data.classification as { reason?: unknown } | undefined;
  if (classification?.reason === "pbf_copier_v2_blank_write") return true;

  return false;
}
