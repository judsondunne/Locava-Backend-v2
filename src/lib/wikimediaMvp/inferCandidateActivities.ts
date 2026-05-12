import type { WikimediaMvpNormalizedAsset, WikimediaMvpSeedPlace } from "./WikimediaMvpTypes.js";

type Rule = { activity: string; re: RegExp; reason: string };

const RULES: Rule[] = [
  { activity: "waterfall", re: /\b(waterfall|falls|cascade)\b/i, reason: "water feature keyword" },
  { activity: "hiking", re: /\b(hike|hiking|trail|trek)\b/i, reason: "trail keyword" },
  { activity: "walking", re: /\b(walk|walking|boardwalk|promenade)\b/i, reason: "walking keyword" },
  { activity: "biking", re: /\b(bike|biking|cycling)\b/i, reason: "cycling keyword" },
  { activity: "skiing", re: /\b(skiing|snowboard|ski resort|ski area)\b/i, reason: "winter sport keyword" },
  { activity: "kayaking", re: /\b(kayak|canoe|paddle|paddling)\b/i, reason: "paddle keyword" },
  { activity: "swimming", re: /\b(swim|swimming|beach)\b/i, reason: "swim/beach keyword" },
  { activity: "view", re: /\b(overlook|vista|viewpoint|scenic view)\b/i, reason: "view keyword" },
  { activity: "nationalpark", re: /\b(national park|state park)\b/i, reason: "park keyword" },
  { activity: "mountain", re: /\b(mountain|summit|peak|ridgeline)\b/i, reason: "mountain keyword" },
];

function normalizeCorpus(s: string): string {
  return s
    .toLowerCase()
    .replace(/file:/gi, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function inferCandidateActivities(input: {
  place: WikimediaMvpSeedPlace;
  asset: WikimediaMvpNormalizedAsset;
}): { activities: string[]; reasoning: string[]; uncertainty: string | null } {
  const placeCorpus = normalizeCorpus(`${input.place.placeName} ${input.place.searchQuery}`);
  const assetCorpus = normalizeCorpus(
    `${input.asset.title} ${input.asset.categories.join(" ")} ${input.asset.descriptionText ?? ""}`,
  );
  const scores = new Map<string, { score: number; reasons: string[] }>();

  for (const rule of RULES) {
    let score = 0;
    const reasons: string[] = [];
    if (rule.re.test(placeCorpus)) {
      score += 2;
      reasons.push(`place ${rule.reason}`);
    }
    if (rule.re.test(assetCorpus)) {
      score += 3;
      reasons.push(`asset ${rule.reason}`);
    }
    if (score > 0) {
      const prev = scores.get(rule.activity) ?? { score: 0, reasons: [] };
      scores.set(rule.activity, { score: prev.score + score, reasons: [...prev.reasons, ...reasons] });
    }
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
  const activities = ranked.slice(0, 3).map(([activity]) => activity);
  const reasoning = ranked.flatMap(([, v]) => v.reasons).slice(0, 8);

  if (activities.length === 0) {
    if (Array.isArray(input.place.themes) && input.place.themes.length > 0) {
      return {
        activities: input.place.themes.slice(0, 2).map((t) => String(t).trim()).filter(Boolean),
        reasoning: ["fallback to place themes"],
        uncertainty: "No strong activity keyword match; used catalog themes",
      };
    }
    return {
      activities: ["walking", "view"],
      reasoning: ["default outdoor fallback"],
      uncertainty: "No strong activity keyword match; used walking/view fallback",
    };
  }

  return { activities, reasoning, uncertainty: ranked.length > 1 && ranked[0]![1].score <= 3 ? "Weak activity signal" : null };
}
