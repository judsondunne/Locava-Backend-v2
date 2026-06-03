/**
 * Download VT town highway Class 4 segments from VTrans ALL ROADS (AOTCLASS=4)
 * into a local GeoJSON file for the offroad classifier pipeline.
 *
 * Usage:
 *   npx tsx scripts/inventory/downloadVtClass4RoadsGeojson.ts \
 *     --centerLat 43.54063 --centerLng -72.39898 --radiusKm 12 \
 *     --out data/inventory/vt-class4-hartland.geojson
 *
 * Optional: --includeLegalTrails (AOTCLASS=7) --statewide (ignore bbox, slow)
 */
import fs from "node:fs/promises";
import path from "node:path";
import { bboxFromCenterRadiusKm } from "../../src/lib/inventory/inventoryBbox.js";
import { INVENTORY_MVP_DEFAULT_VIEWPORT, INVENTORY_MVP_DEFAULT_RADIUS_KM } from "../../src/lib/inventory/inventoryBbox.js";

const VTRANS_LAYER =
  "https://maps.vtrans.vermont.gov/arcgis/rest/services/Layers/PublicHighwaySystem/MapServer/6/query";

type EsriFeature = {
  attributes: Record<string, unknown>;
  geometry?: { paths?: number[][][] };
};

function parseArgs(argv: string[]): {
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  out: string;
  includeLegalTrails: boolean;
  statewide: boolean;
} {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const center = INVENTORY_MVP_DEFAULT_VIEWPORT.center;
  const out = get("--out") ?? "data/inventory/vt-class4.geojson";
  return {
    centerLat: Number(get("--centerLat") ?? center.lat),
    centerLng: Number(get("--centerLng") ?? center.lng),
    radiusKm: Number(get("--radiusKm") ?? INVENTORY_MVP_DEFAULT_RADIUS_KM),
    out,
    includeLegalTrails: argv.includes("--includeLegalTrails"),
    statewide: argv.includes("--statewide"),
  };
}

function esriPathsToGeoJsonFeature(f: EsriFeature): GeoJSON.Feature | null {
  const paths = f.geometry?.paths;
  if (!paths?.length || !paths[0]?.length) return null;
  const attrs = f.attributes;
  const aot = attrs.AOTCLASS;
  const isClass4 = aot === 4;
  const isLegalTrail = aot === 7;
  if (!isClass4 && !isLegalTrail) return null;

  const primaryName = typeof attrs.PRIMARYNAME === "string" ? attrs.PRIMARYNAME.trim() : "";
  const properties: Record<string, unknown> = {
    ...attrs,
    class: isClass4 ? "4" : "7",
    road_class: isClass4 ? "4" : "7",
    AOTCLASS: aot,
    name: primaryName || (isClass4 ? "Class 4 Road" : "Legal Trail"),
    towngeoid: attrs.TOWNGEOID,
    source: "vtrans_all_roads",
  };

  if (paths.length === 1) {
    return {
      type: "Feature",
      properties,
      geometry: { type: "LineString", coordinates: paths[0]!.map(([lng, lat]) => [lng, lat]) },
    };
  }

  return {
    type: "Feature",
    properties,
    geometry: {
      type: "MultiLineString",
      coordinates: paths.map((p) => p.map(([lng, lat]) => [lng, lat])),
    },
  };
}

async function fetchPage(input: {
  where: string;
  bbox?: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  offset: number;
  pageSize: number;
}): Promise<{ features: EsriFeature[]; exceeded: boolean }> {
  const params = new URLSearchParams({
    where: input.where,
    outFields: "AOTCLASS,RPCCLASS,PRIMARYNAME,TOWNGEOID,SEGMENTID,OBJECTID,SURFACETYPE",
    returnGeometry: "true",
    outSR: "4326",
    f: "json",
    resultRecordCount: String(input.pageSize),
    resultOffset: String(input.offset),
  });
  if (input.bbox) {
    const { minLng, minLat, maxLng, maxLat } = input.bbox;
    params.set("geometry", `${minLng},${minLat},${maxLng},${maxLat}`);
    params.set("geometryType", "esriGeometryEnvelope");
    params.set("inSR", "4326");
    params.set("spatialRel", "esriSpatialRelIntersects");
  }

  const res = await fetch(`${VTRANS_LAYER}?${params.toString()}`, {
    headers: { "User-Agent": "LocavaInventory/1.0 (admin offroad download)" },
  });
  if (!res.ok) throw new Error(`vtrans_query_failed:${res.status}`);
  const json = (await res.json()) as { features?: EsriFeature[]; error?: { message?: string }; exceededTransferLimit?: boolean };
  if (json.error) throw new Error(`vtrans_query_error:${json.error.message ?? "unknown"}`);
  return { features: json.features ?? [], exceeded: Boolean(json.exceededTransferLimit) };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const bbox = args.statewide
    ? undefined
    : bboxFromCenterRadiusKm({ lat: args.centerLat, lng: args.centerLng }, args.radiusKm);
  const where = args.includeLegalTrails ? "AOTCLASS IN (4,7)" : "AOTCLASS=4";

  console.log(
    `Downloading VT Class 4${args.includeLegalTrails ? " + legal trails" : ""} → ${args.out}${
      bbox ? ` (bbox ~${args.radiusKm}km around ${args.centerLat},${args.centerLng})` : " (statewide)"
    }`
  );

  const pageSize = 500;
  let offset = 0;
  const allFeatures: GeoJSON.Feature[] = [];
  let pages = 0;

  for (;;) {
    const page = await fetchPage({ where, bbox, offset, pageSize });
    pages += 1;
    for (const f of page.features) {
      const geo = esriPathsToGeoJsonFeature(f);
      if (geo) allFeatures.push(geo);
    }
    console.log(`  page ${pages}: +${page.features.length} segments (kept ${allFeatures.length} total)`);
    if (!page.exceeded || page.features.length === 0) break;
    offset += page.features.length;
    if (pages > 500) throw new Error("vtrans_pagination_limit_exceeded");
  }

  const collection: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: allFeatures,
  };

  await fs.mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
  await fs.writeFile(args.out, JSON.stringify(collection, null, 2));
  console.log(`Wrote ${allFeatures.length} Class 4 / legal-trail segments to ${path.resolve(args.out)}`);
  console.log(`Set VT_CLASS4_GEOJSON_PATH=${path.resolve(args.out)} or paste path in /admin/openstreetmap Region panel.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
