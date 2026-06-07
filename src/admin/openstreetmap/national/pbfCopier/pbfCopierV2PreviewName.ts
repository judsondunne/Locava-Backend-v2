import { normalizePreviewDisplayName } from "./pbfCopierPreviewQuality.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";

export function hasOsmNameTag(tags: Record<string, string>): boolean {
  const name = tags.name?.trim() || tags["name:en"]?.trim();
  return Boolean(name && name.length >= 1);
}

export function hasMeaningfulPreviewName(doc: PbfCopierPreviewDoc): boolean {
  const raw = (doc.displayName || "").trim().toLowerCase();
  if (!raw) return false;
  if (raw.startsWith("highway=") || raw.startsWith("osm way/") || raw.startsWith("osm node/")) {
    return false;
  }

  const key = normalizePreviewDisplayName(doc.displayName);
  if (!key) return false;
  if (/^(highway|amenity|natural|landuse|man made|shop|tourism|building|waterway|railway) /.test(key)) {
    return false;
  }
  return true;
}
