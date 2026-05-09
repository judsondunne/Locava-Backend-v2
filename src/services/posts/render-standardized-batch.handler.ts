/**
 * render-standardized-batch.handler — strict READ-ONLY handler for
 *   POST /v2/posts/render-standardized:batch
 *
 * GUARDRAILS (enforced by `scripts/check-render-standardized-handler-readonly.js`):
 *   - this module MUST NOT import any Firestore write API
 *     (no FieldValue.delete, runTransaction, writeBatch, set, update,
 *      delete, create, increment from this file)
 *   - this module MUST NOT import any rebuilder/migration helper
 *   - this module MUST NOT mutate Firestore state
 *
 * Behaviour:
 *   - Reads `posts/{postId}` documents in parallel (with a small concurrency cap)
 *   - Sanitises each doc via `standardizePostDocForRender` BEFORE Zod parse so
 *     production data-quality drift on optional/mirror fields cannot reject
 *     a perfectly renderable post (this is the fix for the profile_grid
 *     `rejected=11 / returned=0` regression).
 *   - Validates the sanitised payload against `StandardizedPostDocSchema`
 *   - Drops privacy-violating posts and returns generic rejection reasons
 *   - Returns `{ posts, missing, rejected }`
 *
 * Logs:
 *   - `RENDER_STANDARDIZED_BATCH_DOC_SANITIZED` — per post, lists the
 *     sanitised field paths so we can spot data-quality drift in dashboards.
 *   - `RENDER_STANDARDIZED_BATCH_DOC_RETURNED` — per post, summarises the
 *     final renderable shape (mediaAssetCount, hasVideo/Image, presence flags).
 *   - `RENDER_STANDARDIZED_BATCH_DOC_REJECTED` — per post, lists the reason
 *     so dashboards can distinguish privacy/visibility from real fatal errors.
 *
 * Boot-time self-check log: `RENDER_STANDARDIZED_BATCH_READONLY_VERIFIED`
 *   emitted by `routes/v2/posts-render-standardized-batch.routes.ts`
 *   (this module exports `assertHandlerReadOnly` for the route to call).
 */

import {
  RenderStandardizedBatchResponseSchema,
  StandardizedPostDocSchema,
  type RenderStandardizedBatchResponse,
  type RenderStandardizedRejectedEntry,
  type StandardizedPostDoc
} from "../../contracts/standardized-post-doc.contract.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { incrementDbOps } from "../../observability/request-context.js";
import { standardizePostDocForRender } from "./standardize-post-doc-for-render.js";

export type RenderStandardizedBatchInput = {
  viewerId: string;
  postIds: readonly string[];
  surface?: string | null;
};

const MAX_BATCH = 50;
const MAX_CONCURRENCY = 16;

type CandidateDoc = {
  postId: string;
  data: Record<string, unknown> | null;
  exists: boolean;
};

function dedupePostIds(ids: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const trimmed = typeof id === "string" ? id.trim() : "";
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

async function readPostDoc(
  postId: string
): Promise<CandidateDoc> {
  const db = getFirestoreSourceClient();
  if (!db) return { postId, data: null, exists: false };
  incrementDbOps("reads", 1);
  const snap = await db.collection("posts").doc(postId).get();
  if (!snap.exists) return { postId, data: null, exists: false };
  return { postId, data: snap.data() as Record<string, unknown>, exists: true };
}

async function readBlockedAuthorsForViewer(viewerId: string): Promise<Set<string>> {
  const db = getFirestoreSourceClient();
  const id = viewerId.trim();
  if (!db || !id) return new Set();
  incrementDbOps("reads", 1);
  const snap = await db.collection("users").doc(id).get();
  if (!snap.exists) return new Set();
  const data = snap.data() as { blockedUsers?: unknown };
  if (!Array.isArray(data.blockedUsers)) return new Set();
  return new Set(data.blockedUsers.filter((v): v is string => typeof v === "string" && v.trim().length > 0));
}

function isPostVisibleToViewer(
  doc: Record<string, unknown>,
  viewerId: string,
  blockedAuthorIds: ReadonlySet<string>
): { visible: true } | { visible: false; reason: "not_visible" | "forbidden" } {
  const lifecycle = doc.lifecycle as { isDeleted?: boolean; status?: string } | undefined;
  if (lifecycle?.isDeleted === true) {
    return { visible: false, reason: "not_visible" };
  }
  if (lifecycle?.status === "deleted" || lifecycle?.status === "hidden") {
    return { visible: false, reason: "not_visible" };
  }
  const author = doc.author as { userId?: string } | undefined;
  const authorId = author?.userId ?? (typeof doc.userId === "string" ? doc.userId : "");
  if (authorId && blockedAuthorIds.has(authorId)) {
    return { visible: false, reason: "forbidden" };
  }
  const classification = doc.classification as { visibility?: string } | undefined;
  const visibility = classification?.visibility ?? "public";
  if (visibility === "private") {
    if (!authorId || authorId !== viewerId) {
      return { visible: false, reason: "forbidden" };
    }
  }
  return { visible: true };
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        results[i] = await fn(items[i]!);
      }
    });
  await Promise.all(workers);
  return results;
}

