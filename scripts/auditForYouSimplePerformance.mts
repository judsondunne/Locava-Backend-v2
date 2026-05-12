/**
 * READ-ONLY audit harness for /v2/feed/for-you/simple.
 * Does not write to Firestore; uses READ_ONLY_LATENCY_AUDIT to block deferred writes.
 */
import {
  decodeForYouSimpleCursor,
  type ForYouSimpleServePhase
} from "../src/services/surfaces/feed-for-you-simple-cursor.js";
import { isForYouSimpleReel, resolveModeratorTierFromCandidate } from "../src/services/surfaces/feed-for-you-simple-tier.js";
import { FeedForYouSimpleRepository } from "../src/repositories/surfaces/feed-for-you-simple.repository.js";
import { FeedForYouSimpleService } from "../src/services/surfaces/feed-for-you-simple.service.js";
import {
  deckKeyForServingMode,
  resolveForYouSimpleServingMode
} from "../src/services/surfaces/feed-for-you-simple-serving-mode.js";

process.env.READ_ONLY_LATENCY_AUDIT = "1";

type CliArgs = {
  viewerId: string;
  pages: number;
  limit: number;
  mode: "home" | "radius";
  centerLat: number | null;
  centerLng: number | null;
  radiusMiles: number | null;
  assertReelsBeforeFallback: boolean;
  assertNoDuplicates: boolean;
  assertAuthorSpread: boolean;
  assertAllPostsMode: boolean;
};

function readCliArg(name: string): string | null {
  const prefixed = process.argv.find((entry) => entry.startsWith(`--${name}=`));
  if (prefixed) return prefixed.slice(`--${name}=`.length);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1] ?? null;
  return null;
}

function readCliArgs(): CliArgs {
  const mode = readCliArg("mode") === "radius" ? "radius" : "home";
  const centerLatRaw = readCliArg("centerLat");
  const centerLngRaw = readCliArg("centerLng");
  const radiusMilesRaw = readCliArg("radiusMiles");
  return {
    viewerId: readCliArg("viewerId") ?? "audit_viewer",
    pages: Math.max(1, Number(readCliArg("pages") ?? "40")),
    limit: Math.max(1, Number(readCliArg("limit") ?? "5")),
    mode,
    centerLat: centerLatRaw ? Number(centerLatRaw) : null,
    centerLng: centerLngRaw ? Number(centerLngRaw) : null,
    radiusMiles: radiusMilesRaw ? Number(radiusMilesRaw) : null,
    assertReelsBeforeFallback: (readCliArg("assertReelsBeforeFallback") ?? "false") === "true",
    assertNoDuplicates: (readCliArg("assertNoDuplicates") ?? "false") === "true",
    assertAuthorSpread: (readCliArg("assertAuthorSpread") ?? "false") === "true",
    assertAllPostsMode: (readCliArg("assertAllPostsMode") ?? "false") === "true"
  };
}

function tierLabel(post: { reel?: boolean; moderatorTier?: number | null; rawFirestore?: Record<string, unknown> }): string {
  if (!isForYouSimpleReel(post as never)) return "non_reel";
  const tier = resolveModeratorTierFromCandidate(post as never);
  if (tier === 5) return "tier_5";
  if (tier === 4) return "tier_4";
  return "other";
}

async function probeInventory(repository: FeedForYouSimpleRepository): Promise<void> {
  const mode = await repository.resolveSortMode();
  const phases: ForYouSimpleServePhase[] = ["reel_tier_5", "reel_tier_4", "reel_other"];
  for (const phase of phases) {
    const batch = await repository.fetchServePhaseBatch({
      phase,
      mode,
      anchor: mode === "randomKey" ? Math.random() : "inventory_probe",
      wrapped: false,
      lastValue: null,
      lastPostId: null,
      limit: 40
    });
    const authorCounts = new Map<string, number>();
    for (const item of batch.items) {
      authorCounts.set(item.authorId, (authorCounts.get(item.authorId) ?? 0) + 1);
    }
    const topAuthors = [...authorCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([authorId, count]) => ({ authorId, count }));
    const ids = batch.items.map((item) => item.postId).slice(0, 20);
    console.log(
      JSON.stringify({
        event: "audit_for_you_simple_inventory_probe",
        phase,
        candidateCount: batch.items.length,
        sampleIds: ids,
        topAuthors
      })
    );
  }
}

