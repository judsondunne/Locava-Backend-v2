import { globalCache } from "../../cache/global-cache.js";
import { setRouteCacheEntry } from "../../cache/route-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import type { CommentsListResponse } from "../../contracts/surfaces/comments-list.contract.js";
import { debugLog, warnOnce } from "../../lib/logging/debug-log.js";
import { recordCacheHit, recordCacheMiss } from "../../observability/request-context.js";
import type { CommentsService } from "../../services/surfaces/comments.service.js";

export class CommentsListOrchestrator {
  constructor(private readonly service: CommentsService) {}

  async run(input: {
    viewerId: string;
    postId: string;
    cursor: string | null;
    limit: number;
  }): Promise<CommentsListResponse> {
    const cursorPart = input.cursor ?? "start";
    const cacheKey = buildCacheKey("list", ["comments-v1", input.viewerId, input.postId, cursorPart, String(input.limit)]);
    const cached = await globalCache.get<CommentsListResponse>(cacheKey);
    if (cached) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();

    const page = await this.service.loadCommentsPage(input);
    const requestKey = `${input.viewerId}:${input.postId}:${cursorPart}:${input.limit}`;

    const isBootstrap = input.cursor == null;
    const latestCommentPreview = isBootstrap
      ? page.items.length > 0
        ? page.items[0] ?? null
        : null
      : undefined;

    const debug = page.sourceDebug
      ? {
          ...page.sourceDebug,
          returnedRows: page.items.length,
          contractMismatch: page.sourceDebug.countHint > 0 && page.items.length === 0
        }
      : undefined;
    const contractMismatch =
      (debug?.countHint ?? page.totalCount) > 0 && page.items.length === 0
        ? ({
            reason: "count_positive_items_empty" as const,
            countHint: debug?.countHint ?? page.totalCount
          })
        : null;

    if (contractMismatch) {
      warnOnce("comments", `COMMENT_CONTRACT_MISMATCH:${input.postId}`, () => ({
        event: "COMMENT_CONTRACT_MISMATCH",
        postId: input.postId,
        viewerIdHash: input.viewerId ? `${input.viewerId.slice(0, 6)}…` : null,
        count: page.totalCount,
        itemsLength: page.items.length,
        cursorIn: input.cursor,
        reason: "count_positive_items_empty",
        debug: debug ?? null
      }));
    } else if (isBootstrap) {
      debugLog("comments", "COMMENT_BOOTSTRAP_READY", () => ({
        postId: input.postId,
        count: page.totalCount,
        itemsLength: page.items.length,
        sourceUsed: debug?.sourceUsed ?? null,
        hasPreview: Boolean(latestCommentPreview),
        previewTextLength:
          latestCommentPreview?.text != null ? latestCommentPreview.text.length : 0
      }));
    }

    if (debug && input.postId === "0qcjjsO0IZNXBxLp1qkZ") {
      debugLog("comments", "COMMENT_E2E_TRACE", () => ({
        postId: input.postId,
        rawEmbeddedCommentsLen: debug.embeddedCount,
        rawCommentsPreviewLen: debug.previewCount,
        rawEngagementPreviewRecentCommentsLen: debug.engagementPreviewCount,
        rawTopLevelCommentCount: debug.rawTopLevelCommentCount,
        rawTopLevelCommentsCount: debug.rawTopLevelCommentsCount,
        rawEngagementCommentCount: debug.rawEngagementCommentCount,
        subcollectionCommentCount: debug.subcollectionCount,
        backendRows: page.items.length,
        backendCount: page.totalCount,
        nativeSheetRows: null,
        buttonCount: debug.countHint,
        mismatchStage: debug.contractMismatch ? "backend_rows_empty" : "none"
      }));
    }

    const response: CommentsListResponse = {
      routeName: "comments.list.get",
      requestKey,
      page: {
        cursorIn: input.cursor,
        limit: input.limit,
        count: page.totalCount,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
        sort: "created_desc"
      },
      items: page.items,
      ...(latestCommentPreview !== undefined ? { latestCommentPreview } : {}),
      ...(contractMismatch ? { contractMismatch } : {}),
      ...(debug ? { debug } : {}),
      degraded: false,
      fallbacks: []
    };
    await setRouteCacheEntry(cacheKey, response, 6_000, [
      `route:comments.list:${input.viewerId}:${input.postId}`,
      `route:comments.list:${input.viewerId}`
    ]);
    return response;
  }
}
