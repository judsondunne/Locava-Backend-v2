import { loadEnv } from "../src/config/env.ts";
import { MapMarkersFirestoreAdapter } from "../src/repositories/source-of-truth/map-markers-firestore.adapter.ts";

const env = loadEnv();
const baseUrl = process.env.BACKEND_URL ?? "http://127.0.0.1:8080";
const headers = {
  "x-viewer-id": process.env.DEBUG_VIEWER_ID ?? "internal-viewer",
  "x-viewer-roles": "internal"
};

async function fetchJson(path: string): Promise<{ status: number; body: any; bytes: number }> {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  const text = await response.text();
  return {
    status: response.status,
    body: JSON.parse(text),
    bytes: Buffer.byteLength(text, "utf8")
  };
}

async function main(): Promise<void> {
  const adapter = new MapMarkersFirestoreAdapter();
  const eligible = await adapter.fetchAll({ maxDocs: env.MAP_MARKERS_MAX_DOCS });
  const universe = await fetchJson("/v2/map/markers");
  const bootstrap = await fetchJson(`/v2/map/bootstrap?bbox=${encodeURIComponent("-125.0,24.0,-66.0,49.0")}&limit=300`);

  const universeMarkers = Array.isArray(universe.body?.data?.markers) ? universe.body.data.markers : [];
  const universeIds = new Set<string>(universeMarkers.map((marker: { postId?: string }) => String(marker.postId ?? "")));
  const oldestEligible = eligible.markers[eligible.markers.length - 1] ?? null;
  const newestEligible = eligible.markers[0] ?? null;
  const sampleIds = [newestEligible?.postId, eligible.markers[Math.floor(eligible.markers.length / 2)]?.postId, oldestEligible?.postId].filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );

  const sampleReads = [];
  for (const postId of sampleIds) {
    const response = await fetch(`${baseUrl}/api/posts/${encodeURIComponent(postId)}`, { headers });
    sampleReads.push({ postId, status: response.status });
  }

  console.log(
    JSON.stringify(
      {
        baseUrl,
        sourceEligibleCount: eligible.count,
        sourceReadCount: eligible.readCount,
        sourceInvalidCoordinateDrops: eligible.invalidCoordinateDrops,
        routeCount: universe.body?.data?.count ?? null,
        routeMarkersLength: universeMarkers.length,
        routeBytes: universe.bytes,
        bootstrapCount: bootstrap.body?.data?.page?.count ?? null,
        bootstrapHasMore: bootstrap.body?.data?.page?.hasMore ?? null,
        bootstrapBytes: bootstrap.bytes,
        newestEligiblePostId: newestEligible?.postId ?? null,
        newestEligiblePresentInRoute: newestEligible ? universeIds.has(newestEligible.postId) : false,
        oldestEligiblePostId: oldestEligible?.postId ?? null,
        oldestEligiblePresentInRoute: oldestEligible ? universeIds.has(oldestEligible.postId) : false,
        sampleReads
      },
      null,
      2
    )
  );
}

void main().catch((error) => {
  console.error("[debug:map:universe:parity] failed", error);
  process.exit(1);
});
