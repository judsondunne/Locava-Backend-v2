#!/usr/bin/env npx tsx
/**
 * Simulates a coarse "app open" burst against a running Backendv2 instance.
 * Usage: BACKEND_URL=http://127.0.0.1:8787 npx tsx scripts/startup-app-open-sim.mts
 *
 * Prints JSON lines: route, latencyMs, statusCode, orderIndex.
 */

const base = (process.env.BACKEND_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const viewerId = process.env.STARTUP_SIM_VIEWER_ID ?? "internal-viewer";
const roles = process.env.STARTUP_SIM_VIEWER_ROLES ?? "internal";

const headers: Record<string, string> = {
  "x-viewer-id": viewerId,
  "x-viewer-roles": roles,
  "content-type": "application/json"
};

type Step = { name: string; path: string; method?: string; body?: unknown };

const steps: Step[] = [
  { name: "feed.for_you_simple", path: "/v2/feed/for-you/simple", method: "GET" },
  { name: "auth.session", path: "/v2/auth/session", method: "GET" },
  { name: "profile.bootstrap", path: `/v2/profiles/${encodeURIComponent(viewerId)}/bootstrap`, method: "GET" },
  {
    name: "posts.detail.batch",
    path: "/v2/posts/details:batch",
    method: "POST",
    body: { postIds: ["startup-sim-placeholder"], reason: "prefetch", hydrationMode: "open" }
  },
  { name: "search.home_bootstrap", path: "/v2/search/home-bootstrap", method: "GET" },
  { name: "achievements.bootstrap", path: "/v2/achievements/bootstrap", method: "GET" },
  { name: "legends.events.unseen", path: "/v2/legends/events/unseen", method: "GET" },
  { name: "achievements.leaderboard.xp_global", path: "/v2/achievements/leaderboard/xp_global", method: "GET" }
];

async function runStep(step: Step, orderIndex: number): Promise<void> {
  const method = step.method ?? "GET";
  const url = `${base}${step.path.startsWith("/") ? step.path : `/${step.path}`}`;
  const init: RequestInit = { method, headers: { ...headers } };
  if (step.body != null && method !== "GET") {
    init.body = JSON.stringify(step.body);
  }
  const t0 = Date.now();
  const res = await fetch(url, init);
  const latencyMs = Date.now() - t0;
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      kind: "startup_app_open_sim",
      route: step.name,
      path: step.path,
      orderIndex,
      statusCode: res.status,
      latencyMs
    })
  );
}

async function main(): Promise<void> {
  let i = 0;
  for (const s of steps) {
    await runStep(s, i++);
  }
}

await main();
