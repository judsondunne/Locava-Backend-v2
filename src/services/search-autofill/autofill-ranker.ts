export type RankableSuggestion = {
  text: string;
  type: string;
  suggestionType?: string;
  badge?: string;
  data?: Record<string, unknown>;
  confidence: number;
  coverageScore?: number;
};

export type RankerContext = {
  query: string;
  detectedActivity?: string | null;
  cityName?: string | null;
  stateName?: string | null;
  prefixStem?: string | null;
};

const NEAR_ME_PATTERNS = /near me|nearby|near you/i;
const WITHIN_MILES_PATTERN = /within \d+ miles?/i;
const TIME_VIBE_PATTERNS =
  /tonight|this weekend|weekend|sunset|sunrise|chill|cozy|quick adventure|date night/i;

function hasNearMe(text: string): boolean {
  return NEAR_ME_PATTERNS.test(text);
}

function hasWithinMiles(text: string): boolean {
  return WITHIN_MILES_PATTERN.test(text);
}

function hasInCityOrState(text: string): boolean {
  return / in [A-Za-z]|, [A-Za-z]{2,}/.test(text) || text.includes(", ");
}

function hasTimeOrVibe(text: string): boolean {
  return TIME_VIBE_PATTERNS.test(text);
}

function isEchoLike(text: string, query: string): boolean {
  const q = query.toLowerCase().trim();
  const t = text.toLowerCase().trim();
  if (t === q) return true;
  if (t.startsWith(q) && t.length <= q.length + 3 && !t.includes("near") && !t.includes("within")) {
    return true;
  }
  return false;
}

function scoreOne(s: RankableSuggestion, ctx: RankerContext): number {
  const text = s.text;
  const q = ctx.query.toLowerCase().trim();
  let score = (s.confidence || 0.5) * 10;

  const nearMe = hasNearMe(text);
  const withinMiles = hasWithinMiles(text);
  const cityState = hasInCityOrState(text);
  const timeVibe = hasTimeOrVibe(text);

  if (nearMe) score += 3;
  if (withinMiles) score += 2.5;
  if (cityState && (ctx.cityName || ctx.stateName)) score += 2;
  if (timeVibe) score += 1.5;
  if (ctx.detectedActivity && text.toLowerCase().includes(ctx.detectedActivity.toLowerCase())) score += 2;

  if (typeof s.coverageScore === "number" && s.coverageScore > 0) {
    score += s.coverageScore * 4;
  }

  if (q.length >= 2 && text.toLowerCase().trim().startsWith(q)) {
    score += 4;
  }

  const hasExplicitRelation = /\b(in|near)\s+[a-z0-9\s]+$/i.test(ctx.query);
  if (hasExplicitRelation && s.type === "sentence" && text.toLowerCase().trim().startsWith(q)) {
    // Promote parsed sentence completions when user typed "... in <partial>".
    score += 9;
  }
  if (hasExplicitRelation && (s.type === "state" || s.type === "town")) {
    // Keep plain place rows available, but behind full sentence completions.
    score -= 1.5;
  }

  if (isEchoLike(text, ctx.query) && text.length <= ctx.query.length + 5) {
    score -= 5;
  }

  const stem = ctx.prefixStem;
  if (stem === "places_to" && text.toLowerCase().includes("places to")) score += 1.5;
  if (stem === "hikes" && /hike|hiking|trail/.test(text.toLowerCase())) score += 1.2;

  return score;
}

export function rankAutofillSuggestions(
  suggestions: RankableSuggestion[],
  ctx: RankerContext,
  targetSize = 12,
): RankableSuggestion[] {
  const scored = suggestions.map((s) => ({ s, score: scoreOne(s, ctx) }));
  scored.sort((a, b) => b.score - a.score);
  const out: RankableSuggestion[] = [];
  const seen = new Set<string>();
  for (const { s } of scored) {
    const key = `${String(s.type ?? "")}:${s.text.toLowerCase().trim()}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= targetSize) break;
  }
  return out;
}

