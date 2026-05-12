export type UsStatePlaceConfig = {
  stateName: string;
  stateCode: string;
  wikidataQid: string;
  country: "US";
};

const US_STATE_PLACE_CONFIG: UsStatePlaceConfig[] = [
  { stateName: "Pennsylvania", stateCode: "PA", wikidataQid: "Q1400", country: "US" },
  { stateName: "Vermont", stateCode: "VT", wikidataQid: "Q16551", country: "US" },
  { stateName: "New Hampshire", stateCode: "NH", wikidataQid: "Q759", country: "US" },
  { stateName: "Colorado", stateCode: "CO", wikidataQid: "Q1261", country: "US" },
  { stateName: "California", stateCode: "CA", wikidataQid: "Q99", country: "US" },
  { stateName: "Washington", stateCode: "WA", wikidataQid: "Q1223", country: "US" },
  { stateName: "Arizona", stateCode: "AZ", wikidataQid: "Q816", country: "US" },
  { stateName: "Texas", stateCode: "TX", wikidataQid: "Q1439", country: "US" },
  { stateName: "New York", stateCode: "NY", wikidataQid: "Q1384", country: "US" },
  { stateName: "New Jersey", stateCode: "NJ", wikidataQid: "Q1408", country: "US" },
  { stateName: "Massachusetts", stateCode: "MA", wikidataQid: "Q771", country: "US" },
  { stateName: "Maine", stateCode: "ME", wikidataQid: "Q724", country: "US" },
  { stateName: "Oregon", stateCode: "OR", wikidataQid: "Q824", country: "US" },
  { stateName: "Utah", stateCode: "UT", wikidataQid: "Q829", country: "US" },
];

function normalizeKey(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ");
}

export function resolveUsStatePlaceConfig(input: {
  stateName: string;
  stateCode?: string;
}): UsStatePlaceConfig {
  const nameKey = normalizeKey(input.stateName);
  const codeKey = normalizeKey(input.stateCode || "");
  const byName = US_STATE_PLACE_CONFIG.find((row) => normalizeKey(row.stateName) === nameKey);
  if (byName) return byName;
  const byCode = US_STATE_PLACE_CONFIG.find((row) => normalizeKey(row.stateCode) === codeKey);
  if (byCode) return byCode;
  throw new Error(
    `Unsupported state "${input.stateName}"${input.stateCode ? ` (${input.stateCode})` : ""}. Add its Wikidata state QID to statePlaceCandidateConfig.ts.`,
  );
}

export function listSupportedUsStates(): UsStatePlaceConfig[] {
  return [...US_STATE_PLACE_CONFIG];
}
