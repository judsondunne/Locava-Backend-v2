/**
 * Path helpers for the Master PBF OSM Copier admin UI and dry-run defaults.
 */

export const DEFAULT_VERMONT_PBF_PATH = "./data/osm/vermont-latest.osm.pbf";

export const VERMONT_PBF_DOWNLOAD_COMMAND =
  "mkdir -p data/osm\n" +
  "curl -L -o data/osm/vermont-latest.osm.pbf https://download.geofabrik.de/north-america/us/vermont-latest.osm.pbf";

/** Infer a US state code from common Geofabrik / local PBF filenames. */
export function inferStateCodeFromFilePath(filePath: string): string {
  const base = String(filePath ?? "")
    .toLowerCase()
    .replace(/\\/g, "/");
  if (base.includes("vermont")) return "VT";
  if (base.includes("new-hampshire") || base.includes("newhampshire") || /\/nh-/.test(base)) return "NH";
  if (base.includes("maine")) return "ME";
  if (base.includes("massachusetts") || base.includes("mass-")) return "MA";
  if (base.includes("connecticut")) return "CT";
  if (base.includes("rhode-island")) return "RI";
  if (base.includes("new-york") && base.includes("osm")) return "NY";
  return "US";
}

export function isVermontPbfPath(filePath: string): boolean {
  return String(filePath ?? "")
    .toLowerCase()
    .includes("vermont");
}
