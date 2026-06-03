import {
  US_STATE_BOUNDS,
  getStateBounds,
  listStateCodes,
  listContiguousStateCodes,
  type UsStateBounds,
} from "../../../lib/inventory/offroad/offroadStateBounds.js";

export { US_STATE_BOUNDS, getStateBounds, listStateCodes, listContiguousStateCodes, type UsStateBounds };

export type OsmNationalRegionPreset =
  | "ALL"
  | "CONTIGUOUS"
  | "NEW_ENGLAND"
  | "NORTHEAST"
  | "SOUTHEAST"
  | "MIDWEST"
  | "SOUTH"
  | "WEST"
  | "MOUNTAIN"
  | "PACIFIC";

const NEW_ENGLAND = ["CT", "ME", "MA", "NH", "RI", "VT"] as const;
const NORTHEAST = [...NEW_ENGLAND, "NY", "NJ", "PA", "DE", "MD", "DC"] as const;
const SOUTHEAST = ["VA", "WV", "NC", "SC", "GA", "FL", "AL", "MS", "TN", "KY", "LA", "AR"] as const;
const MIDWEST = ["OH", "IN", "IL", "MI", "WI", "MN", "IA", "MO", "ND", "SD", "NE", "KS"] as const;
const SOUTH = ["TX", "OK", "LA", "AR", "MS", "AL", "TN", "KY", "GA", "FL", "SC", "NC"] as const;
const MOUNTAIN = ["MT", "ID", "WY", "CO", "UT", "NV", "AZ", "NM"] as const;
const PACIFIC = ["CA", "OR", "WA", "HI", "AK"] as const;
const WEST = [...MOUNTAIN, "CA", "OR", "WA", "HI", "AK"] as const;

export const OSM_NATIONAL_REGION_PRESETS: Record<OsmNationalRegionPreset, readonly string[]> = {
  ALL: listStateCodes(),
  CONTIGUOUS: listContiguousStateCodes(),
  NEW_ENGLAND,
  NORTHEAST,
  SOUTHEAST,
  MIDWEST,
  SOUTH,
  WEST,
  MOUNTAIN,
  PACIFIC,
};

export function resolveStatesFromPreset(
  preset: OsmNationalRegionPreset,
  includeDc = true
): string[] {
  const codes = [...OSM_NATIONAL_REGION_PRESETS[preset]];
  if (!includeDc) {
    return codes.filter((c) => c !== "DC");
  }
  return codes;
}

export function resolveSelectedStates(input: {
  states?: string[];
  regionPreset?: OsmNationalRegionPreset;
  includeDc?: boolean;
}): string[] {
  if (input.states && input.states.length > 0) {
    return [...new Set(input.states.map((s) => s.toUpperCase()))];
  }
  if (input.regionPreset) {
    return resolveStatesFromPreset(input.regionPreset, input.includeDc ?? true);
  }
  return resolveStatesFromPreset("CONTIGUOUS", input.includeDc ?? true);
}

export function getDenseStateChunkSizeKm(stateCode: string, defaultKm: number): number {
  const dense = new Set(["NJ", "CT", "RI", "MA", "DC", "MD", "DE", "CA", "NY", "PA", "OH", "IL", "FL"]);
  return dense.has(stateCode.toUpperCase()) ? Math.min(defaultKm, 15) : defaultKm;
}
