import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import { REEL_POOL_COLD_MAX_DOCS } from "../../constants/firestore-read-budgets.js";
import type {
  FeedForYouSimpleRepository,
  SimpleFeedCandidate,
} from "../../repositories/surfaces/feed-for-you-simple.repository.js";

/**
 * `ENABLE_FOR_YOU_REEL_POOL_WARMUP` / startup reel pool scans caused extreme Firestore reads.
 * `pickForYouSimpleReelPoolPage` + `ensureForYouSimpleReelPoolWarm` remain bounded on-demand helpers only;
 * do not wire them back into first-paint paths without bounded-read integration tests.
 */

const POOL_TTL_MS = 120_000;

let reelCandidateCache: { candidates: SimpleFeedCandidate[]; loadedAtMs: number; source: string } | null = null;

export function startForYouSimpleReelPoolWarmup(
  _repository: Pick<FeedForYouSimpleRepository, "fetchReelPoolBootstrap">,
): void {
  /** Intentionally no startup Firestore query — pool fills on first ensure/pick. */
}

async function loadPoolCandidates(
  repository: Pick<FeedForYouSimpleRepository, "fetchReelPoolBootstrap">,
): Promise<SimpleFeedCandidate[]> {
  return dedupeInFlight("for_you_simple:reel_pool_bootstrap:v2", async () => {
    const rows = await repository.fetchReelPoolBootstrap(REEL_POOL_COLD_MAX_DOCS);
    reelCandidateCache = {
      candidates: rows,
      loadedAtMs: Date.now(),
      source: "bounded_reel_pool_v2",
    };
    return rows;
  });
}

export async function ensureForYouSimpleReelPoolWarm(
  repository: Pick<FeedForYouSimpleRepository, "fetchReelPoolBootstrap">,
): Promise<void> {
  if (reelCandidateCache && Date.now() - reelCandidateCache.loadedAtMs < POOL_TTL_MS) {
    return;
  }
  await loadPoolCandidates(repository);
}

export async function pickForYouSimpleReelPoolPage(input: {
  repository: Pick<FeedForYouSimpleRepository, "fetchReelPoolBootstrap">;
  viewerKey: string;
  limit: number;
  exclude: Set<string>;
  blockedAuthors: Set<string>;
  viewerId: string;
  radiusGate: (candidate: SimpleFeedCandidate) => boolean;
}): Promise<{ items: SimpleFeedCandidate[]; poolUsed: boolean }> {
  await ensureForYouSimpleReelPoolWarm(input.repository);
  const pool = reelCandidateCache?.candidates ?? [];
  const items: SimpleFeedCandidate[] = [];
  const usedAuthors = new Set<string>();
  for (const c of pool) {
    if (input.exclude.has(c.postId)) continue;
    if (input.blockedAuthors.has(c.authorId)) continue;
    if (!input.radiusGate(c)) continue;
    if (usedAuthors.has(c.authorId)) continue;
    usedAuthors.add(c.authorId);
    items.push(c);
    if (items.length >= input.limit) break;
  }
  return { items, poolUsed: items.length > 0 };
}

export function resetForYouSimpleReelPoolForTests(): void {
  reelCandidateCache = null;
}
