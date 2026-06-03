#!/usr/bin/env npx tsx
/**
 * READ-ONLY — Harness GET /v2/map/layers/undiscovered vs Firestore source counts.
 */
import "dotenv/config";
import { INVENTORY_MVP_DEFAULT_VIEWPORT } from "../src/lib/inventory/inventoryBbox.js";
import {
  queryUnexploredRoutesInBbox,
  queryUnexploredSpotsInBbox,
} from "../src/repositories/source-of-truth/unexplored-read-firestore.adapter.js";
import { normalizeUnexploredLayerDocs } from "../src/services/map/undiscoveredMapLayer.normalizer.js";

const base = process.env.LOCAVA_BACKEND_BASE ?? "http://127.0.0.1:8080";
const viewerId = process.env.VIEWER_UID ?? "anonymous";
const bbox = INVENTORY_MVP_DEFAULT_VIEWPORT.bbox;
const bboxStr = `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`;

const FORBIDDEN = [
  "commentCount",
  "likeCount",
  '"assets"',
  '"author"',
  "openPayload",
  "displayPhotoLink",
];

function isPublic(data: Record<string, unknown>): boolean {
  if (data.publicMapEligible !== true) return false;
  const readiness =
    typeof data.mapReadiness === "string" ? data.mapReadiness : null;
  return readiness !== "hidden";
}

async function fetchLayer(): Promise<{ body: string; status: number; headers: Headers }> {
  const url = `${base}/v2/map/layers/undiscovered?bbox=${encodeURIComponent(bboxStr)}&zoom=14&mode=durable`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "x-viewer-id": viewerId,
      "x-viewer-roles": "internal",
    },
  });
  const body = await res.text();
  return { body, status: res.status, headers: res.headers };
}

async function main(): Promise<void> {
  const spots = await queryUnexploredSpotsInBbox({ bbox, limit: 5000, publicOnly: true });
  const routes = await queryUnexploredRoutesInBbox({ bbox, limit: 2000, publicOnly: true });
  const normalized = await normalizeUnexploredLayerDocs({ spots, routes });

  const first = await fetchLayer();
  if (first.status === 404) {
    console.log("Layer endpoint returned 404 — set ENABLE_UNDISCOVERED_MAP_LAYER_V1=true on backend");
    process.exit(2);
  }
  const parsed = JSON.parse(first.body) as { data?: { features?: unknown[]; counts?: Record<string, number>; diagnostics?: Record<string, unknown> } };
  const features = parsed.data?.features ?? [];
  const payloadBytes = Buffer.byteLength(JSON.stringify(features), "utf8");
  const leaks = FORBIDDEN.filter((k) => first.body.includes(k));

  const etag = first.headers.get("etag");
  let secondCacheHit = false;
  if (etag) {
    const url = `${base}/v2/map/layers/undiscovered?bbox=${encodeURIComponent(bboxStr)}&zoom=14`;
    const res2 = await fetch(url, {
      headers: {
        Accept: "application/json",
        "x-viewer-id": viewerId,
        "x-viewer-roles": "internal",
        "If-None-Match": etag,
      },
    });
    if (res2.status === 304) secondCacheHit = true;
    const res3 = await fetch(url, {
      headers: {
        Accept: "application/json",
        "x-viewer-id": viewerId,
        "x-viewer-roles": "internal",
      },
    });
    const p3 = JSON.parse(await res3.text()) as { data?: { diagnostics?: { cacheHit?: boolean } } };
    secondCacheHit = secondCacheHit || p3.data?.diagnostics?.cacheHit === true;
  }

  console.log("=== map layer endpoint harness ===");
  console.log({
    firestoreNormalized: {
      features: normalized.features.length,
      points: normalized.features.filter((f) => f.featureKind === "point").length,
      routes: normalized.features.filter((f) => f.featureKind === "route").length,
    },
    endpoint: {
      status: first.status,
      counts: parsed.data?.counts,
      featureCount: features.length,
      payloadBytes,
      diagnostics: parsed.data?.diagnostics,
      dtoLeaks: leaks,
      secondRequestCacheHit: secondCacheHit,
    },
  });

  if (first.status !== 200) process.exit(1);
  if (leaks.length > 0) {
    console.error("DTO leak fields:", leaks);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
