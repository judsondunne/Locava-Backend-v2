#!/usr/bin/env npx tsx
/**
 * One-shot operator purge — unexploredSpots + unexploredRoutes + unexploredTiles only.
 * Requires OSM_PBF_COPIER_ALLOW_PURGE_UNDISCOVERED=true
 */
import "dotenv/config";
import {
  PBF_PURGE_UNDISCOVERED_CONFIRMATION,
  purgeAllUndiscoveredSpotsAndRoutes,
} from "../src/admin/openstreetmap/national/pbfCopier/pbfCopierUndiscoveredPurge.js";
import { VERMONT_OFFROAD_PRODUCTION_PASSWORD } from "../src/admin/openstreetmap/national/osmNationalWriteGuard.js";

const dryRun = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  const summary = await purgeAllUndiscoveredSpotsAndRoutes({
    writeTarget: "production",
    confirmProductionWrite: VERMONT_OFFROAD_PRODUCTION_PASSWORD,
    confirmPurge: PBF_PURGE_UNDISCOVERED_CONFIRMATION,
    dryRun,
  });
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
