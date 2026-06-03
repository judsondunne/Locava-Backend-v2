const ROAD_ABBREV: Record<string, string> = {
  RD: "Rd",
  ROAD: "Road",
  DR: "Dr",
  DRIVE: "Drive",
  ST: "St",
  STREET: "Street",
  HWY: "Hwy",
  HIGHWAY: "Highway",
  LN: "Ln",
  LANE: "Lane",
  AVE: "Ave",
  AVENUE: "Avenue",
  BLVD: "Blvd",
  CT: "Ct",
  COURT: "Court",
  PL: "Pl",
  PLACE: "Place",
  TRL: "Trl",
  TRAIL: "Trail",
  PKWY: "Pkwy",
  CIR: "Cir",
  LOOP: "Loop",
  WAY: "Way",
  TOWN: "Town",
  LT: "Lt",
};

function isMostlyUppercase(value: string): boolean {
  const letters = value.replace(/[^A-Za-z]/g, "");
  if (letters.length < 3) return false;
  const upper = (value.match(/[A-Z]/g) ?? []).length;
  const lower = (value.match(/[a-z]/g) ?? []).length;
  if (lower === 0) return true;
  return upper / (upper + lower) >= 0.85;
}

function titleCaseToken(token: string): string {
  const upper = token.toUpperCase();
  if (ROAD_ABBREV[upper]) return ROAD_ABBREV[upper]!;
  if (/^\d+[A-Z]?$/.test(token)) return token;
  if (token.length <= 1) return token.toUpperCase();
  return token.slice(0, 1).toUpperCase() + token.slice(1).toLowerCase();
}

/** Humanize ALL-CAPS VTrans / state road names without shouting. */
export function formatOffroadDisplayName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || !isMostlyUppercase(trimmed)) return trimmed;
  return trimmed
    .split(/\s+/)
    .filter(Boolean)
    .map(titleCaseToken)
    .join(" ");
}