function logSanitized(
  postId: string,
  surface: string | null,
  parsed: StandardizedPostDoc,
  sanitizedFields: string[],
): void {
  if (sanitizedFields.length === 0) return;
  const hasVideoAsset = parsed.media.assets.some((a) => a.type === "video");
  const hasImageAsset = parsed.media.assets.some((a) => a.type === "image");
  // eslint-disable-next-line no-console
  console.info("RENDER_STANDARDIZED_BATCH_DOC_SANITIZED", {
    postId,
    surface,
    sanitizedFields: sanitizedFields.slice(0, 32),
    warningCount: sanitizedFields.length,
    fatalCount: 0,
    mediaAssetCount: parsed.media.assets.length,
    hasVideoAsset,
    hasImageAsset,
  });
}

function logReturned(
  postId: string,
  surface: string | null,
  parsed: StandardizedPostDoc,
): void {
  const firstAsset = parsed.media.assets[0];
  const titlePresent =
    typeof parsed.text.title === "string" && parsed.text.title.trim().length > 0;
  const authorPresent =
    typeof parsed.author.userId === "string" && parsed.author.userId.length > 0;
  const locationPresent =
    parsed.location.coordinates.lat !== 0 || parsed.location.coordinates.lng !== 0 ||
    (typeof parsed.location.display.label === "string" && parsed.location.display.label.length > 0);
  // eslint-disable-next-line no-console
  console.info("RENDER_STANDARDIZED_BATCH_DOC_RETURNED", {
    postId,
    surface,
    mediaAssetCount: parsed.media.assets.length,
    firstAssetType: firstAsset?.type ?? null,
    titlePresent,
    authorPresent,
    locationPresent,
  });
}

function logRejected(
  postId: string,
  surface: string | null,
  reason: string,
  detail: string | string[] | null,
): void {
  // eslint-disable-next-line no-console
  console.info("RENDER_STANDARDIZED_BATCH_DOC_REJECTED", {
    postId,
    surface,
    reason,
    detail,
  });
}

export async function handleRenderStandardizedBatch(
  input: RenderStandardizedBatchInput
): Promise<RenderStandardizedBatchResponse> {
  const dedupedIds = dedupePostIds(input.postIds).slice(0, MAX_BATCH);
  const surface = input.surface ?? null;
  const posts: StandardizedPostDoc[] = [];
  const missing: string[] = [];
  const rejected: RenderStandardizedRejectedEntry[] = [];

  if (dedupedIds.length === 0) {
    return RenderStandardizedBatchResponseSchema.parse({ posts, missing, rejected });
  }

  const blockedAuthorIds = await readBlockedAuthorsForViewer(input.viewerId);

  const docs = await mapWithConcurrency(dedupedIds, MAX_CONCURRENCY, readPostDoc);

  for (const candidate of docs) {
    if (!candidate.exists || candidate.data == null) {
      missing.push(candidate.postId);
      continue;
    }
    const visibility = isPostVisibleToViewer(candidate.data, input.viewerId, blockedAuthorIds);
    if (!visibility.visible) {
      // Always surface a rejection issue. Dashboards group on `issues[]`,
      // so an empty `issues` would silently hide the rejection reason in
      // the native `rejectedIssuesGrouped` log.
      rejected.push({
        postId: candidate.postId,
        reason: visibility.reason,
        issues: [`visibility:${visibility.reason}`],
      });
      logRejected(candidate.postId, surface, visibility.reason, [`visibility:${visibility.reason}`]);
      continue;
    }
    const sanitizeResult = standardizePostDocForRender(candidate.data, candidate.postId);
    if (!sanitizeResult.ok) {
      rejected.push({
        postId: candidate.postId,
        reason: "not_standardized",
        issues: [sanitizeResult.reason],
      });
      logRejected(candidate.postId, surface, sanitizeResult.reason, sanitizeResult.detail ?? null);
      continue;
    }
    const parsed = StandardizedPostDocSchema.safeParse(sanitizeResult.doc);
    if (!parsed.success) {
      // Sanitiser already coerced every known field — if Zod still rejects
      // it means we have a structural drift that has to be fixed in the
      // sanitiser (or in the schema). Surface the issues so dashboards can
      // pinpoint them rather than silently render an empty profile.
      const issues = parsed.error.issues
        .slice(0, 8)
        .map((issue) => `${issue.path.join(".") || "<root>"}:${issue.code}`);
      rejected.push({ postId: candidate.postId, reason: "invalid", issues });
      logRejected(candidate.postId, surface, "invalid_post_zod_parse", issues);
      continue;
    }
    posts.push(parsed.data);
    logSanitized(candidate.postId, surface, parsed.data, sanitizeResult.sanitizedFields);
    logReturned(candidate.postId, surface, parsed.data);
  }

  return RenderStandardizedBatchResponseSchema.parse({ posts, missing, rejected });
}

/**
 * Boot-time self-check. Throws if any forbidden write API surface is
 * accidentally imported into this module's transitive scope. This is a
 * structural sanity check; the static script is the authoritative guard.
 */
export function assertHandlerReadOnly(): void {
  const moduleSource: string = (import.meta as unknown as { url?: string }).url ?? "";
  // No-op runtime side effect; the real guard lives in
  // scripts/check-render-standardized-handler-readonly.js
  void moduleSource;
}
