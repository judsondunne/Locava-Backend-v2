import type {
  FeedForYouSimpleRepository,
  SimpleFeedCandidate
} from "../../repositories/surfaces/feed-for-you-simple.repository.js";
import { canonicalizeFeedCandidate, normalizeFeedPostIdFromCandidate } from "./feed-for-you-simple-ids.js";
import { isForYouSimpleReel } from "./feed-for-you-simple-tier.js";

const REEL_POOL_TTL_MS = 15 * 60 * 1000;
const REEL_POOL_TARGET = 180;

type ReelPoolState = {
  items: SimpleFeedCandidate[];
  loadedAtMs: number;
  inFlight: Promise<void> | null;
};

const reelPool: ReelPoolState = {
  items: [],
  loadedAtMs: 0,
  inFlight: null
};

const viewerPoolOffsets = new Map<string, number>();

export function startForYouSimpleReelPoolWarmup(
  repository: Pick<FeedForYouSimpleRepository, "fetchReelPoolBootstrap">
): void {
  void ensureForYouSimpleReelPoolWarm(repository);
}

export async function ensureForYouSimpleReelPoolWarm(
  repository: Pick<FeedForYouSimpleRepository, "fetchReelPoolBootstrap">
): Promise<void> {
  const now = Date.now();
  if (reelPool.items.length > 0 && now - reelPool.loadedAtMs < REEL_POOL_TTL_MS) return;
  if (reelPool.inFlight) {
    await reelPool.inFlight;
    return;
  }
  reelPool.inFlight = (async () => {
    const items = await repository.fetchReelPoolBootstrap(REEL_POOL_TARGET);
    reelPool.items = items;
    reelPool.loadedAtMs = Date.now();
  })()
    .catch(() => {
      // Best-effort warmup; request paths can still refill from Firestore scans.
    })
    .finally(() => {
      reelPool.inFlight = null;
    });
  await reelPool.inFlight;
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
  if (reelPool.items.length === 0) {
    return { items: [], poolUsed: false };
  }

  const out: SimpleFeedCandidate[] = [];
  const pageSeen = new Set<string>();
  let offset = viewerPoolOffsets.get(input.viewerKey) ?? 0;
  const maxScans = reelPool.items.length * 2;
  let scans = 0;

  while (out.length < input.limit && scans < maxScans) {
    const candidate = reelPool.items[offset % reelPool.items.length];
    offset += 1;
    scans += 1;
    if (!candidate) continue;
    const postId = normalizeFeedPostIdFromCandidate(candidate) ?? candidate.postId;
    if (input.exclude.has(postId) || pageSeen.has(postId)) continue;
    if (input.blockedAuthors.has(candidate.authorId)) continue;
    if (input.viewerId && candidate.authorId === input.viewerId) continue;
    if (!input.radiusGate(candidate)) continue;
    if (!isForYouSimpleReel(candidate)) continue;
    pageSeen.add(postId);
    out.push(canonicalizeFeedCandidate({ ...candidate, postId }));
  }

  if (out.length > 0) {
    viewerPoolOffsets.set(input.viewerKey, offset % reelPool.items.length);
  }

  return { items: out, poolUsed: out.length > 0 };
}

export function resetForYouSimpleReelPoolForTests(): void {
  reelPool.items = [];
  reelPool.loadedAtMs = 0;
  reelPool.inFlight = null;
  viewerPoolOffsets.clear();
}
