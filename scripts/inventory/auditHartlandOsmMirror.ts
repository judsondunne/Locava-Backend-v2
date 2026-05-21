#!/usr/bin/env tsx
/**
 * Hartland OSM mirror audit.
 *
 * Default: fixture + sample geojson sanity check (offline).
 * With FETCH_OVERPASS=1: downloads Overpass JSON for Hartland bbox and runs debug ingest.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { runOsmDebugBbox } from "../../src/admin/inventory/inventoryOsmDebug.service.js";
import { INVENTORY_MVP_DEFAULT_VIEWPORT } from "../../src/lib/inventory/inventoryBbox.js";

const OVERPASS_URL = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
const bbox = INVENTORY_MVP_DEFAULT_VIEWPORT.bbox;

async function fetchOverpassJson(): Promise<string> {
  const query = `
[out:json][timeout:60];
(
  node["tourism"](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});
  node["natural"](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});
  node["leisure"](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});
  way["leisure"="park"](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});
  way["natural"](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});
  way["highway"~"path|footway|track|cycleway|bridleway"](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});
  relation["route"~"hiking|foot|walking"](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});
);
out body geom;
`;

  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(`overpass_failed:${res.status}`);
  return res.text();
}

async function main() {
  const fixture = await runOsmDebugBbox({ source: "fixture", limit: 500 });
  console.log("HARTLAND FIXTURE AUDIT");
  console.log(JSON.stringify(fixture.counts, null, 2));
  console.log(JSON.stringify(fixture.coordinateSanity, null, 2));

  const sampleGeojson = path.resolve("src/lib/inventory/sources/hartlandMirrorSample.geojson");
  const geojson = await runOsmDebugBbox({
    source: "geojson",
    geojsonPath: sampleGeojson,
    limit: 500,
  });
  console.log("\nHARTLAND SAMPLE GEOJSON AUDIT");
  console.log(JSON.stringify(geojson.counts, null, 2));

  if (process.env.FETCH_OVERPASS === "1") {
    try {
      const tmpPath = path.resolve(".tmp/hartland-overpass.json");
      await fs.mkdir(path.dirname(tmpPath), { recursive: true });
      const json = await fetchOverpassJson();
      await fs.writeFile(tmpPath, json, "utf8");
      const overpass = await runOsmDebugBbox({
        source: "overpass_json_file",
        overpassJsonPath: tmpPath,
        limit: 5000,
      });
      console.log("\nHARTLAND LIVE OVERPASS AUDIT");
      console.log(JSON.stringify(overpass.counts, null, 2));
      console.log("sampleSpots:", overpass.sampleSpots.map((s) => s.name).slice(0, 20).join(", "));
      console.log("sampleRoutes:", overpass.sampleRoutes.map((r) => r.name).slice(0, 20).join(", "));
    } catch (error) {
      console.warn("\nLive Overpass audit skipped:", error instanceof Error ? error.message : error);
    }
  } else {
    console.log("\nSet FETCH_OVERPASS=1 to run live Overpass audit against Hartland bbox.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
