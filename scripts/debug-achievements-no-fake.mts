import { createApp } from "../src/app/createApp.js";

const viewerId =
  process.env.LOCAVA_VIEWER_ID?.trim() ||
  process.env.DEBUG_VIEWER_ID?.trim() ||
  "aXngoh9jeqW35FNM3fq1w9aXdEh1";

const app = createApp({ LOG_LEVEL: "silent" });
const headers = { "x-viewer-id": viewerId, "x-viewer-roles": "internal" };
const bannedTokens = [
  "fake",
  "stub",
  "placeholder",
  "mock",
  "sample",
  "demo",
  "hardcoded",
  "fallback"
];

function walk(value: unknown, hits: string[], path: string): void {
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    bannedTokens.forEach((token) => {
      if (normalized.includes(token)) hits.push(`${path}:${token}:${value}`);
    });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, hits, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => walk(item, hits, `${path}.${key}`));
  }
}

try {
  const urls = [
    "/v2/achievements/bootstrap",
    "/v2/achievements/badges",
    "/v2/achievements/claimables",
    "/v2/achievements/leaderboard/xp_global"
  ];
  const responses = await Promise.all(urls.map((url) => app.inject({ method: "GET", url, headers })));
  const hits: string[] = [];
  responses.forEach((res, index) => walk(res.json(), hits, urls[index]!));
  const failures = responses
    .map((res, index) => ({ url: urls[index]!, statusCode: res.statusCode, json: res.json() as any }))
    .filter((row) => row.statusCode !== 200 || row.json?.data?.degraded === true || (row.json?.data?.fallbacks ?? []).length > 0);

  console.log(`checked routes: ${urls.join(", ")}`);
  console.log(`string-token hits: ${hits.length}`);
  hits.slice(0, 20).forEach((hit) => console.log(`  ${hit}`));
  console.log(`degraded/fallback failures: ${failures.length}`);
  failures.forEach((failure) => console.log(`  ${failure.url} status=${failure.statusCode}`));

  if (hits.length > 0 || failures.length > 0) {
    process.exitCode = 1;
  }
} finally {
  await app.close();
}
