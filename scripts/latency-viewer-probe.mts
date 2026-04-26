/**
 * Cold-cache latency probe for canonical v2 + high-traffic legacy paths.
 * Usage: VIEWER_ID=... npx tsx scripts/latency-viewer-probe.mts
 *
 * Warns when probes exceed LATENCY_WARN_MS (default 500ms for inbox/notifications).
 */
import { createApp } from "../src/app/createApp.js";

const VIEWER_ID = process.env.VIEWER_ID?.trim() || "aXngoh9jeqW35FNM3fq1w9aXdEh1";
const LATENCY_WARN_MS = Number(process.env.LATENCY_WARN_MS ?? "500");

type Probe = { label: string; method: string; url: string; payload?: Record<string, unknown> };

const probes: Probe[] = [
  { label: "v2.auth.session", method: "GET", url: "/v2/auth/session" },
  { label: "v2.feed.bootstrap", method: "GET", url: "/v2/feed/bootstrap?limit=6" },
  { label: "v2.chats.inbox", method: "GET", url: "/v2/chats/inbox?limit=20" },
  { label: "v2.notifications", method: "GET", url: "/v2/notifications?limit=10" },
  { label: "v2.collections.list", method: "GET", url: "/v2/collections/list?limit=20" },
  { label: "legacy.viewer.bootstrap", method: "GET", url: "/api/v1/product/viewer/bootstrap" },
  { label: "legacy.feed.bootstrap", method: "GET", url: "/api/v1/product/feed/bootstrap" },
  { label: "legacy.chats.bootstrap", method: "GET", url: "/api/v1/product/chats/bootstrap" },
  { label: "legacy.notifications.stats", method: "GET", url: "/api/v1/product/notifications/stats" }
];

const budgetLabels = new Set(["v2.chats.inbox", "v2.notifications"]);

async function main(): Promise<void> {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const headers = {
    "x-viewer-id": VIEWER_ID,
    "x-viewer-roles": "internal",
    "content-type": "application/json"
  };

  const rows: Array<{ label: string; ms: number; status: number; serverTiming?: string | null }> = [];
  const warnings: string[] = [];

  for (const p of probes) {
    const runOnce = async (): Promise<{ ms: number; status: number; serverTiming: string | null }> => {
      const t0 = performance.now();
      const res = await app.inject({
        method: p.method,
        url: p.url,
        headers,
        ...(p.payload ? { payload: JSON.stringify(p.payload) } : {})
      });
      const ms = performance.now() - t0;
      const serverTiming = typeof res.headers["server-timing"] === "string" ? res.headers["server-timing"] : null;
      return { ms: Math.round(ms * 100) / 100, status: res.statusCode, serverTiming };
    };

    const first = await runOnce();
    rows.push({ label: p.label, ms: first.ms, status: first.status, serverTiming: first.serverTiming });

    if (budgetLabels.has(p.label)) {
      const warm = await runOnce();
      rows.push({
        label: `${p.label}__warm_repeat`,
        ms: warm.ms,
        status: warm.status,
        serverTiming: warm.serverTiming
      });
      if (warm.ms > LATENCY_WARN_MS) {
        warnings.push(`${p.label} (warm repeat) took ${Math.round(warm.ms)}ms (warn>${LATENCY_WARN_MS}ms) status=${warm.status}`);
        if (warm.serverTiming) warnings.push(`  Server-Timing: ${warm.serverTiming}`);
      }
    }

  }

  await app.close();

  rows.sort((a, b) => b.ms - a.ms);
  process.stdout.write(`${JSON.stringify({ viewerId: VIEWER_ID, latencyWarnMs: LATENCY_WARN_MS, probes: rows }, null, 2)}\n`);
  if (warnings.length > 0) {
    process.stderr.write(`LATENCY_WARNINGS:\n${warnings.map((w) => `  - ${w}`).join("\n")}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
