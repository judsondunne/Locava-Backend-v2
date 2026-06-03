import type { InventoryBbox } from "../../../contracts/entities/inventory-entities.contract.js";
import {
  DEFAULT_OFFROAD_CHUNK_CONFIG,
  type OffroadChunkConfig,
  type OffroadRawFeature,
} from "./sources/nationalOffroadSource.types.js";

export type OffroadChunk = {
  chunkId: string;
  bbox: InventoryBbox;
  index: number;
};

export function chunkStateBbox(
  stateBbox: InventoryBbox,
  config: Partial<OffroadChunkConfig> = {}
): OffroadChunk[] {
  const cfg = { ...DEFAULT_OFFROAD_CHUNK_CONFIG, ...config };
  const chunks: OffroadChunk[] = [];
  let index = 0;

  for (
    let minLat = stateBbox.minLat;
    minLat < stateBbox.maxLat;
    minLat += cfg.chunkSizeDegreesLat
  ) {
    const maxLat = Math.min(stateBbox.maxLat, minLat + cfg.chunkSizeDegreesLat);
    for (
      let minLng = stateBbox.minLng;
      minLng < stateBbox.maxLng;
      minLng += cfg.chunkSizeDegreesLng
    ) {
      const maxLng = Math.min(stateBbox.maxLng, minLng + cfg.chunkSizeDegreesLng);
      const bbox: InventoryBbox = { minLat, minLng, maxLat, maxLng };
      chunks.push({
        chunkId: `chunk_${index}`,
        bbox,
        index,
      });
      index += 1;
    }
  }

  return chunks.length > 0 ? chunks : [{ chunkId: "chunk_0", bbox: stateBbox, index: 0 }];
}

export function dedupeRawFeatures(features: OffroadRawFeature[]): OffroadRawFeature[] {
  const seen = new Set<string>();
  const out: OffroadRawFeature[] = [];
  for (const f of features) {
    const key = `${f.sourceId}:${f.featureId}:${f.layerId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

export async function runWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= items.length) return;
      results[i] = await worker(items[i]!, i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

export async function fetchChunksWithConcurrency<T>(input: {
  chunks: OffroadChunk[];
  maxConcurrent: number;
  fetchChunk: (chunk: OffroadChunk) => Promise<T[]>;
  onChunkError?: (chunk: OffroadChunk, error: unknown) => void;
}): Promise<T[]> {
  const chunkResults = await runWithConcurrencyLimit(input.chunks, input.maxConcurrent, async (chunk) => {
    try {
      return await input.fetchChunk(chunk);
    } catch (error) {
      input.onChunkError?.(chunk, error);
      return [] as T[];
    }
  });
  return chunkResults.flat();
}
