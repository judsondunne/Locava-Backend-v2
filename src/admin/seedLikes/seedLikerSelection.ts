export function pickRandomTarget(min: number, max: number, rng: () => number = Math.random): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (hi <= lo) {
    return lo;
  }
  return lo + Math.floor(rng() * (hi - lo + 1));
}

export type SeedLikerTargetSelection = {
  configuredTargetMin: number;
  configuredTargetMax: number;
  rawSeedLikerCount: number;
  availableSeedLikerCount: number;
  excludedAuthorCount: number;
  excludedExistingLikeCount: number;
  desiredTargetBeforeClamp: number;
  targetAfterAvailableClamp: number;
  targetLikeCount: number;
  clampedBelowTargetMin: boolean;
  clampReason: string | null;
  blockedBelowTargetMin: boolean;
  skippedNoAvailable: boolean;
  selectedUserIds: string[];
};

export function selectSeedLikersForPost(input: {
  seedLikerIds: readonly string[];
  existingLikerIds: ReadonlySet<string>;
  authorUserId: string | null;
  currentLikeCount: number;
  targetMin: number;
  targetMax: number;
  allowTargetBelowMin: boolean;
  rng?: () => number;
}): SeedLikerTargetSelection {
  const rng = input.rng ?? Math.random;
  const rawSeedLikerCount = input.seedLikerIds.filter(Boolean).length;
  let excludedAuthorCount = 0;
  let excludedExistingLikeCount = 0;
  const available: string[] = [];

  for (const userId of input.seedLikerIds) {
    if (!userId) continue;
    if (input.authorUserId && userId === input.authorUserId) {
      excludedAuthorCount += 1;
      continue;
    }
    if (input.existingLikerIds.has(userId)) {
      excludedExistingLikeCount += 1;
      continue;
    }
    available.push(userId);
  }

  const base = {
    configuredTargetMin: input.targetMin,
    configuredTargetMax: input.targetMax,
    rawSeedLikerCount,
    availableSeedLikerCount: available.length,
    excludedAuthorCount,
    excludedExistingLikeCount,
    desiredTargetBeforeClamp: input.currentLikeCount,
    targetAfterAvailableClamp: input.currentLikeCount,
    targetLikeCount: input.currentLikeCount,
    clampedBelowTargetMin: false,
    clampReason: null as string | null,
    blockedBelowTargetMin: false,
    skippedNoAvailable: false,
    selectedUserIds: [] as string[]
  };

  if (available.length === 0) {
    return {
      ...base,
      skippedNoAvailable: true,
      clampReason: "No seed likers remain after excluding the post author and existing seed likes."
    };
  }

  const desiredTargetBeforeClamp = pickRandomTarget(input.targetMin, input.targetMax, rng);
  const maxAchievableTarget = input.currentLikeCount + available.length;
  const targetAfterAvailableClamp = Math.min(desiredTargetBeforeClamp, maxAchievableTarget);
  const needed = Math.max(0, targetAfterAvailableClamp - input.currentLikeCount);
  const clampedBelowTargetMin = targetAfterAvailableClamp < input.targetMin;
  const clampReason = clampedBelowTargetMin
    ? `Only ${available.length} seed likers are available after filtering, so the achievable target ${targetAfterAvailableClamp} is below configured targetMin ${input.targetMin}.`
    : null;
  const blockedBelowTargetMin =
    !input.allowTargetBelowMin &&
    (available.length < input.targetMin || targetAfterAvailableClamp < input.targetMin);

  if (blockedBelowTargetMin) {
    return {
      ...base,
      desiredTargetBeforeClamp,
      targetAfterAvailableClamp,
      targetLikeCount: input.currentLikeCount,
      clampedBelowTargetMin,
      clampReason,
      blockedBelowTargetMin: true
    };
  }

  if (needed === 0) {
    return {
      ...base,
      desiredTargetBeforeClamp,
      targetAfterAvailableClamp,
      targetLikeCount: input.currentLikeCount
    };
  }

  const shuffled = [...available];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }

  const selectedUserIds = shuffled.slice(0, needed);
  return {
    ...base,
    desiredTargetBeforeClamp,
    targetAfterAvailableClamp,
    targetLikeCount: input.currentLikeCount + selectedUserIds.length,
    clampedBelowTargetMin,
    clampReason,
    selectedUserIds
  };
}
