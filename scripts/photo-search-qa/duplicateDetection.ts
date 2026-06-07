import { normalizeImageUrl } from "./imageValidator.js";

export function averageHash(bytes: Uint8Array, size = 8): bigint | null {
  if (bytes.length < 64) return null;

  const samples: number[] = [];
  const step = Math.max(1, Math.floor(bytes.length / (size * size)));
  for (let i = 0; i < size * size; i += 1) {
    samples.push(bytes[i * step] ?? 0);
  }
  const avg = samples.reduce((sum, v) => sum + v, 0) / samples.length;

  let hash = 0n;
  for (let i = 0; i < samples.length; i += 1) {
    if (samples[i]! >= avg) {
      hash |= 1n << BigInt(i);
    }
  }
  return hash;
}

export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

export function findDuplicateIndex(
  currentIndex: number,
  normalizedUrls: string[],
  hashes: Array<bigint | null>,
  currentHash: bigint | null,
  maxHamming = 6,
): number | null {
  const currentUrl = normalizedUrls[currentIndex]!;
  for (let i = 0; i < currentIndex; i += 1) {
    if (normalizedUrls[i] === currentUrl) return i;
    const priorHash = hashes[i];
    if (currentHash != null && priorHash != null) {
      if (hammingDistance(currentHash, priorHash) <= maxHamming) return i;
    }
  }
  return null;
}

export function duplicateRate(duplicateCount: number, totalImages: number): number {
  if (totalImages <= 0) return 0;
  return duplicateCount / totalImages;
}

export function countNearDuplicates(
  normalizedUrls: string[],
  hashes: Array<bigint | null>,
): number {
  let dupes = 0;
  for (let i = 0; i < normalizedUrls.length; i += 1) {
    if (findDuplicateIndex(i, normalizedUrls, hashes, hashes[i] ?? null) != null) {
      dupes += 1;
    }
  }
  return dupes;
}

export function buildNormalizedUrls(urls: string[]): string[] {
  return urls.map((url) => normalizeImageUrl(url));
}
