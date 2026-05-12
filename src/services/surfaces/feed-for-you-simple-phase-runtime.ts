import type {
  FeedForYouSimpleRepository,
  SimpleFeedCandidate,
  SimpleFeedSortMode
} from "../../repositories/surfaces/feed-for-you-simple.repository.js";
import {
  FOR_YOU_SIMPLE_SERVE_PHASES,
  type ForYouSimpleCursorV3,
  type ForYouSimplePhaseCursorState,
  type ForYouSimpleServePhase,
  nextServePhase
} from "./feed-for-you-simple-cursor.js";
import { candidateMatchesServePhase } from "./feed-for-you-simple-tier.js";

export const FOR_YOU_SIMPLE_DECK_FORMAT = 7;
export const FOR_YOU_SIMPLE_PHASE_DECK_TARGET = 12;

export type PhaseReadyDeckEntry = {
  generation: number;
  updatedAtMs: number;
  refillReason: string | null;
  items: SimpleFeedCandidate[];
  refillInFlight: Promise<void> | null;
  lastSummary: Record<string, unknown> | null;
  deckFormat: number;
  phase: ForYouSimpleServePhase;
};

export function phaseDeckMemoryKey(baseDeckKey: string, phase: ForYouSimpleServePhase): string {
  return `${baseDeckKey}::${phase}`;
}

export async function scanServePhase(input: {
  repository: Pick<FeedForYouSimpleRepository, "fetchServePhaseBatch">;
  phase: ForYouSimpleServePhase;
  mode: SimpleFeedSortMode;
  phaseState: ForYouSimplePhaseCursorState;
  limit: number;
  tryGate: (candidate: SimpleFeedCandidate) => boolean;
  items: SimpleFeedCandidate[];
  sessionSeen: Set<string>;
  maxReads: number;
  maxAttempts: number;
}): Promise<{
  phaseState: ForYouSimplePhaseCursorState;
  readCount: number;
  rawTotal: number;
  acceptedDelta: number;
  exhausted: boolean;
  attempts: number;
  indexFallbackUsed: boolean;
}> {
  let state = { ...input.phaseState };
  let readCount = 0;
  let rawTotal = 0;
  let acceptedDelta = 0;
  let attempts = 0;
  let indexFallbackUsed = false;
  const batchSize = 8;

  while (input.items.length < input.limit && readCount < input.maxReads && attempts < input.maxAttempts) {
    const beforeLen = input.items.length;
    const batch = await input.repository.fetchServePhaseBatch({
      phase: input.phase,
      mode: input.mode,
      anchor: state.anchor,
      wrapped: state.wrapped,
      lastValue: state.lastValue,
      lastPostId: state.lastPostId,
      limit: batchSize
    });
    attempts += 1;
    readCount += batch.readCount;
    rawTotal += batch.stats.rawDocCount;
    indexFallbackUsed = indexFallbackUsed || batch.indexFallbackUsed;

    for (const candidate of batch.items) {
      if (input.items.length >= input.limit) break;
      if (!candidateMatchesServePhase(candidate, input.phase)) continue;
      if (!input.tryGate(candidate)) continue;
      input.sessionSeen.add(candidate.postId);
      input.items.push(candidate);
      acceptedDelta += 1;
    }

    if (batch.tailDocId) {
      if (input.phase === "reel_tier_5" || input.phase === "reel_tier_4") {
        state.lastValue = candidateTimeFromBatch(batch) ?? state.lastValue;
        state.lastPostId = batch.tailDocId;
      } else if (typeof batch.tailRandomKey === "number" && Number.isFinite(batch.tailRandomKey)) {
        state.lastValue = batch.tailRandomKey;
        state.lastPostId = batch.tailDocId;
      } else {
        state.lastValue = batch.tailDocId;
        state.lastPostId = batch.tailDocId;
      }
    }

    if (input.items.length >= input.limit) break;

    const acceptedThisRound = input.items.length - beforeLen;
    if (acceptedThisRound === 0 && batch.rawCount > 0) {
      continue;
    }

    if (batch.segmentExhausted || batch.rawCount === 0) {
      if (!state.wrapped) {
        state.wrapped = true;
        state.lastValue = null;
        state.lastPostId = null;
        continue;
      }
      state.exhausted = acceptedDelta === 0;
      break;
    }
  }

  if (!state.exhausted && readCount >= input.maxReads) {
    state.exhausted = false;
  }
  if (!state.exhausted && attempts >= input.maxAttempts) {
    state.exhausted = false;
  }

  return { phaseState: state, readCount, rawTotal, acceptedDelta, exhausted: state.exhausted, attempts, indexFallbackUsed };
}

function candidateTimeFromBatch(batch: { items: SimpleFeedCandidate[]; tailDocId: string | null }): number | string | null {
  const tail = batch.items.find((item) => item.postId === batch.tailDocId);
  return tail?.createdAtMs ?? null;
}

export function advanceCursorAfterServe(
  cursor: ForYouSimpleCursorV3,
  returnedIds: string[],
  servedPhase: ForYouSimpleServePhase
): ForYouSimpleCursorV3 {
  const seen = [...new Set([...cursor.seen, ...returnedIds])].slice(-200);
  let activePhase = cursor.activePhase;
  const phases = { ...cursor.phases };
  if (phases[servedPhase]?.exhausted) {
    const next = nextServePhase(servedPhase);
    if (next) activePhase = next;
  }
  return {
    ...cursor,
    activePhase,
    phases,
    seen,
    continuationSeq: returnedIds.length > 0 ? 0 : cursor.continuationSeq + 1
  };
}

export function firstUnexhaustedPhase(cursor: ForYouSimpleCursorV3): ForYouSimpleServePhase {
  for (const phase of FOR_YOU_SIMPLE_SERVE_PHASES) {
    if (!cursor.phases[phase].exhausted) return phase;
  }
  return "fallback_normal";
}
