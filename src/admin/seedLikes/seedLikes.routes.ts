import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { defaultSeedLikesConfig, parseSeedLikesConfig } from "./seedLikesConfig.js";
import {
  dryRunFirstEligiblePost,
  SeedLikesAlreadyRunningError,
  SeedLikesWriteDisabledError,
  startSeedLikesRun,
  stopSeedLikesRun
} from "./seedLikes.service.js";
import { getSeedLikesRunStatus } from "./seedLikesStatus.js";
import { oldWebSeedLikerIdsFallback } from "./loadSeedLikers.js";

function parseConfigFromRequest(request: FastifyRequest) {
  const body = (request.body ?? {}) as Record<string, unknown>;
  return parseSeedLikesConfig(body.config ?? body);
}

function htmlAdminPage(): string {
  const defaults = defaultSeedLikesConfig();
  const seedLikerCount = oldWebSeedLikerIdsFallback().length;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Seed Likes Admin</title>
  <style>
    body{font-family:ui-sans-serif,system-ui;margin:0;background:#0b1220;color:#e5e7eb}
    .shell{max-width:1100px;margin:0 auto;padding:22px 16px 48px}
    h1{font-size:22px;margin:0 0 6px}
    h2{font-size:16px;margin:0 0 10px}
    .muted{color:#9ca3af;font-size:13px;line-height:1.45}
    .panel{border:1px solid #334155;border-radius:12px;background:#111827;padding:14px;margin:14px 0}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
    label{display:flex;flex-direction:column;gap:6px;font-size:12px;color:#cbd5e1}
    input[type="number"],input[type="text"]{padding:8px 10px;border-radius:10px;border:1px solid #374151;background:#0f172a;color:#e5e7eb}
    .check{display:flex;align-items:center;gap:8px;font-size:13px;color:#e5e7eb}
    .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:10px 0}
    button{padding:8px 12px;border-radius:10px;border:1px solid #374151;background:#2563eb;color:#fff;font-weight:700;cursor:pointer}
    button.warn{background:#b45309;border-color:#92400e}
    button.danger{background:#b91c1c;border-color:#991b1b}
    pre.console{background:#020617;border:1px solid #1f2937;border-radius:10px;padding:12px;overflow:auto;font-size:12px;line-height:1.45;max-height:min(42vh,420px)}
  </style>
</head>
<body>
  <div class="shell">
    <h1>Seed Likes Admin</h1>
    <p class="muted">Backend V2-only backfill for legacy fake likers. Configure the run on this page. Dry-run actions never write. Write actions require the allow-writes checkbox below. No notifications, activity feed, push, follower events, or analytics are emitted.</p>
    <div class="panel">
      <h2>Run config</h2>
      <p class="muted">Snapshot fallback pool size: ${seedLikerCount} legacy web seed likers. When “Use old web likers” is checked, the tool loads <code>likeBoosterSetting/global.likers</code> from Firestore first.</p>
      <div class="grid">
        <label>Min existing likes (skip at/above)
          <input id="minExistingLikes" type="number" min="0" value="${defaults.minExistingLikes}"/>
        </label>
        <label>Target min
          <input id="targetMin" type="number" min="0" value="${defaults.targetMin}"/>
        </label>
        <label>Target max
          <input id="targetMax" type="number" min="0" value="${defaults.targetMax}"/>
        </label>
        <label>Batch size
          <input id="batchSize" type="number" min="1" max="500" value="${defaults.batchSize}"/>
        </label>
        <label>Max posts per run (0 = no cap)
          <input id="maxPostsPerRun" type="number" min="0" value="${defaults.maxPostsPerRun}"/>
        </label>
        <label>Run id prefix
          <input id="runIdPrefix" type="text" value="${defaults.runIdPrefix}"/>
        </label>
      </div>
      <div class="row">
        <label class="check"><input id="useOldWebLikers" type="checkbox" ${defaults.useOldWebLikers ? "checked" : ""}/> Use old web likers</label>
        <label class="check"><input id="allowWrites" type="checkbox"/> Allow writes for this session</label>
        <label class="check"><input id="allowTargetBelowMin" type="checkbox"/> Allow target below min</label>
      </div>
    </div>
    <div class="panel">
      <h2>Status</h2>
      <pre id="status" class="console">Loading…</pre>
      <div class="row">
        <button type="button" id="dryFirst">Dry run first eligible post</button>
        <button type="button" id="dryAll">Dry run all posts</button>
        <button type="button" class="warn" id="writeFirst">Write first eligible post</button>
        <button type="button" class="danger" id="writeAll">Write all eligible posts</button>
        <button type="button" id="stop">Stop current run</button>
        <button type="button" id="refresh">Refresh status</button>
      </div>
    </div>
    <div class="panel">
      <h2>Last dry-run preview</h2>
      <pre id="preview" class="console">No preview yet.</pre>
    </div>
  </div>
  <script>
    const STORAGE_KEY = "locava.admin.seedLikes.config.v1";
    function readNumber(id) {
      const value = Number(document.getElementById(id).value);
      return Number.isFinite(value) ? value : 0;
    }
    function collectConfig() {
      return {
        minExistingLikes: readNumber("minExistingLikes"),
        targetMin: readNumber("targetMin"),
        targetMax: readNumber("targetMax"),
        batchSize: readNumber("batchSize"),
        maxPostsPerRun: readNumber("maxPostsPerRun"),
        runIdPrefix: String(document.getElementById("runIdPrefix").value || "seed-likes").trim() || "seed-likes",
        useOldWebLikers: document.getElementById("useOldWebLikers").checked,
        allowWrites: document.getElementById("allowWrites").checked,
        allowTargetBelowMin: document.getElementById("allowTargetBelowMin").checked
      };
    }
    function applyConfig(config) {
      if (!config || typeof config !== "object") return;
      if (config.minExistingLikes != null) document.getElementById("minExistingLikes").value = String(config.minExistingLikes);
      if (config.targetMin != null) document.getElementById("targetMin").value = String(config.targetMin);
      if (config.targetMax != null) document.getElementById("targetMax").value = String(config.targetMax);
      if (config.batchSize != null) document.getElementById("batchSize").value = String(config.batchSize);
      if (config.maxPostsPerRun != null) document.getElementById("maxPostsPerRun").value = String(config.maxPostsPerRun);
      if (config.runIdPrefix != null) document.getElementById("runIdPrefix").value = String(config.runIdPrefix);
      if (config.useOldWebLikers != null) document.getElementById("useOldWebLikers").checked = !!config.useOldWebLikers;
      if (config.allowWrites != null) document.getElementById("allowWrites").checked = !!config.allowWrites;
      if (config.allowTargetBelowMin != null) document.getElementById("allowTargetBelowMin").checked = !!config.allowTargetBelowMin;
    }
    function persistConfig() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(collectConfig())); } catch {}
    }
    function restoreConfig() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        applyConfig(JSON.parse(raw));
      } catch {}
    }
    async function api(path, options) {
      const response = await fetch(path, options);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || body.message || ("http_" + response.status));
      return body;
    }
    async function refresh() {
      const body = await api("/admin/seed-likes/status");
      document.getElementById("status").textContent = JSON.stringify(body.data, null, 2);
      document.getElementById("preview").textContent = JSON.stringify(body.data.lastDryRunPreview ?? null, null, 2);
      if (body.data.activeConfig) applyConfig(body.data.activeConfig);
    }
    function post(path) {
      persistConfig();
      const config = collectConfig();
      return api(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config })
      }).then(() => refresh());
    }
    document.getElementById("refresh").onclick = () => refresh().catch((e) => alert(e.message));
    document.getElementById("dryFirst").onclick = () => {
      persistConfig();
      const config = collectConfig();
      api("/admin/seed-likes/dry-run-first", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config })
      })
        .then((body) => {
          document.getElementById("preview").textContent = JSON.stringify(body.data.preview ?? null, null, 2);
          return refresh();
        })
        .catch((e) => alert(e.message));
    };
    document.getElementById("dryAll").onclick = () => post("/admin/seed-likes/dry-run-all").catch((e) => alert(e.message));
    document.getElementById("writeFirst").onclick = () => {
      if (!collectConfig().allowWrites) {
        alert("Enable allow writes before running a write action.");
        return;
      }
      if (!confirm("Write seed likes for the first eligible post?")) return;
      post("/admin/seed-likes/write-first").catch((e) => alert(e.message));
    };
    document.getElementById("writeAll").onclick = () => {
      if (!collectConfig().allowWrites) {
        alert("Enable allow writes before running a write action.");
        return;
      }
      if (!confirm("Write seed likes for all eligible posts?")) return;
      post("/admin/seed-likes/write-all").catch((e) => alert(e.message));
    };
    document.getElementById("stop").onclick = () => post("/admin/seed-likes/stop").catch((e) => alert(e.message));
    restoreConfig();
    refresh().catch((e) => alert(e.message));
    setInterval(() => refresh().catch(() => {}), 4000);
  </script>
