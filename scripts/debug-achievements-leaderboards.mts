import { createApp } from "../src/app/createApp.js";

const viewerId =
  process.env.LOCAVA_VIEWER_ID?.trim() ||
  process.env.DEBUG_VIEWER_ID?.trim() ||
  "aXngoh9jeqW35FNM3fq1w9aXdEh1";

const app = createApp({ LOG_LEVEL: "silent" });
const headers = { "x-viewer-id": viewerId, "x-viewer-roles": "internal" };

async function probe(url: string) {
  const res = await app.inject({ method: "GET", url, headers });
  const json = res.json() as any;
  return {
    url,
    statusCode: res.statusCode,
    viewerRank: json?.data?.viewerRank ?? json?.data?.data?.viewerRank ?? null,
    count: Array.isArray(json?.data?.leaderboard) ? json.data.leaderboard.length : 0,
    top: Array.isArray(json?.data?.leaderboard) ? json.data.leaderboard.slice(0, 3) : []
  };
}

try {
  const rows = await Promise.all([
    probe("/v2/achievements/leaderboard/xp_global"),
    probe("/v2/achievements/leaderboard/posts_global"),
    probe("/v2/achievements/leaderboard/xp_league"),
    probe("/v2/achievements/leaderboard/xp_friends"),
    probe("/v2/achievements/leaderboard/city"),
    probe("/v2/achievements/leaderboard/xp_global/viewer-rank")
  ]);

  rows.forEach((row) => {
    console.log(`${row.url} status=${row.statusCode} viewerRank=${row.viewerRank ?? "n/a"} count=${row.count}`);
    if (row.top.length > 0) {
      console.log(`  top: ${row.top.map((entry: any) => `${entry.rank}:${entry.userName}:${entry.score}`).join(" | ")}`);
    }
  });

  if (rows.some((row) => row.statusCode !== 200)) {
    process.exitCode = 1;
  }
} finally {
  await app.close();
}
