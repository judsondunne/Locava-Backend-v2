export type ViewHintPostSlice = {
  title: string;
  caption: string | null;
  media: { assetTitle?: string; sourceUrl?: string; imageUrl?: string }[];
};

export type DetectedViewHints = {
  /** Heuristic signals from metadata only (not vision). */
  planeLikely: boolean;
  droneLikely: boolean;
  helicopterLikely: boolean;
  matchedKeywords: string[];
};

function norm(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "");
}

function collectMatches(hay: string, pairs: Array<[RegExp, string]>): string[] {
  const out: string[] = [];
  for (const [re, label] of pairs) {
    if (re.test(hay)) out.push(label);
  }
  return out;
}

const PLANE_PATTERNS: Array<[RegExp, string]> = [
  [/airplane\s*window|airplane\s*wing|plane\s*window|aircraft\s*window|from\s+the\s+plane|from\s+an?\s+airplane|passenger\s+flight|commercial\s+flight|airliner|in[-\s]flight\s+photo|flight\s+from|window\s+seat/i, "plane_window_or_flight_phrase"],
  [/\b747\b|\b737\b|\ba380\b|\b777\b|\b787\b/i, "airliner_model_number"],
  [/\bfrom\s+plane\b|\bfrom\s+airplane\b|\bairplane\b.*\b(view|photo|window)\b/i, "from_plane_phrase"],
  [/\bplane\s+view\b|\bflight\s+view\b|\baerial\s+from\s+airliner\b/i, "plane_view_phrase"]
];

const DRONE_PATTERNS: Array<[RegExp, string]> = [
  [/\bdrone\b|\bUAV\b|\bquadcopter\b|\bdji\b|\bphantom\s*\d/i, "drone_keyword"],
  [/\bfrom\s+above\b.*\bdrone\b|\bdrone\s+shot\b/i, "drone_shot_phrase"]
];

const HELI_PATTERNS: Array<[RegExp, string]> = [
  [/\bhelicopter\b|\bheli\s*\-?\s*tour\b|\bchopper\b/i, "helicopter_keyword"]
];

/**
 * Lightweight metadata scan before vision model runs.
 * Does not prove view type — only biases the curator and enables hard plane skips.
 */
export function detectViewHintsFromCandidate(post: ViewHintPostSlice): DetectedViewHints {
  const chunks: string[] = [post.title, post.caption || ""];
  for (const m of post.media || []) {
    chunks.push(m.assetTitle || "", m.sourceUrl || "", m.imageUrl || "");
  }
  const hay = norm(chunks.join(" | "));
  const planeKw = collectMatches(hay, PLANE_PATTERNS);
  const droneKw = collectMatches(hay, DRONE_PATTERNS);
  const heliKw = collectMatches(hay, HELI_PATTERNS);
  const matchedKeywords = [...planeKw, ...droneKw, ...heliKw];
  return {
    planeLikely: planeKw.length > 0,
    droneLikely: droneKw.length > 0 && planeKw.length === 0,
    helicopterLikely: heliKw.length > 0 && planeKw.length === 0,
    matchedKeywords
  };
}
