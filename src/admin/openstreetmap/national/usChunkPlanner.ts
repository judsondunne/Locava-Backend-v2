import { createHash } from "node:crypto";
import type { InventoryBbox } from "../../../contracts/entities/inventory-entities.contract.js";
import { getStateBounds } from "../../../lib/inventory/offroad/offroadStateBounds.js";
import { getDenseStateChunkSizeKm } from "./usStateBounds.js";

export type PlannedChunk = {
  chunkId: string;
  chunkIndex: number;
  row: number;
  col: number;
  bbox: InventoryBbox;
  stateCode: string;
};

function hash8(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 8);
}

function kmToLatDelta(km: number): number {
  return km / 111.32;
}

function kmToLngDelta(km: number, lat: number): number {
  const cos = Math.cos((lat * Math.PI) / 180);
  return km / (111.32 * Math.max(cos, 0.01));
}

function normalizeBboxKey(bbox: InventoryBbox): string {
  return [
    bbox.minLat.toFixed(5),
    bbox.minLng.toFixed(5),
    bbox.maxLat.toFixed(5),
    bbox.maxLng.toFixed(5),
  ].join("|");
}

export function buildChunkId(stateCode: string, row: number, col: number, bbox: InventoryBbox): string {
  const hash = hash8(`${stateCode}|${normalizeBboxKey(bbox)}`);
  return `${stateCode.toUpperCase()}_r${row}_c${col}_${hash}`;
}

export function planStateChunks(input: {
  stateCode: string;
  chunkSizeKm?: number;
  customBbox?: InventoryBbox;
}): PlannedChunk[] {
  const state = getStateBounds(input.stateCode);
  if (!state) throw new Error(`unknown_state:${input.stateCode}`);
  const bbox = input.customBbox ?? state.bbox;
  const chunkSizeKm = getDenseStateChunkSizeKm(state.stateCode, input.chunkSizeKm ?? 20);
  const centerLat = (bbox.minLat + bbox.maxLat) / 2;
  const latStep = kmToLatDelta(chunkSizeKm);
  const lngStep = kmToLngDelta(chunkSizeKm, centerLat);

  const chunks: PlannedChunk[] = [];
  let chunkIndex = 0;
  let row = 0;

  for (let minLat = bbox.minLat; minLat < bbox.maxLat; minLat += latStep, row += 1) {
    const maxLat = Math.min(bbox.maxLat, minLat + latStep);
    let col = 0;
    for (let minLng = bbox.minLng; minLng < bbox.maxLng; minLng += lngStep, col += 1) {
      const maxLng = Math.min(bbox.maxLng, minLng + lngStep);
      const chunkBbox: InventoryBbox = { minLat, minLng, maxLat, maxLng };
      chunks.push({
        chunkId: buildChunkId(state.stateCode, row, col, chunkBbox),
        chunkIndex,
        row,
        col,
        bbox: chunkBbox,
        stateCode: state.stateCode,
      });
      chunkIndex += 1;
    }
  }

  return chunks.length > 0
    ? chunks
    : [
        {
          chunkId: buildChunkId(state.stateCode, 0, 0, bbox),
          chunkIndex: 0,
          row: 0,
          col: 0,
          bbox,
          stateCode: state.stateCode,
        },
      ];
}

export function shouldSkipChunk(input: {
  chunk: { status: string };
  skipCompletedChunks: boolean;
  forceReprocess: boolean;
}): boolean {
  if (input.forceReprocess) return false;
  if (!input.skipCompletedChunks) return false;
  return input.chunk.status === "completed" || input.chunk.status === "skipped";
}
