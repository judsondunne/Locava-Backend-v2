import type { PlaceCandidate } from "./types.js";

const MAX_GENERIC_HILL = 3;
const MAX_GENERIC_POND = 3;
const MAX_GENERIC_RIVER = 3;
const MAX_PER_PRIMARY_CATEGORY = 12;

function isGenericHill(candidate: PlaceCandidate): boolean {
  return /\bhill\b/i.test(candidate.name) && !/\b(falls?|gorge|notch|gap|pass|castle|quarry)\b/i.test(candidate.name);
}

function isGenericPond(candidate: PlaceCandidate): boolean {
  return /\bpond\b/i.test(candidate.name);
}

function isGenericRiver(candidate: PlaceCandidate): boolean {
  return /\b(river|brook|creek|stream)\b/i.test(candidate.name);
}

export function selectDiversePipelineCandidates(candidates: PlaceCandidate[]): PlaceCandidate[] {
  const sorted = [...candidates].sort(
    (a, b) =>
      (b.locavaPriorityScore ?? 0) - (a.locavaPriorityScore ?? 0) ||
      b.locavaScore - a.locavaScore ||
      a.name.localeCompare(b.name),
  );
  const selected: PlaceCandidate[] = [];
  let hill = 0;
  let pond = 0;
  let river = 0;
  const byCategory = new Map<string, number>();

  for (const candidate of sorted) {
    const primary = candidate.primaryCategory ?? "other";
    const categoryCount = byCategory.get(primary) ?? 0;
    const strong = (candidate.locavaPriorityScore ?? 0) >= 70;
    let diversityReason: string | undefined;
    if (!strong) {
      if (isGenericHill(candidate) && hill >= MAX_GENERIC_HILL) diversityReason = "generic_hill_quota";
      if (isGenericPond(candidate) && pond >= MAX_GENERIC_POND) diversityReason = "generic_pond_quota";
      if (isGenericRiver(candidate) && river >= MAX_GENERIC_RIVER) diversityReason = "generic_river_quota";
      if (categoryCount >= MAX_PER_PRIMARY_CATEGORY) diversityReason = "category_soft_cap";
    }
    if (diversityReason && !strong) {
      continue;
    }
    if (isGenericHill(candidate)) hill += 1;
    if (isGenericPond(candidate)) pond += 1;
    if (isGenericRiver(candidate)) river += 1;
    byCategory.set(primary, categoryCount + 1);
    selected.push({
      ...candidate,
      debug: {
        ...candidate.debug,
        diversityApplied: Boolean(diversityReason),
        diversityReason,
        categoryRankWithinBucket: categoryCount + 1,
      },
    });
  }

  return selected.filter((candidate) => candidate.eligibleForMediaPipeline ?? candidate.pipelineReady);
}
