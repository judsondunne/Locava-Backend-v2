import { planStateChunks } from "../usChunkPlanner.js";
import {
  listContiguousStateCodes,
  listStateCodes,
} from "../../../../lib/inventory/offroad/offroadStateBounds.js";
import type { OsmNationalCopierConfig, OsmNationalCopierTile } from "./osmNationalCopierTypes.js";

/**
 * Builds the flat national tile queue the UI hides from the user.
 *
 * The UI never asks the user to pick states. Internally, we still iterate
 * per-state chunks because Overpass + state-level offroad sources are tuned
 * for state-sized inputs. Each tile carries `stateCode` so the runner can hand
 * the right state to `fetchOffroadRoutesForBbox`.
 */

export type CopierPlanInput = {
  config: OsmNationalCopierConfig;
  /** Override for tests / smaller plans (defaults to contiguous US). */
  stateCodes?: string[];
  /** Optional cap so the planner can produce a short queue for tests. */
  maxTiles?: number;
};

export type CopierPlanResult = {
  tiles: OsmNationalCopierTile[];
  stateCodes: string[];
  estimatedTotalTiles: number;
  chunkSizeKm: number;
};

export function resolveCopierStateCodes(input: CopierPlanInput): string[] {
  const explicit = input.config.stateCodes ?? input.stateCodes;
  if (explicit && explicit.length > 0) {
    const upper = explicit.map((s) => s.toUpperCase());
    return [...new Set(upper)].filter((code) => listStateCodes().includes(code));
  }
  return listContiguousStateCodes();
}

export function planCopierTiles(input: CopierPlanInput): CopierPlanResult {
  const states = resolveCopierStateCodes(input);
  const chunkSizeKm = input.config.chunkSizeKm;
  const tiles: OsmNationalCopierTile[] = [];

  for (const stateCode of states) {
    const planned = planStateChunks({ stateCode, chunkSizeKm });
    for (const chunk of planned) {
      tiles.push({
        tileId: chunk.chunkId,
        tileIndex: tiles.length,
        stateCode: chunk.stateCode,
        bbox: chunk.bbox,
      });
      if (input.maxTiles != null && tiles.length >= input.maxTiles) {
        return {
          tiles,
          stateCodes: states,
          estimatedTotalTiles: tiles.length,
          chunkSizeKm,
        };
      }
    }
  }

  return {
    tiles,
    stateCodes: states,
    estimatedTotalTiles: tiles.length,
    chunkSizeKm,
  };
}
