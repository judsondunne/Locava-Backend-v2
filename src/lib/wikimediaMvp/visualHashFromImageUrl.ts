import { createCanvas, loadImage } from "canvas";

export type ImageColorStats = {
  averageSaturation: number;
  averageLuma: number;
};

function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max <= 0) return 0;
  return (max - min) / max;
}

export function hammingDistanceHex64(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 64;
  try {
    const av = BigInt(`0x${a}`);
    const bv = BigInt(`0x${b}`);
    let x = av ^ bv;
    let count = 0;
    while (x > 0n) {
      count += Number(x & 1n);
      x >>= 1n;
    }
    return count;
  } catch {
    return 64;
  }
}

export async function computeDHashFromImageUrl(
  url: string,
  timeoutMs = 5000,
): Promise<{ hash: string; colorStats: ImageColorStats } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const image = await loadImage(Buffer.from(await res.arrayBuffer()));
    const canvas = createCanvas(9, 8);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, 9, 8);
    const data = ctx.getImageData(0, 0, 9, 8).data;
    let bits = "";
    let satSum = 0;
    let lumaSum = 0;
    let pixels = 0;
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const idx = (y * 9 + x) * 4;
        const idxRight = (y * 9 + x + 1) * 4;
        const r = data[idx] ?? 0;
        const g = data[idx + 1] ?? 0;
        const b = data[idx + 2] ?? 0;
        satSum += saturation(r, g, b);
        lumaSum += luma(r, g, b);
        pixels += 1;
        const left = luma(r, g, b);
        const right = luma(data[idxRight] ?? 0, data[idxRight + 1] ?? 0, data[idxRight + 2] ?? 0);
        bits += left > right ? "1" : "0";
      }
    }
    const hash = BigInt(`0b${bits}`).toString(16).padStart(16, "0");
    return {
      hash,
      colorStats: {
        averageSaturation: pixels > 0 ? satSum / pixels : 0,
        averageLuma: pixels > 0 ? lumaSum / pixels : 0,
      },
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
