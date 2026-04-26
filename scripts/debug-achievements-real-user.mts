import { createApp } from "../src/app/createApp.js";
import { diagnosticsStore } from "../src/observability/diagnostics-store.js";

const viewerId =
  process.env.LOCAVA_VIEWER_ID?.trim() ||
  process.env.DEBUG_VIEWER_ID?.trim() ||
  "aXngoh9jeqW35FNM3fq1w9aXdEh1";

const app = createApp({ LOG_LEVEL: "silent" });
const headers = { "x-viewer-id": viewerId, "x-viewer-roles": "internal" };

function requestIdsOf(payloads: Array<any>): string[] {
  return payloads
    .map((payload) => String(payload?.meta?.requestId ?? "").trim())
    .filter(Boolean);
}

async function getJson(url: string) {
  const res = await app.inject({ method: "GET", url, headers });
  return { statusCode: res.statusCode, json: res.json() as any, url };
}

try {
  const [bootstrap, claimables, xpGlobal, postsGlobal, city] = await Promise.all([
    getJson("/v2/achievements/bootstrap"),
    getJson("/v2/achievements/claimables"),
    getJson("/v2/achievements/leaderboard/xp_global"),
    getJson("/v2/achievements/leaderboard/posts_global"),
    getJson("/v2/achievements/leaderboard/city")
  ]);

  const requestIds = requestIdsOf([bootstrap.json, claimables.json, xpGlobal.json, postsGlobal.json, city.json]);
  const diagRows = diagnosticsStore
    .getRecentRequests(200)
    .filter((row) => requestIds.includes(row.requestId));
  const totalReads = diagRows.reduce((sum, row) => sum + (row.dbOps?.reads ?? 0), 0);
  const totalQueries = diagRows.reduce((sum, row) => sum + (row.dbOps?.queries ?? 0), 0);
  const cacheHits = diagRows.reduce((sum, row) => sum + (row.cache?.hits ?? 0), 0);
  const cacheMisses = diagRows.reduce((sum, row) => sum + (row.cache?.misses ?? 0), 0);

  const bootstrapData = bootstrap.json.data;
  const claimablesData = claimables.json.data?.claimables;
  const xpRows = xpGlobal.json.data?.leaderboard ?? [];
  const postRows = postsGlobal.json.data?.leaderboard ?? [];
  const cityRows = city.json.data?.leaderboard ?? [];

  const topBadges = (bootstrapData?.snapshot?.badges ?? [])
    .filter((badge: any) => badge.earned)
    .slice(0, 5)
    .map((badge: any) => `${badge.title} (${badge.badgeSource ?? "static"})`);

  const missingWarnings: string[] = [];
  if (!bootstrapData?.hero) missingWarnings.push("missing hero");
  if (!bootstrapData?.snapshot) missingWarnings.push("missing snapshot");
  if (!Array.isArray(bootstrapData?.leagues) || bootstrapData.leagues.length === 0) missingWarnings.push("missing leagues");
  if (!Array.isArray(xpRows) || xpRows.length === 0) missingWarnings.push("missing xp leaderboard rows");

  console.log(`viewer id: ${viewerId}`);
  console.log(`xp: ${bootstrapData?.hero?.xp?.current ?? "n/a"}`);
  console.log(`level: ${bootstrapData?.hero?.xp?.level ?? "n/a"}`);
  console.log(`streak: ${bootstrapData?.hero?.streak?.current ?? "n/a"}`);
  console.log(`league: ${bootstrapData?.hero?.xp?.tier ?? "n/a"}`);
  console.log(`earned badge count: ${(bootstrapData?.snapshot?.badges ?? []).filter((badge: any) => badge.earned).length}`);
  console.log(`claimable count: ${claimablesData?.totalCount ?? 0}`);
  console.log(`top badges: ${topBadges.join(", ") || "none"}`);
  console.log(
    `leaderboard ranks: xp_global=${xpGlobal.json.data?.viewerRank ?? "n/a"} posts_global=${postsGlobal.json.data?.viewerRank ?? "n/a"} city=${city.json.data?.viewerRank ?? "n/a"}`
  );
  console.log(`cache status: hits=${cacheHits} misses=${cacheMisses}`);
  console.log(`firestore read/query summary: reads=${totalReads} queries=${totalQueries}`);
  console.log(`payload size: bootstrap=${JSON.stringify(bootstrapData ?? {}).length}B claimables=${JSON.stringify(claimablesData ?? {}).length}B`);
  console.log(`top xp rows: ${(xpRows as any[]).slice(0, 3).map((row) => `${row.rank}:${row.userName}:${row.score}`).join(" | ")}`);
  console.log(`top posts rows: ${(postRows as any[]).slice(0, 3).map((row) => `${row.rank}:${row.userName}:${row.score}`).join(" | ")}`);
  console.log(`top city rows: ${(cityRows as any[]).slice(0, 3).map((row) => `${row.rank}:${row.userName}:${row.score}`).join(" | ") || "none"}`);
  console.log(`missing data warnings: ${missingWarnings.join("; ") || "none"}`);

  if (
    bootstrap.statusCode !== 200 ||
    claimables.statusCode !== 200 ||
    xpGlobal.statusCode !== 200 ||
    postsGlobal.statusCode !== 200
  ) {
    process.exitCode = 1;
  }
} finally {
  await app.close();
}
