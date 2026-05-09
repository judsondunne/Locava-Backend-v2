#!/usr/bin/env -S node --import tsx
// audit-posting-contract-v2 -- read-only by default; APPLY=true gates safe metadata-sync writes.

import {
  checkPostContractV2,
  classifyPostForAudit,
} from "../src/contracts/posts/postContractV2.js";
import type { PostContractClassification } from "../src/contracts/posts/postContractV2.js";
import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";

type AuditPostRecord = {
  postId: string;
  raw: Record<string, unknown>;
};

type AuditFinding = {
  postId: string;
  classification: PostContractClassification;
  pendingOk: boolean;
  readyOk: boolean;
  pendingErrorCount: number;
  readyErrorCount: number;
  hints: string[];
  /** Top 5 error codes per side for quick triage. */
  topPendingErrors: string[];
  topReadyErrors: string[];
  /** When --apply: list of safe metadata-sync repairs that were proposed (and applied if APPLY=true). */
  proposedRepairs: string[];
  appliedRepairs: string[];
};

function parseFlags(argv: string[]): {
  apply: boolean;
  postIds: string[];
  limit: number;
  collection: string;
} {
  const apply =
    argv.includes("--apply") ||
    String(process.env.APPLY ?? "").trim().toLowerCase() === "true";
  const idsCsv =
    String(process.env.AUDIT_POST_IDS ?? "").trim() ||
    (() => {
      const i = argv.indexOf("--post-ids");
      return i >= 0 ? String(argv[i + 1] ?? "").trim() : "";
    })();
  const postIds = idsCsv ? idsCsv.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const limit = Number(process.env.AUDIT_LIMIT ?? "100");
  const collection = String(process.env.AUDIT_POSTS_COLLECTION ?? "posts").trim() || "posts";
  return { apply, postIds, limit, collection };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Compute proposed safe metadata-sync repairs for a single post (NEVER mutates input).
 * Returns a list of repair labels and an optional dotted-path Firestore patch object.
 */
function computeSafeRepairs(post: Record<string, unknown>): {
  labels: string[];
  patch: Record<string, unknown>;
} {
  const labels: string[] = [];
  const patch: Record<string, unknown> = {};

  const playbackLab = asRecord(post.playbackLab);
  if (!playbackLab) return { labels, patch };
  if (playbackLab.lastVerifyAllOk !== true) return { labels, patch };
  const labAssets = asRecord(playbackLab.assets);
  if (!labAssets) return { labels, patch };

  const media = asRecord(post.media);
  const assets = Array.isArray(media?.assets)
    ? (media.assets as Array<Record<string, unknown>>)
    : [];

  let firstStartup720: string | null = null;

  for (const asset of assets) {
    const id = String(asset.id ?? "");
    if (!id) continue;
    const labNode = asRecord(labAssets[id]);
    const gen = asRecord(labNode?.generated);
    const startup720 = trimStr(gen?.startup720FaststartAvc);
    const startup540 = trimStr(gen?.startup540FaststartAvc);

    if (!firstStartup720 && startup720.startsWith("http")) {
      firstStartup720 = startup720;
    }

    if (!startup720 || !startup540) continue;
    const v = asRecord(asset.video);
    const variants = asRecord(v?.variants) ?? {};
    if (!trimStr(variants.startup720FaststartAvc)) {
      labels.push(`promote_lab_startup720_to_canonical:${id}`);
      patch[`media.assets.[id=${id}].video.variants.startup720FaststartAvc`] = startup720;
    }
    if (!trimStr(variants.startup540FaststartAvc)) {
      labels.push(`promote_lab_startup540_to_canonical:${id}`);
      patch[`media.assets.[id=${id}].video.variants.startup540FaststartAvc`] = startup540;
    }
  }

  // Compatibility mirrors: only update if currently empty or pointing at the poster image.
  if (firstStartup720) {
    const compat = asRecord(post.compatibility);
    if (compat) {
      for (const k of ["photoLinks2", "photoLinks3"] as const) {
        const cur = trimStr(compat[k]);
        if (!cur) {
          labels.push(`mirror_compatibility_${k}_to_startup720`);
          patch[`compatibility.${k}`] = firstStartup720;
          continue;
        }
        // If current value resolves to an image (poster), and the post is otherwise eligible for
        // ready, mirror to the canonical playable URL.
        if (
          /\.(jpe?g|png|webp|gif|heic|heif|avif)(\?|$)/i.test(cur) &&
          /faststart[_-]?avc/i.test(firstStartup720)
        ) {
          labels.push(`replace_compatibility_${k}_image_with_startup720`);
          patch[`compatibility.${k}`] = firstStartup720;
        }
      }
    }
  }

  return { labels, patch };
}

async function fetchPosts(opts: {
  postIds: string[];
  limit: number;
  collection: string;
}): Promise<AuditPostRecord[]> {
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable_for_audit_script");

  const out: AuditPostRecord[] = [];
  if (opts.postIds.length > 0) {
    for (const id of opts.postIds) {
      const snap = await db.collection(opts.collection).doc(id).get();
      if (!snap.exists) {
        // eslint-disable-next-line no-console
        console.warn(`[audit] post not found: ${id}`);
        continue;
      }
      out.push({ postId: id, raw: (snap.data() ?? {}) as Record<string, unknown> });
    }
    return out;
  }

  // Recent posts by `time desc` if present, else `createdAtMs desc`. Read-only.
  const limit = Math.max(1, Math.min(2000, opts.limit));
  let query = db.collection(opts.collection).orderBy("time", "desc").limit(limit);
  let snap = await query.get().catch(() => null);
  if (!snap) {
    query = db.collection(opts.collection).orderBy("createdAtMs", "desc").limit(limit);
    snap = await query.get();
  }
  for (const d of snap.docs) {
    out.push({ postId: d.id, raw: (d.data() ?? {}) as Record<string, unknown> });
  }
  return out;
}

function summarize(findings: AuditFinding[]): {
  total: number;
  byClassification: Record<PostContractClassification, number>;
  withProposedRepairs: number;
  withAppliedRepairs: number;
} {
  const counter: Record<PostContractClassification, number> = {
    valid_pending: 0,
    valid_ready: 0,
    invalid_contract: 0,
    invalid_media_sync: 0,
    invalid_compatibility_sync: 0,
    processor_failed_after_generation: 0,
    poster_playback_mismatch_risk: 0,
    possible_hdr_poster_mismatch: 0,
  };
  let withProposed = 0;
  let withApplied = 0;
  for (const f of findings) {
    counter[f.classification] += 1;
    if (f.proposedRepairs.length > 0) withProposed += 1;
    if (f.appliedRepairs.length > 0) withApplied += 1;
  }
  return {
    total: findings.length,
    byClassification: counter,
    withProposedRepairs: withProposed,
    withAppliedRepairs: withApplied,
  };
}

async function applySafeRepair(
  postId: string,
  patch: Record<string, unknown>,
  collection: string,
): Promise<void> {
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable_for_apply");
  // Translate dotted-path keys with `[id=...]` into nested updates by reading the doc and rewriting.
  // This keeps the apply path narrow and avoids using FieldValue.delete entirely.
  const docRef = db.collection(collection).doc(postId);
  const snap = await docRef.get();
  if (!snap.exists) throw new Error(`post_missing_at_apply:${postId}`);
  const cur = (snap.data() ?? {}) as Record<string, unknown>;

  function setDeep(target: Record<string, unknown>, path: string, value: unknown): void {
    const segments: string[] = [];
    let i = 0;
    while (i < path.length) {
      if (path.startsWith(".[id=", i)) {
        const end = path.indexOf("]", i);
        if (end < 0) throw new Error(`malformed_apply_path:${path}`);
        segments.push(path.slice(i + 1, end + 1));
        i = end + 1;
        if (path[i] === ".") i += 1;
      } else {
        const next = path.indexOf(".", i);
        const seg = next < 0 ? path.slice(i) : path.slice(i, next);
        if (seg) segments.push(seg);
        i = next < 0 ? path.length : next + 1;
      }
    }
    let node: Record<string, unknown> | unknown[] = target;
    for (let s = 0; s < segments.length; s += 1) {
      const seg = segments[s]!;
      const last = s === segments.length - 1;
      if (seg.startsWith("[id=") && seg.endsWith("]")) {
        const wantedId = seg.slice(4, -1);
        const arr = node as unknown[];
        const idx = Array.isArray(arr)
          ? arr.findIndex((row) => {
              const r = row as Record<string, unknown> | null;
              return r != null && String(r.id ?? "") === wantedId;
            })
          : -1;
        if (idx < 0) return;
        if (last) {
          arr[idx] = value;
          return;
        }
        node = arr[idx] as Record<string, unknown>;
        continue;
      }
      const cont = node as Record<string, unknown>;
      if (last) {
        cont[seg] = value;
        return;
      }
      let nxt = cont[seg];
      if (nxt == null || typeof nxt !== "object") {
        nxt = {};
        cont[seg] = nxt;
      }
      node = nxt as Record<string, unknown> | unknown[];
    }
  }

  for (const [path, value] of Object.entries(patch)) {
    setDeep(cur, path, value);
  }

  /**
   * SAFE write: `set(..., { merge: true })` — only the keys we modified are persisted. We never
   * touch likes/comments subcollections. We never delete fields. We never modify
   * postCanonicalBackups. We never replace originalUrl.
   */
  await docRef.set(cur, { merge: true });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flags = parseFlags(argv);

  const onProd =
    !String(process.env.FIRESTORE_EMULATOR_HOST ?? "").trim() &&
    String(process.env.FIRESTORE_SOURCE_ENABLED ?? "").trim().toLowerCase() === "true";

  if (flags.apply && onProd) {
    const confirm = String(process.env.AUDIT_PROD_APPLY_CONFIRM ?? "").trim();
    if (confirm !== "I_HAVE_REVIEWED_DRY_RUN") {
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify(
          {
            error:
              "production_apply_requires_confirmation:set_AUDIT_PROD_APPLY_CONFIRM=I_HAVE_REVIEWED_DRY_RUN_after_reviewing_dry_run_output",
          },
          null,
          2,
        ),
      );
      process.exit(2);
    }
  }

  const posts = await fetchPosts({
    postIds: flags.postIds,
    limit: flags.limit,
    collection: flags.collection,
  });

  const findings: AuditFinding[] = [];
  for (const p of posts) {
    const audit = classifyPostForAudit(p.raw);
    const pending = checkPostContractV2(p.raw, "instantPending");
    const ready = checkPostContractV2(p.raw, "completedReady");
    const repairs = computeSafeRepairs(p.raw);
    let appliedRepairs: string[] = [];
    if (flags.apply && repairs.labels.length > 0) {
      try {
        await applySafeRepair(p.postId, repairs.patch, flags.collection);
        appliedRepairs = [...repairs.labels];
      } catch (err) {
        appliedRepairs = [
          `apply_failed:${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
        ];
      }
    }
    findings.push({
      postId: p.postId,
      classification: audit.classification,
      pendingOk: pending.ok,
      readyOk: ready.ok,
      pendingErrorCount: pending.errors.length,
      readyErrorCount: ready.errors.length,
      hints: audit.hints,
      topPendingErrors: pending.errors.slice(0, 5).map((e) => e.code),
      topReadyErrors: ready.errors.slice(0, 5).map((e) => e.code),
      proposedRepairs: repairs.labels,
      appliedRepairs,
    });
  }

  const summary = summarize(findings);

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        meta: {
          mode: flags.apply ? "apply" : "dry-run",
          postCount: findings.length,
          collection: flags.collection,
          summary,
          executedAt: new Date().toISOString(),
        },
        findings,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`audit_failed: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
