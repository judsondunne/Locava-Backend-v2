import { Buffer } from "node:buffer";

export type MixCursorPayloadV1 = {
  v: 1;
  mixId: string;
  offset: number;
  scoringVersion: string;
  continuation?: { kind: "global" } | { kind: "geo_ring"; radiusMiles: number };
};

export function encodeMixCursor(payload: MixCursorPayloadV1): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeMixCursor(cursor: string): MixCursorPayloadV1 {
  const raw = Buffer.from(cursor, "base64url").toString("utf8");
  const parsed = JSON.parse(raw) as Partial<MixCursorPayloadV1>;
  if (parsed.v !== 1) throw new Error("invalid_mix_cursor");
  if (!parsed.mixId || typeof parsed.mixId !== "string") throw new Error("invalid_mix_cursor");
  if (!Number.isFinite(parsed.offset) || (parsed.offset as number) < 0) throw new Error("invalid_mix_cursor");
  if (!parsed.scoringVersion || typeof parsed.scoringVersion !== "string") throw new Error("invalid_mix_cursor");
  return {
    v: 1,
    mixId: parsed.mixId,
    offset: Math.floor(parsed.offset as number),
    scoringVersion: parsed.scoringVersion,
    continuation: parsed.continuation as MixCursorPayloadV1["continuation"],
  };
}

