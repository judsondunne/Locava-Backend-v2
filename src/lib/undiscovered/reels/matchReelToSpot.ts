/**
 * Match an AI-extracted place name to one of the uploaded undiscovered spots.
 *
 * A match gives the reel exact coordinates AND a link to its spot, so Aaron's
 * map can pin the reel on the same spot and cross-link them. Pure function over
 * a candidate list (the route supplies candidates from Firestore) — unit-testable.
 */

export type SpotCandidate = {
  id: string;
  collection: "unexploredSpots" | "unexploredRoutes";
  displayName: string;
  lat: number;
  lng: number;
};

export type SpotMatch = {
  candidate: SpotCandidate;
  score: number; // 0..1
};

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/\b(the|trail|loop|falls?|state park|park|gorge|mountain|mtn|pond|lake|brook)\b/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(name: string): Set<string> {
  return new Set(normalizeName(name).split(" ").filter((w) => w.length >= 3));
}

/** Jaccard over significant tokens, with an exact-substring boost. */
export function scoreNameMatch(extracted: string, candidateName: string): number {
  const a = normalizeName(extracted);
  const b = normalizeName(candidateName);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (b.includes(a) || a.includes(b)) return 0.9;
  const ta = tokenSet(extracted);
  const tb = tokenSet(candidateName);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  const jaccard = shared / (ta.size + tb.size - shared);
  return jaccard;
}

export function matchReelToSpot(
  extractedName: string | null,
  candidates: SpotCandidate[],
  opts: { minScore?: number } = {},
): SpotMatch | null {
  if (!extractedName) return null;
  const minScore = opts.minScore ?? 0.5;
  let best: SpotMatch | null = null;
  for (const candidate of candidates) {
    const score = scoreNameMatch(extractedName, candidate.displayName);
    if (score >= minScore && (!best || score > best.score)) {
      best = { candidate, score };
    }
  }
  return best;
}
