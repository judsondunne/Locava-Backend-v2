import { dedupeReasonStrings } from "./dedupeReasonStrings.js";
import {
  detectActualNegativeSignals,
  hasActualCemeterySignal,
  hasActualLowValueSignal,
} from "./placeCandidateActualSignals.js";
import { computeLocavaPriorityScore } from "./placeCandidatePriorityScore.js";
import type { PlaceCandidate } from "./types.js";

export type PlaceCandidatePriorityQueue = "P0" | "P1" | "P2" | "P3";
export type PlaceCandidateRecommendedAction = "RUN_MEDIA_NOW" | "RUN_MEDIA_LATER" | "KEEP_BACKLOG" | "BLOCK";

const P0_DESTINATION_NAME =
  /\b(falls?|gorge|notch|gap|pass|castle|quarry|beach|overlook|viewpoint|scenic view|cave|lighthouse|state park|national park)\b/i;
const GENERIC_HILL = /\bhill\b/i;
const GENERIC_POND = /\bpond\b/i;
const GENERIC_RIVER = /\b(river|brook|creek|stream)\b/i;
const MAJOR_LAKE_NAME = /\b(champlain|winnipesaukee|memphremagog|willoughby|bomoseen|caspian)\b/i;

function labelBlob(candidate: PlaceCandidate): string {
  return [candidate.name, ...(candidate.debug.matchedSourceCategories ?? []), ...(candidate.categories ?? [])]
    .join(" ")
    .toLowerCase();
}

function hasStrongNotability(candidate: PlaceCandidate): boolean {
  return (
    candidate.signals.hasWikipedia ||
    candidate.signals.hasCommonsCategory ||
    Boolean(candidate.signals.hasImageField) ||
    candidate.signals.isTourismLikely ||
    (candidate.mediaSignalScore ?? 0) >= 12
  );
}

function isPlausiblePlace(candidate: PlaceCandidate): boolean {
  if (!candidate.signals.hasCoordinates) return false;
  if (candidate.signals.isTooGeneric) return false;
  const blob = labelBlob(candidate);
  if (P0_DESTINATION_NAME.test(blob) || /\b(lake|pond|mountain|trail|park|river|island|quarry|historic)\b/i.test(blob)) {
    return true;
  }
  return (
    candidate.signals.hasUsefulCategory ||
    candidate.signals.isOutdoorLikely ||
    candidate.signals.isLandmarkLikely ||
    candidate.signals.isTourismLikely ||
    Boolean(candidate.primaryCategory && candidate.primaryCategory !== "other")
  );
}

function shouldBlock(candidate: PlaceCandidate): { blocked: boolean; blockReasons: string[] } {
  const blockReasons: string[] = [];
  if (!candidate.signals.hasCoordinates) blockReasons.push("missing_coordinates");
  if (candidate.candidateTier === "REJECTED") blockReasons.push("rejected_tier");
  if (hasActualCemeterySignal(candidate)) blockReasons.push("actual_type_cemetery");
  const negatives = detectActualNegativeSignals(candidate);
  if (negatives.includes("library")) blockReasons.push("actual_type_library");
  if (negatives.includes("administrative")) blockReasons.push("actual_type_administrative");
  if (negatives.includes("house")) blockReasons.push("actual_type_house");
  if (negatives.includes("memorial") && !candidate.signals.isOutdoorLikely && !hasStrongNotability(candidate)) {
    blockReasons.push("generic_memorial");
  }
  if (candidate.signals.isTooGeneric) blockReasons.push("too_generic_entity");
  return { blocked: blockReasons.length > 0, blockReasons: dedupeReasonStrings(blockReasons) };
}

