import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import {
  applyDescriptionCleanupRows,
  scanPostsDescriptionCleanupBatch,
  summarizeDescriptionCleanupRun,
  writeDescriptionCleanupCsv,
  writeDescriptionCleanupJson,
  type DescriptionCleanupAuditRow,
} from "../../lib/posts/description-cleanup/postDescriptionCleanup.service.js";

const REQUIRED_CONFIRM = "REMOVE_GENERATED_DESCRIPTIONS_ONLY";

const ScanBodySchema = z.object({
  limit: z.number().int().min(1).max(500).optional().default(80),
  startAfter: z.string().min(1).optional().nullable(),
  confidenceThreshold: z.number().min(0).max(1).optional().default(0.85),
  scanAll: z.boolean().optional().default(false),
  maxPosts: z.number().int().min(1).max(50_000).optional().default(2000),
});

const ApplyBodySchema = ScanBodySchema.extend({
  confirm: z.literal(REQUIRED_CONFIRM),
});

const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Post description cleanup</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 20px; background: #0f172a; color: #e2e8f0; }
      h1 { margin-top: 0; }
      .muted { color: #94a3b8; font-size: 14px; }
      .panel { border: 1px solid #334155; border-radius: 8px; padding: 12px; background: #111827; margin-bottom: 12px; }
      .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 8px; }
      input, button { background: #1f2937; border: 1px solid #334155; color: #fff; border-radius: 6px; padding: 8px; }
      button { cursor: pointer; background: #2563eb; }
      button.warn { background: #b45309; }
      button.danger { background: #b91c1c; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
      th, td { border-bottom: 1px solid #334155; text-align: left; padding: 6px; vertical-align: top; }
      pre { background: #020617; padding: 8px; border-radius: 6px; white-space: pre-wrap; max-height: 360px; overflow: auto; }
    </style>
  </head>
  <body>
    <h1>Post description cleanup</h1>
    <p class="muted">Dry-run by default. Apply clears only description/caption fields above the confidence threshold and writes <code>audit.descriptionCleanup</code>. Requires the same env gate as the post rebuilder debug routes.</p>
    <div class="panel">
      <div class="row">
        <label>Page limit <input id="limit" type="number" value="80" min="1" max="500" style="width:80px"/></label>
        <label>Max posts (scan-all cap) <input id="maxPosts" type="number" value="2000" min="1" max="50000" style="width:100px"/></label>
        <label>Start after post id <input id="startAfter" style="width:260px" placeholder="optional"/></label>
        <label>Confidence <input id="confidence" type="number" step="0.01" value="0.85" style="width:80px"/></label>
        <label><input id="scanAll" type="checkbox"/> Scan all (paginated, capped)</label>
      </div>
      <div class="row">
        <button onclick="runScan()">Dry scan</button>
        <input id="confirm" style="width:340px" placeholder="Type ${REQUIRED_CONFIRM} to enable writes" />
        <button class="danger" onclick="runApply()">Apply removals</button>
      </div>
    </div>
    <div class="panel">
      <h3>Summary</h3>
      <pre id="summary">Run a scan.</pre>
    </div>
    <div class="panel">
      <h3>Rows (preview)</h3>
      <table>
        <thead><tr><th>postId</th><th>title</th><th>description</th><th>action</th><th>conf</th><th>fields</th></tr></thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
    <script>
      async function api(path, body) {
        const res = await fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json", "x-viewer-roles": "internal" },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch { /* ignore */ }
        if (!res.ok) throw new Error((json && json.error) || text || res.status);
        return json;
      }
      function valNum(id, fallback) {
        const n = Number(document.getElementById(id).value);
        return Number.isFinite(n) ? n : fallback;
      }
      function payload() {
        return {
          limit: valNum("limit", 80),
          maxPosts: valNum("maxPosts", 2000),
          startAfter: document.getElementById("startAfter").value.trim() || null,
          confidenceThreshold: valNum("confidence", 0.85),
          scanAll: document.getElementById("scanAll").checked,
        };
      }
      async function runScan() {
        document.getElementById("summary").textContent = "Scanning…";
        const data = await api("/debug/api/post-description-cleanup/scan", payload());
        document.getElementById("summary").textContent = JSON.stringify(data.summary, null, 2);
        const tbody = document.getElementById("rows");
        tbody.innerHTML = "";
        for (const r of (data.rows || []).slice(0, 80)) {
          const tr = document.createElement("tr");
          tr.innerHTML = "<td>" + r.postId + "</td><td>" + esc(r.title) + "</td><td>" + esc(r.chosenDescription) + "</td><td>" + r.action + "</td><td>" + r.confidence + "</td><td>" + esc(r.fieldsToUpdate.join(",")) + "</td>";
          tbody.appendChild(tr);
        }
      }
      function esc(s) {
        return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
      }
      async function runApply() {
        const confirm = document.getElementById("confirm").value.trim();
        document.getElementById("summary").textContent = "Applying…";
        const data = await api("/debug/api/post-description-cleanup/apply", { ...payload(), confirm });
        document.getElementById("summary").textContent = JSON.stringify(data, null, 2);
      }
    </script>
  </body>
</html>`;

async function scanAccumulate(input: {
  db: NonNullable<ReturnType<typeof getFirestoreSourceClient>>;
  auditRunId: string;
  confidenceThreshold: number;
  scanAll: boolean;
  maxPosts: number;
  pageLimit: number;
  startAfter: string | null;
}): Promise<{ rows: DescriptionCleanupAuditRow[]; rawDocsScanned: number }> {
  const rows: DescriptionCleanupAuditRow[] = [];
  let cursor: string | null = input.startAfter;
  let raw = 0;
  while (raw < input.maxPosts) {
    const page = Math.min(input.pageLimit, input.maxPosts - raw);
    const batch = await scanPostsDescriptionCleanupBatch(input.db, {
      limit: page,
      startAfterPostId: cursor,
      confidenceThreshold: input.confidenceThreshold,
      auditRunId: input.auditRunId,
    });
    rows.push(...batch.rows);
    raw += batch.rows.length;
    cursor = batch.nextStartAfter;
    if (!input.scanAll) break;
    if (batch.reachedEnd || !cursor) break;
  }
  return { rows, rawDocsScanned: raw };
}

export async function registerPostDescriptionCleanupRoutes(app: FastifyInstance): Promise<void> {
  app.get("/debug/post-description-cleanup", async (_request, reply) =>
    reply.type("text/html; charset=utf-8").send(page),
  );

  app.post("/debug/api/post-description-cleanup/scan", async (request, reply) => {
    const body = ScanBodySchema.parse(request.body ?? {});
    const db = getFirestoreSourceClient();
    if (!db) return reply.status(503).send({ error: "firestore_unavailable" });
    const auditRunId = `dc-web-${randomUUID()}`;
    const { rows, rawDocsScanned } = await scanAccumulate({
      db,
      auditRunId,
      confidenceThreshold: body.confidenceThreshold,
      scanAll: body.scanAll,
      maxPosts: body.maxPosts,
      pageLimit: body.limit,
      startAfter: body.startAfter ?? null,
    });
    const summary = summarizeDescriptionCleanupRun({
      auditRunId,
      rows,
      appliedCount: 0,
      skippedCount: rows.filter((r) => r.fieldsToUpdate.length === 0).length,
    });
    return reply.send({ auditRunId, rawDocsScanned, rows: rows.slice(0, 200), summary });
  });

  app.post("/debug/api/post-description-cleanup/apply", async (request, reply) => {
    const body = ApplyBodySchema.parse(request.body ?? {});
    const db = getFirestoreSourceClient();
    if (!db) return reply.status(503).send({ error: "firestore_unavailable" });
    const auditRunId = `dc-web-${randomUUID()}`;
    const { rows, rawDocsScanned } = await scanAccumulate({
      db,
      auditRunId,
      confidenceThreshold: body.confidenceThreshold,
      scanAll: body.scanAll,
      maxPosts: body.maxPosts,
      pageLimit: body.limit,
      startAfter: body.startAfter ?? null,
    });
    const dir = path.join(os.tmpdir(), "locava-description-cleanup");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = `${Date.now()}`;
    const jsonPath = path.join(dir, `audit-${stamp}.json`);
    const csvPath = path.join(dir, `audit-${stamp}.csv`);
    writeDescriptionCleanupJson(jsonPath, {
      auditRunId,
      generatedAt: new Date().toISOString(),
      mode: "apply",
      rawDocsScanned,
      rows,
    });
    writeDescriptionCleanupCsv(csvPath, rows);
    const applyResult = await applyDescriptionCleanupRows({
      db,
      rows,
      confidenceThreshold: body.confidenceThreshold,
      auditRunId,
      batchDocSize: 25,
      dryRun: false,
    });
    const summary = summarizeDescriptionCleanupRun({
      auditRunId,
      rows,
      appliedCount: applyResult.appliedCount,
      skippedCount: Math.max(0, rows.length - applyResult.appliedCount),
    });
    return reply.send({
      auditRunId,
      rawDocsScanned,
      auditFiles: { json: jsonPath, csv: csvPath },
      apply: applyResult,
      summary,
      onlyDescriptionFieldsTouched: true,
    });
  });
}
