import type { AppPostV2 } from "../../../contracts/app-post-v2.contract.js";
import type { PostEngagementSourceAuditV2 } from "../../../contracts/master-post-v2.types.js";
import { isBackendAppPostV2ResponsesEnabled } from "./flags.js";
import { hydrateAppPostsViewerState } from "./hydrateAppPostViewerState.js";
import { toAppPostV2FromAny } from "./toAppPostV2.js";

export type AttachAppPostV2Opts = {
  postId?: string;
  engagementSourceAudit?: PostEngagementSourceAuditV2 | null;
  viewerStatePartial?: Partial<AppPostV2["viewerState"]>;
};

export function attachAppPostV2ToRecord(
  target: Record<string, unknown>,
  rawPost: Record<string, unknown> | null | undefined,
  opts: AttachAppPostV2Opts = {}
): AppPostV2 | null {
  if (!isBackendAppPostV2ResponsesEnabled()) return null;
  if (!rawPost || typeof rawPost !== "object") return null;
  const postId =
    opts.postId ??
    (typeof rawPost.postId === "string" && rawPost.postId.trim()
      ? rawPost.postId.trim()
      : typeof rawPost.id === "string" && rawPost.id.trim()
        ? rawPost.id.trim()
        : undefined);
  try {
    const appPost = toAppPostV2FromAny(rawPost, {
      postId,
      viewerState: {
        liked: opts.viewerStatePartial?.liked ?? false,
        saved: opts.viewerStatePartial?.saved ?? false,
        savedCollectionIds: opts.viewerStatePartial?.savedCollectionIds ?? [],
        followsAuthor: opts.viewerStatePartial?.followsAuthor ?? false
      },
      engagementSourceAudit: opts.engagementSourceAudit ?? null
    });
    target.appPost = appPost as unknown as Record<string, unknown>;
    target.postContractVersion = 2;
    return appPost;
  } catch {
    return null;
  }
}

/**
 * Batch-merge viewer edges into records that already have `appPost` attached.
 * Keeps array order; skips rows without `appPost`.
 *
 * Read budget: delegated to {@link hydrateAppPostsViewerState} (collections list + chunked likes + follow probes).
 */
export async function batchHydrateAppPostsOnRecords(
  records: Array<Record<string, unknown>>,
  viewerId: string | null | undefined,
  options?: { collectionsScanLimit?: number }
): Promise<void> {
  const indexed = records
    .map((row, idx) => ({ idx, app: row.appPost as AppPostV2 | undefined }))
    .filter((x): x is { idx: number; app: AppPostV2 } => Boolean(x.app));
  if (indexed.length === 0) return;
  const { posts } = await hydrateAppPostsViewerState(
    indexed.map((x) => x.app),
    { viewerId, collectionsScanLimit: options?.collectionsScanLimit ?? 80 }
  );
  indexed.forEach((x, i) => {
    const merged = posts[i];
    const target = records[x.idx];
    if (merged !== undefined && target) target.appPost = merged as unknown as Record<string, unknown>;
  });
}

export async function enrichGridPreviewItemsWithAppPostV2<T extends Record<string, unknown>>(
  items: T[],
  viewerId: string | null | undefined,
  options?: { collectionsScanLimit?: number }
): Promise<T[]> {
  if (!isBackendAppPostV2ResponsesEnabled() || items.length === 0) return items;
  const copies = items.map((item) => ({ ...item }) as Record<string, unknown>);
  for (const row of copies) {
    const raw = row.rawFirestore as Record<string, unknown> | undefined;
    const postId = typeof row.postId === "string" ? row.postId : "";
    attachAppPostV2ToRecord(row, raw, { postId: postId || undefined });
  }
  await batchHydrateAppPostsOnRecords(copies, viewerId, options);
  return copies as T[];
}

/** Compact search-discovery card row + `appPost` from Firestore-shaped raw (or legacy JSON). */
export function attachAppPostV2ToSearchDiscoveryRow(
  row: {
    postId: string;
    id: string;
    userId: string;
    thumbUrl: string;
    displayPhotoLink: string;
    title: string;
    activities: unknown[];
  },
  sourceRaw: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  attachAppPostV2ToRecord(out, sourceRaw, { postId: row.postId });
  return out;
}

/**
 * Collect post rows from search.bootstrap payloads (`posts` + `rails[].posts`) and batch-hydrate viewer state.
 */
export async function batchHydrateSearchDiscoveryPayload(
  payload: Record<string, unknown>,
  viewerId: string | null | undefined,
  options?: { collectionsScanLimit?: number }
): Promise<void> {
  const rows: Record<string, unknown>[] = [];
  const posts = payload.posts;
  if (Array.isArray(posts)) {
    for (const p of posts) {
      if (p && typeof p === "object") rows.push(p as Record<string, unknown>);
    }
  }
  const rails = payload.rails;
  if (Array.isArray(rails)) {
    for (const r of rails) {
      if (!r || typeof r !== "object") continue;
      const pr = (r as { posts?: unknown }).posts;
      if (Array.isArray(pr)) {
        for (const p of pr) {
          if (p && typeof p === "object") rows.push(p as Record<string, unknown>);
        }
      }
    }
  }
  await batchHydrateAppPostsOnRecords(rows, viewerId, options);
}