function assignPriorityQueue(candidate: PlaceCandidate, locavaPriorityScore: number): {
  priorityQueue: PlaceCandidatePriorityQueue;
  priorityReasons: string[];
} {
  const priorityReasons: string[] = [];
  const primary = candidate.primaryCategory;
  const blob = labelBlob(candidate);
  const genericHill = GENERIC_HILL.test(candidate.name) && !P0_DESTINATION_NAME.test(candidate.name);
  const genericPond = GENERIC_POND.test(candidate.name) && !P0_DESTINATION_NAME.test(candidate.name);
  const genericRiver = GENERIC_RIVER.test(candidate.name) && !P0_DESTINATION_NAME.test(candidate.name);

  if (
    primary === "waterfall" ||
    primary === "cave" ||
    primary === "beach" ||
    primary === "viewpoint" ||
    /\b(waterfall|gorge|cave|beach|overlook|viewpoint)\b/i.test(blob) ||
    /\b(notch|gap|pass)\b/i.test(blob)
  ) {
    priorityReasons.push("priority_queue_p0_destination");
    return { priorityQueue: "P0", priorityReasons };
  }

  if (
    primary === "hiking" ||
    /\b(long trail|appalachian trail|continental divide)\b/i.test(blob) ||
    (/\btrail\b/i.test(blob) && hasStrongNotability(candidate))
  ) {
    priorityReasons.push("priority_queue_p0_trail");
    return { priorityQueue: "P0", priorityReasons };
  }

  if (
    (primary === "quarry" && P0_DESTINATION_NAME.test(candidate.name)) ||
    /\b(castle|ruins|lighthouse)\b/i.test(blob) ||
    (primary === "landmark" && hasStrongNotability(candidate))
  ) {
    priorityReasons.push("priority_queue_p0_landmark");
    return { priorityQueue: "P0", priorityReasons };
  }

  if (
    primary === "lake" &&
    (MAJOR_LAKE_NAME.test(candidate.name) || hasStrongNotability(candidate) || locavaPriorityScore >= 55)
  ) {
    priorityReasons.push("priority_queue_p1_major_lake");
    return { priorityQueue: "P1", priorityReasons };
  }

  if (
    primary === "mountain" &&
    (hasStrongNotability(candidate) || P0_DESTINATION_NAME.test(candidate.name) || locavaPriorityScore >= 55)
  ) {
    priorityReasons.push("priority_queue_p1_major_mountain");
    return { priorityQueue: "P1", priorityReasons };
  }

  if (
    (primary === "park" || primary === "nature" || primary === "historic") &&
    (hasStrongNotability(candidate) || candidate.signals.isOutdoorLikely)
  ) {
    priorityReasons.push("priority_queue_p1_park_historic");
    return { priorityQueue: "P1", priorityReasons };
  }

  if (primary === "museum" || primary === "garden" || primary === "public_art") {
    priorityReasons.push("priority_queue_p1_attraction");
    return { priorityQueue: "P1", priorityReasons };
  }

  if (genericHill || genericPond || genericRiver) {
    priorityReasons.push("priority_queue_p3_generic_nature");
    return { priorityQueue: "P3", priorityReasons };
  }

  if (primary === "lake" || primary === "mountain" || primary === "hiking" || primary === "river") {
    priorityReasons.push("priority_queue_p2_named_nature");
    return { priorityQueue: "P2", priorityReasons };
  }

  if (primary === "beach" || primary === "quarry" || primary === "landmark") {
    priorityReasons.push("priority_queue_p2_usable_place");
    return { priorityQueue: "P2", priorityReasons };
  }

  if (hasStrongNotability(candidate) || locavaPriorityScore >= 45) {
    priorityReasons.push("priority_queue_p2_signal_backed");
    return { priorityQueue: "P2", priorityReasons };
  }

  priorityReasons.push("priority_queue_p3_backlog");
  return { priorityQueue: "P3", priorityReasons };
}

function recommendedActionFor(
  blocked: boolean,
  priorityQueue: PlaceCandidatePriorityQueue,
): PlaceCandidateRecommendedAction {
  if (blocked) return "BLOCK";
  if (priorityQueue === "P0") return "RUN_MEDIA_NOW";
  if (priorityQueue === "P1") return "RUN_MEDIA_NOW";
  if (priorityQueue === "P2") return "RUN_MEDIA_LATER";
  return "KEEP_BACKLOG";
}

export function evaluatePlaceCandidateRouting(candidate: PlaceCandidate): {
  locavaPriorityScore: number;
  priorityReasons: string[];
  eligibleForMediaPipeline: boolean;
  blocked: boolean;
  blockReasons: string[];
  priorityQueue: PlaceCandidatePriorityQueue;
  recommendedAction: PlaceCandidateRecommendedAction;
  pipelineReady: boolean;
  pipelineReadyReasons: string[];
  pipelineBlockReasons: string[];
} {
  const priority = computeLocavaPriorityScore(candidate);
  const locavaPriorityScore = priority.score;
  const priorityReasons = dedupeReasonStrings(priority.reasons);
  const { blocked, blockReasons } = shouldBlock(candidate);
  const plausible = isPlausiblePlace(candidate);
  const eligibleForMediaPipeline = !blocked && plausible;
  const { priorityQueue, priorityReasons: queueReasons } = blocked
    ? { priorityQueue: "P3" as const, priorityReasons: [] as string[] }
    : assignPriorityQueue(candidate, locavaPriorityScore);
  const mergedPriorityReasons = dedupeReasonStrings([...priorityReasons, ...queueReasons]);
  const recommendedAction = recommendedActionFor(blocked, priorityQueue);
  const pipelineReadyReasons = eligibleForMediaPipeline
    ? dedupeReasonStrings([
        `priority_${priorityQueue.toLowerCase()}`,
        ...mergedPriorityReasons.filter((reason) => reason.startsWith("priority_queue_")),
      ])
    : [];
  const pipelineBlockReasons = blockReasons;

  return {
    locavaPriorityScore,
    priorityReasons: mergedPriorityReasons,
    eligibleForMediaPipeline,
    blocked,
    blockReasons,
    priorityQueue,
    recommendedAction,
    pipelineReady: eligibleForMediaPipeline,
    pipelineReadyReasons,
    pipelineBlockReasons,
  };
}
