import { createApp } from "../src/app/createApp.ts";

function num(arg: string | undefined, fallback: number) {
  const n = Number(arg);
  return Number.isFinite(n) ? n : fallback;
}

const mixId = process.argv[2] ?? "nearby:near_you";
const pages = Math.max(1, Math.min(5, num(process.argv[3], 3)));
const limit = Math.max(4, Math.min(36, num(process.argv[4], 12)));
const lat = Number.isFinite(Number(process.argv[5])) ? Number(process.argv[5]) : 40.68843;
const lng = Number.isFinite(Number(process.argv[6])) ? Number(process.argv[6]) : -75.22073;
const viewerId = process.env.VIEWER_ID ?? "internal-viewer";

const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
const headers = {
  "x-viewer-id": viewerId,
  "x-viewer-roles": "internal",
  "content-type": "application/json",
};

let cursor: string | null = null;
const seen = new Set<string>();

for (let page = 1; page <= pages; page += 1) {
  const res = await app.inject({
    method: "POST",
    url: "/v2/search/mixes/feed",
    headers,
    payload: JSON.stringify({ mixId, cursor, limit, lat, lng, includeDebug: true }),
  });
  if (res.statusCode !== 200) {
    console.log(`[mix-audit] page=${page} status=${res.statusCode}`);
    console.log(res.body);
    break;
  }
  const body = res.json().data as any;
  const ids = (body.posts ?? []).map((p: any) => String(p.id ?? p.postId ?? "").trim()).filter(Boolean);
  const dupes = ids.filter((id: string) => seen.has(id));
  ids.forEach((id: string) => seen.add(id));
  const dists = ((body.debug?.items ?? []) as any[])
    .map((it) => (typeof it.distanceMiles === "number" ? it.distanceMiles : null))
    .filter((d) => d != null);

  console.log(
    `[mix-audit] page=${page} count=${ids.length} hasMore=${Boolean(body.hasMore)} nextCursor=${body.nextCursor ? "yes" : "no"} dupes=${dupes.length}`
  );
  if (dists.length) {
    console.log(
      `[mix-audit] distances(mi): min=${Math.min(...dists).toFixed(2)} med=${dists.sort((a, b) => a - b)[Math.floor(dists.length / 2)].toFixed(2)} max=${Math.max(...dists).toFixed(2)}`
    );
  }
  cursor = body.nextCursor ?? null;
  if (!cursor) break;
}