async function probeRadiusInventory(
  repository: FeedForYouSimpleRepository,
  input: { centerLat: number; centerLng: number; radiusMiles: number }
): Promise<number> {
  const probe = await repository.probeRecentPlayablePostsWithinRadius({
    centerLat: input.centerLat,
    centerLng: input.centerLng,
    radiusMiles: input.radiusMiles,
    maxDocs: 80
  });
  console.log(
    JSON.stringify({
      event: "audit_for_you_simple_radius_inventory_probe",
      candidateCount: probe.items.length,
      sampleIds: probe.items.map((item) => item.postId).slice(0, 20),
      shapeCounts: probe.shapeCounts
    })
  );
  return probe.items.length;
}

async function main(): Promise<void> {
  const args = readCliArgs();
  const repository = new FeedForYouSimpleRepository();
  if (!repository.isEnabled()) {
    console.error("audit_for_you_simple_performance: firestore source unavailable");
    process.exit(1);
  }
  const radiusFilter =
    args.mode === "radius" &&
    args.centerLat != null &&
    Number.isFinite(args.centerLat) &&
    args.centerLng != null &&
    Number.isFinite(args.centerLng) &&
    args.radiusMiles != null &&
    Number.isFinite(args.radiusMiles)
      ? {
          mode: "nearMe" as const,
          centerLat: args.centerLat,
          centerLng: args.centerLng,
          radiusMiles: args.radiusMiles
        }
      : null;
  const servingMode = resolveForYouSimpleServingMode({
    radiusFilter: radiusFilter ?? { mode: "global", centerLat: null, centerLng: null, radiusMiles: null }
  });
  const deckKey = deckKeyForServingMode(
    args.viewerId,
    servingMode,
    radiusFilter ?? { mode: "global", centerLat: null, centerLng: null, radiusMiles: null }
  );
  let radiusInventoryCount = 0;
  if (radiusFilter) {
    radiusInventoryCount = await probeRadiusInventory(repository, radiusFilter);
  } else {
    await probeInventory(repository);
  }

  const service = new FeedForYouSimpleService(repository);
  let cursor: string | null = null;
  let reelPagesBeforeFallback = 0;
  let sawFallback = false;
  let recycleMode = false;
  const seenAcrossPages = new Set<string>();
  let previousAuthorId: string | null = null;
  const violations: string[] = [];

  for (let page = 1; page <= args.pages; page += 1) {
    const started = Date.now();
    const response = await service.getPage({
      viewerId: args.viewerId,
      limit: args.limit,
      cursor,
      radiusFilter: radiusFilter ?? undefined
    });
    const latencyMs = Date.now() - started;
    const decoded = response.nextCursor ? decodeForYouSimpleCursor(response.nextCursor) : null;
    const postIds = response.items.map((row) => row.postId);
    const authorIds = response.items.map((row) => row.authorId).filter(Boolean);
    const reelCount = response.debug.reelReturnedCount ?? 0;
    const nonReelCount = response.debug.returnedNonReelCount ?? Math.max(0, response.items.length - reelCount);
    const phaseStates = response.debug.phaseExhaustedStates ?? null;
    const activePhase = response.debug.activePhase ?? null;
    const fallbackUsed = response.debug.fallbackUsed === true;
    const fallbackAllowed = response.debug.fallbackAllowed === true;
    const duplicateIds = postIds.filter((id, index) => postIds.indexOf(id) !== index);
    const repeatedFromPriorPages = postIds.filter((id) => seenAcrossPages.has(id));
    let sameAuthorAdjacent = 0;
    for (let index = 1; index < authorIds.length; index += 1) {
      if (authorIds[index] === authorIds[index - 1]) sameAuthorAdjacent += 1;
    }
    if (previousAuthorId && authorIds[0] === previousAuthorId) sameAuthorAdjacent += 1;
    const authorPageCounts = new Map<string, number>();
    for (const authorId of authorIds) {
      authorPageCounts.set(authorId, (authorPageCounts.get(authorId) ?? 0) + 1);
    }
    let maxPostsByOneAuthorInPage = 0;
    for (const count of authorPageCounts.values()) {
      maxPostsByOneAuthorInPage = Math.max(maxPostsByOneAuthorInPage, count);
    }

    if (servingMode === "home_reel_first") {
      if (!fallbackAllowed && nonReelCount > 0) violations.push(`page_${page}: non_reel_before_reel_exhaustion`);
      if (activePhase === "fallback_normal" && phaseStates?.reel_tier_5 === false) {
        violations.push(`page_${page}: active_fallback_with_open_reel_tier_5`);
      }
      if (activePhase === "fallback_normal" && phaseStates?.reel_tier_4 === false) {
        violations.push(`page_${page}: active_fallback_with_open_reel_tier_4`);
      }
      if (activePhase === "fallback_normal" && phaseStates?.reel_other === false) {
        violations.push(`page_${page}: active_fallback_with_open_reel_other`);
      }
      if (!fallbackAllowed && fallbackUsed) violations.push(`page_${page}: fallback_used_before_allowed`);
      if (response.exhausted && postIds.length === 0 && !fallbackAllowed) {
        violations.push(`page_${page}: exhausted_true_while_reel_phases_open`);
      }
    }
    if (args.assertNoDuplicates) {
      if (duplicateIds.length > 0) violations.push(`page_${page}: duplicate_within_page`);
      if (!recycleMode && repeatedFromPriorPages.length > 0) {
        violations.push(`page_${page}: repeated_from_prior_pages`);
      }
    }
    if (args.assertAuthorSpread && authorIds.length >= 3) {
      if (sameAuthorAdjacent > 0 && authorPageCounts.size >= 2) {
        violations.push(`page_${page}: same_author_adjacent_with_alternatives`);
      }
      if (maxPostsByOneAuthorInPage > 2 && authorPageCounts.size >= 3) {
        violations.push(`page_${page}: author_dominated_page`);
      }
    }
    if (!response.nextCursor && !response.exhausted && page < args.pages) {
      violations.push(`page_${page}: missing_next_cursor_before_inventory_exhausted`);
    }
    if (args.assertAllPostsMode && servingMode === "radius_all_posts") {
      if (response.nextCursor && decoded?.servingMode !== "radius_all_posts") {
        violations.push(`page_${page}: radius_request_used_non_radius_cursor_mode`);
      }
      if (deckKey.includes("home_reel_first")) {
        violations.push(`page_${page}: radius_request_used_home_deck_key`);
      }
      if (page === 1 && response.items.length === 0 && radiusInventoryCount > 0) {
        violations.push(`page_${page}: radius_inventory_present_but_route_returned_zero`);
      }
    }

    if (!sawFallback && reelCount > 0 && nonReelCount === 0) reelPagesBeforeFallback += 1;
    if (fallbackUsed || nonReelCount > 0) sawFallback = true;
    recycleMode = response.debug.recycleMode === true;
    for (const id of postIds) seenAcrossPages.add(id);
    previousAuthorId = authorIds[authorIds.length - 1] ?? previousAuthorId;

    console.log(
      JSON.stringify({
        event: "audit_for_you_simple_page",
        page,
        servingMode,
        radiusMode: radiusFilter?.mode ?? "global",
        centerLat: radiusFilter?.centerLat ?? null,
        centerLng: radiusFilter?.centerLng ?? null,
        radiusMiles: radiusFilter?.radiusMiles ?? null,
        deckKey,
        deckSource: response.debug.deckSource ?? null,
        returnedCount: response.items.length,
        postIds,
        authorIds,
        reelCount,
        nonReelCount,
        duplicateIds,
        repeatedFromPriorPages,
        sameAuthorAdjacent,
        maxPostsByOneAuthorInPage,
        activePhase,
        phaseExhaustedStates: phaseStates,
        cursorSeenCountBefore: response.debug.cursorSeenBefore,
        cursorSeenCountAfter: response.debug.cursorSeenAfter,
        recentAuthorIds: response.debug.recentAuthorIds ?? decoded?.recentAuthorIds ?? [],
        continuationSeq: response.debug.continuationSeq ?? decoded?.continuationSeq ?? 0,
        nextCursorPresent: Boolean(response.nextCursor),
        exhausted: response.exhausted,
        latencyMs,
        dbReads: response.debug.dbReads,
        queryCount: response.debug.queryCount,
        fallbackUsed,
        recycleMode
      })
    );

    if (!response.nextCursor) break;
    cursor = response.nextCursor;
  }

  if (
    (args.assertReelsBeforeFallback || args.assertNoDuplicates || args.assertAuthorSpread || args.assertAllPostsMode) &&
    violations.length > 0
  ) {
    console.error(JSON.stringify({ event: "audit_for_you_simple_assert_failed", violations, reelPagesBeforeFallback }));
    process.exit(1);
  }

  console.log(
    JSON.stringify({
      event: "audit_for_you_simple_complete",
      reelPagesBeforeFallback,
      sawFallback,
      violationCount: violations.length,
      uniquePostsServed: seenAcrossPages.size
    })
  );
}

void main();
