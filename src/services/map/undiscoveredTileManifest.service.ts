import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import type { UndiscoveredTileManifestWire } from "../../contracts/surfaces/undiscovered-tile-manifest.contract.js";
import { loadEnv } from "../../config/env.js";

const MANIFEST_DOC = "undiscoveredTileManifest/current";

const DEFAULT_MANIFEST: UndiscoveredTileManifestWire = {
  version: "undiscovered-tiles-v1",
  minZoom: 13,
  maxZoom: 15,
  updatedAt: Date.now(),
  regions: ["global"],
  tilePathFormat: "unexploredTiles/{z}_{x}_{y}",
  spotIndexFallbackEnabled: false,
  source: "firestore_tile_docs",
};

export async function getUndiscoveredTileManifest(): Promise<UndiscoveredTileManifestWire> {
  const env = loadEnv();
  if (env.UNDISCOVERED_TILE_MANIFEST_VERSION?.trim()) {
    return {
      ...DEFAULT_MANIFEST,
      version: env.UNDISCOVERED_TILE_MANIFEST_VERSION.trim(),
      spotIndexFallbackEnabled: env.UNDISCOVERED_TILE_SPOT_INDEX_FALLBACK === true,
    };
  }
  const db = getFirestoreSourceClient();
  if (!db) return DEFAULT_MANIFEST;
  try {
    const snap = await db.doc(MANIFEST_DOC).get();
    if (!snap.exists) return DEFAULT_MANIFEST;
    const data = snap.data() as Partial<UndiscoveredTileManifestWire>;
    return {
      version: String(data.version ?? DEFAULT_MANIFEST.version),
      minZoom: Number(data.minZoom ?? DEFAULT_MANIFEST.minZoom),
      maxZoom: Number(data.maxZoom ?? DEFAULT_MANIFEST.maxZoom),
      updatedAt: Number(data.updatedAt ?? Date.now()),
      regions: Array.isArray(data.regions) ? data.regions.map(String) : DEFAULT_MANIFEST.regions,
      tilePathFormat: String(data.tilePathFormat ?? DEFAULT_MANIFEST.tilePathFormat),
      spotIndexFallbackEnabled:
        data.spotIndexFallbackEnabled === true || env.UNDISCOVERED_TILE_SPOT_INDEX_FALLBACK === true,
      source: data.source === "storage_cdn" ? "storage_cdn" : "firestore_tile_docs",
    };
  } catch {
    return DEFAULT_MANIFEST;
  }
}

export async function isUndiscoveredSpotIndexFallbackEnabled(): Promise<boolean> {
  const manifest = await getUndiscoveredTileManifest();
  return manifest.spotIndexFallbackEnabled === true;
}