</body>
</html>`;
}

function handleStartError(reply: FastifyReply, error: unknown): void {
  if (error instanceof SeedLikesWriteDisabledError) {
    void reply.status(403).send(failure("seed_likes_writes_disabled", "Enable allow writes in the page config before running a write action."));
    return;
  }
  if (error instanceof SeedLikesAlreadyRunningError) {
    void reply.status(409).send(failure("seed_likes_already_running", "A seed-likes run is already in progress"));
    return;
  }
  void reply.status(500).send(failure("seed_likes_error", error instanceof Error ? error.message : String(error)));
}

export async function registerSeedLikesRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/seed-likes", async (_request, reply) => {
    setRouteName("admin.seed_likes.page");
    reply.type("text/html; charset=utf-8");
    return reply.send(htmlAdminPage());
  });

  app.get("/admin/seed-likes/status", async (_request, reply) => {
    setRouteName("admin.seed_likes.status");
    return reply.send(
      success({
        ...getSeedLikesRunStatus(),
        defaultConfig: defaultSeedLikesConfig(),
        seedLikerSnapshotCount: oldWebSeedLikerIdsFallback().length
      })
    );
  });

  app.post("/admin/seed-likes/dry-run-first", async (request, reply) => {
    setRouteName("admin.seed_likes.dry_run_first");
    try {
      const config = parseConfigFromRequest(request);
      const preview = await dryRunFirstEligiblePost(config);
      return reply.send(success({ preview, config, status: getSeedLikesRunStatus() }));
    } catch (error) {
      handleStartError(reply, error);
    }
  });

  app.post("/admin/seed-likes/dry-run-all", async (request, reply) => {
    setRouteName("admin.seed_likes.dry_run_all");
    try {
      const config = parseConfigFromRequest(request);
      const started = await startSeedLikesRun({ config, mode: "dryRun", scope: "all" });
      return reply.send(success({ started, config, status: getSeedLikesRunStatus() }));
    } catch (error) {
      handleStartError(reply, error);
    }
  });

  app.post("/admin/seed-likes/write-first", async (request, reply) => {
    setRouteName("admin.seed_likes.write_first");
    try {
      const config = parseConfigFromRequest(request);
      const started = await startSeedLikesRun({ config, mode: "write", scope: "first" });
      return reply.send(success({ started, config, status: getSeedLikesRunStatus() }));
    } catch (error) {
      handleStartError(reply, error);
    }
  });

  app.post("/admin/seed-likes/write-all", async (request, reply) => {
    setRouteName("admin.seed_likes.write_all");
    try {
      const config = parseConfigFromRequest(request);
      const started = await startSeedLikesRun({ config, mode: "write", scope: "all" });
      return reply.send(success({ started, config, status: getSeedLikesRunStatus() }));
    } catch (error) {
      handleStartError(reply, error);
    }
  });

  app.post("/admin/seed-likes/stop", async (_request, reply) => {
    setRouteName("admin.seed_likes.stop");
    stopSeedLikesRun();
    return reply.send(success({ status: getSeedLikesRunStatus() }));
  });
}
