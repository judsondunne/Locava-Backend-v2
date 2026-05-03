/**
 * Stable display strings for legend place scope IDs (avoids flashing raw keys like CITY VERMONT_town_of_corinth).
 */

import { normalizeLowerLocationKey, normalizeUpperLocationKey } from "./legend-location-keys.js";

const US_STATE_NAMES: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming"
};

function buildStateLookup(): Map<string, string> {
  const map = new Map<string, string>();
  for (const [abbr, full] of Object.entries(US_STATE_NAMES)) {
    map.set(abbr.toUpperCase(), full);
    map.set(full.toUpperCase().replace(/\s+/g, "_"), full);
  }
  return map;
}

const LEGEND_STATE_LOOKUP = buildStateLookup();

function lookupState(raw: string): string | null {
  const normalized = raw.trim().toUpperCase().replace(/\s+/g, "_");
  return LEGEND_STATE_LOOKUP.get(normalized) ?? null;
}

export function titleCaseWords(raw: string): string {
  const parts = raw.split(/[\s_]+/).filter(Boolean);
  return parts.map((word) => word.slice(0, 1).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
}

/** Pretty line from reverse-geocode fields on the post (must match slug rules used in legend scope IDs). */
export function formatPostAnchorLine(input: { city?: string | null; state?: string | null }): string | null {
  const stateKey = normalizeUpperLocationKey(input.state);
  const cityRaw = typeof input.city === "string" ? input.city.trim() : "";
  const cityKey = cityRaw ? normalizeLowerLocationKey(cityRaw) : "";
  if (!stateKey && !cityKey) return null;
  const statePretty = stateKey ? humanizeLegendPlace("state", stateKey) : "";
  const cityPretty = cityKey ? titleCaseWords(cityKey.replace(/_/g, " ")) : "";
  if (cityPretty && statePretty) return `${cityPretty}, ${statePretty}`;
  if (statePretty) return statePretty;
  if (cityPretty) return cityPretty;
  return null;
}

/**
 * Anchor for hyperlocal legend copy (cell / cellActivity): state-first so titles read
 * “near Pennsylvania” rather than “near City Of Easton, Pennsylvania”. Place-scoped
 * labels still use {@link humanizeLegendPlace} from the scope id.
 */
export function formatLegendAnchorPreferState(input: { city?: string | null; state?: string | null }): string | null {
  const stateKey = normalizeUpperLocationKey(input.state);
  if (stateKey) {
    return humanizeLegendPlace("state", stateKey);
  }
  return formatPostAnchorLine(input);
}

export function humanizeLegendPlace(placeType: string | null, placeId: string | null): string {
  if (!placeId || !placeId.trim()) {
    switch (placeType) {
      case "state":
        return "Your state";
      case "city":
        return "Your town";
      case "country":
        return "Your country";
      case "region":
        return "Your region";
      case "campus":
        return "Your campus";
      default:
        return "Your area";
    }
  }

  const id = placeId.trim();

  if (placeType === "state") {
    const stateFromId = lookupState(id);
    if (stateFromId) return stateFromId;
    return titleCaseWords(id.replace(/_/g, " "));
  }

  if (placeType === "country") {
    const upper = id.toUpperCase();
    if (upper === "US" || upper === "USA") return "United States";
    return titleCaseWords(id.replace(/_/g, " "));
  }

  const townOf = id.match(/^(.+)_town_of_(.+)$/i);
  if (townOf) {
    const stateKey = townOf[1] ?? "";
    const localityRaw = townOf[2] ?? "";
    const stateName = lookupState(stateKey);
    const locality = titleCaseWords(localityRaw.replace(/_/g, " "));
    if (stateName && locality) return `${locality}, ${stateName}`;
  }

  const lastSep = id.lastIndexOf("_");
  if (lastSep > 0) {
    const leftRaw = id.slice(0, lastSep);
    const rightRaw = id.slice(lastSep + 1).replace(/^town_of_/i, "").trim();
    const stateFromLeft = lookupState(leftRaw.replace(/\s+/g, "_"));
    if (stateFromLeft && rightRaw) {
      const locality = titleCaseWords(rightRaw.replace(/_/g, " "));
      return `${locality}, ${stateFromLeft}`;
    }
  }

  const twoLetterPref = /^([A-Za-z]{2})_(.+)$/u.exec(id);
  if (twoLetterPref) {
    const abbr = String(twoLetterPref[1] ?? "").toUpperCase();
    const rest = String(twoLetterPref[2] ?? "").trim();
    const stateName = US_STATE_NAMES[abbr];
    if (stateName && rest && !rest.includes("_")) {
      const locality = titleCaseWords(rest.replace(/_/g, " "));
      return `${locality}, ${stateName}`;
    }
  }

  return titleCaseWords(id.replace(/_/g, " "));
}
