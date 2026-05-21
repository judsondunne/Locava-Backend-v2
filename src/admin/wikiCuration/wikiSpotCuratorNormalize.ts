import {
  WikiSpotCuratorDecisionRowSchema,
  type WikiSpotCuratorDecisionRow,
  type WikiSpotCuratorSummary
} from "./wikiSpotCurator.schema.js";

export type DecisionParseIssue = { postId?: string; message: string };

/** Coerce invalid ranks (<1) so publish ordering and UI stay stable (models often emit 0 for non-publish rows). */
export function normalizeFinalRanksForCuratorDecisions(decisions: WikiSpotCuratorDecisionRow[]): WikiSpotCuratorDecisionRow[] {
  return decisions.map((d) => {
    const r = d.finalRankForSpot;
    if (typeof r === "number" && Number.isFinite(r) && r >= 1) return d;
    return { ...d, finalRankForSpot: 999 };
  });
}

export function parseDecisionRowLoose(raw: unknown): { ok: true; row: WikiSpotCuratorDecisionRow } | { ok: false; error: string } {
  const r = WikiSpotCuratorDecisionRowSchema.safeParse(raw);
  if (r.success) return { ok: true, row: r.data };
  return { ok: false, error: r.error.message };
}

export function alignDecisionsToCandidates(input: {
  candidateIds: string[];
  rawDecisions: unknown[];
  spotId: string;
  spotName: string;
  maxPostsForSpot: number;
}): { decisions: WikiSpotCuratorDecisionRow[]; issues: DecisionParseIssue[] } {
  const issues: DecisionParseIssue[] = [];
  const byId = new Map<string, WikiSpotCuratorDecisionRow>();

  for (const item of input.rawDecisions) {
    const parsed = parseDecisionRowLoose(item);
    if (!parsed.ok) {
      issues.push({ message: parsed.error });
      continue;
    }
    byId.set(parsed.row.postId, parsed.row);
  }

  const out: WikiSpotCuratorDecisionRow[] = [];
  for (const postId of input.candidateIds) {
    const hit = byId.get(postId);
    if (hit) {
      out.push(hit);
      continue;
    }
    issues.push({ postId, message: "missing_decision_row" });
    out.push({
      postId,
      decision: "needs_review",
      moderatorTier: 3,
      visitWorthyScore: 5,
      visualAppealScore: 5,
      authenticityScore: 5,
      captionQualityScore: 5,
      finalRankForSpot: 999,
      shouldUseInFinalSpotSet: false,
      refinedTitle: input.spotName || "Spot",
      refinedCaption: "",
      reasons: ["Model output did not include this candidate; defaulted to needs_review."],
      concerns: ["missing_decision_row"],
      imageNotes: [],
      viewType: "unknown",
      visualMagnetScore: 5,
      locationRelation: "unclear",
      distanceBucket: "unclear"
    });
  }

  for (const [pid, row] of byId) {
    if (!input.candidateIds.includes(pid)) {
      issues.push({ postId: pid, message: "unknown_post_id_in_model_output" });
      void row;
    }
  }

  return { decisions: out, issues };
}

export function recomputeSummaryWithCaps(input: {
  candidateCount: number;
  decisions: WikiSpotCuratorDecisionRow[];
  overallReasoning: string;
  maxCorePostsPerSpot: number;
  maxContextPostsPerSpot: number;
  maxTotalPostsPerSpot: number;
}): WikiSpotCuratorSummary {
  let recommendedPublishCount = 0;
  let recommendedPublishCoreCount = 0;
  let recommendedPublishContextCount = 0;
  let recommendedSkipCount = 0;
  let recommendedNeedsReviewCount = 0;
  for (const d of input.decisions) {
    if (d.decision === "publish") {
      recommendedPublishCount += 1;
      if (d.selectionLane === "core") recommendedPublishCoreCount += 1;
      else if (d.selectionLane === "context") recommendedPublishContextCount += 1;
    } else if (d.decision === "skip") recommendedSkipCount += 1;
    else recommendedNeedsReviewCount += 1;
  }
  return {
    candidateCount: input.candidateCount,
    recommendedPublishCount,
    recommendedPublishCoreCount,
    recommendedPublishContextCount,
    recommendedSkipCount,
    recommendedNeedsReviewCount,
    overallReasoning: input.overallReasoning,
    maxCorePostsPerSpot: input.maxCorePostsPerSpot,
    maxContextPostsPerSpot: input.maxContextPostsPerSpot,
    maxTotalPostsPerSpot: input.maxTotalPostsPerSpot
  };
}
