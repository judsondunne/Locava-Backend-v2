#!/usr/bin/env npx tsx
/**
 * Dry-run map layer rebuild preview. No Firestore writes unless ALLOW_MAP_LAYER_WRITE=true.
 */
import "dotenv/config";
import { INVENTORY_MVP_DEFAULT_VIEWPORT } from "../src/lib/inventory/inventoryBbox.js";
import {
  queryUnexploredRoutesInBbox,
  queryUnexploredSpotsInBbox,
} from "../src/repositories/source-of-truth/unexplored-read-firestore.adapter.js";
import { normalizeUnexploredLayerDocs } from "../src/services/map/undiscoveredMapLayer.normalizer.js";

const allowWrite = process.env.ALLOW_MAP_LAYER_WRITE === "true";
const bbox = INVENTORY_MVP_DEFAULT_VIEWPORT.bbox;

async function main(): Promise<void> {
  const spots = await queryUnexploredSpotsInBbox({ bbox, limit: 5000, publicOnly: true });
  const routes = await queryUnexploredRoutesInBbox({ bbox, limit: 2000, publicOnly: true });
  const normalized = await normalizeUnexploredLayerDocs({ spots, routes });
  const payloadBytes = Buffer.byteLength(JSON.stringify(normalized.features), "utf8");

  console.log("=== dry-run undiscovered map layer rebuild ===");
  console.log({
    allowWrite,
    wouldWrite: allowWrite ? "mapFeatureLayers/* (not implemented in v1)" : "none (dry-run)",
    features: normalized.features.length,
    dropped: normalized.dropped.length,
    payloadEstimateBytes: payloadBytes,
  });

  if (allowWrite) {
    console.error(
      "ALLOW_MAP_LAYER_WRITE=true but v1 uses live bbox reads — no index collection writer yet.",
    );
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
