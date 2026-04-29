import { Buffer } from "node:buffer";

export type MixCursorV2 =
  | {
      v: 2;
      mixId: string;
      kind: "activity";
      activity: string;
      lastTime: number | null;
      lastId: string | null;
    }
  | {
      v: 2;
      mixId: string;
      kind: "recent";
      lastTime: number | null;
      lastId: string | null;
    }
  | {
      v: 2;
      mixId: string;
      kind: "friends";
      followingHash: string;
      chunks: Array<{
        chunkIndex: number;
        lastTime: number | null;
        lastId: string | null;
        exhausted: boolean;
      }>;
    }
  | {
      v: 2;
      mixId: string;
      kind: "daily";
      dayKey: string;
      seed: string;
      activities: string[];
      cursors: Array<{
        activity: string;
        lastTime: number | null;
        lastId: string | null;
        exhausted: boolean;
      }>;
    }
  | {
      v: 2;
      mixId: string;
      kind: "nearby";
      center: { lat: number; lng: number };
      ringsMiles: number[];
      ringIndex: number;
      geohashPrefixes: string[];
      prefixIndex: number;
      lastGeohash: string | null;
      lastTime: number | null;
      lastId: string | null;
      seen: string[];
    };

export function encodeMixCursorV2(payload: MixCursorV2): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeMixCursorV2(cursor: string): MixCursorV2 {
  const raw = Buffer.from(cursor, "base64url").toString("utf8");
  const parsed = JSON.parse(raw) as Partial<MixCursorV2>;
  if (parsed.v !== 2) throw new Error("invalid_mix_cursor");
  if (!parsed.mixId || typeof parsed.mixId !== "string") throw new Error("invalid_mix_cursor");
  if (!parsed.kind || typeof parsed.kind !== "string") throw new Error("invalid_mix_cursor");
  return parsed as MixCursorV2;
}

export function hashIdsDeterministic(ids: string[]): string {
  // Simple deterministic hash (djb2) for cursor integrity; not cryptographic.
  let hash = 5381;
  for (const id of ids) {
    for (let i = 0; i < id.length; i += 1) {
      hash = (hash * 33) ^ id.charCodeAt(i);
    }
  }
  return (hash >>> 0).toString(16);
}

