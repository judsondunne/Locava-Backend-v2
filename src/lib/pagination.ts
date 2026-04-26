import { Buffer } from "node:buffer";

export type CursorPayload = {
  id: string;
  createdAtMs: number;
};

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): CursorPayload {
  const raw = Buffer.from(cursor, "base64url").toString("utf8");
  const data = JSON.parse(raw) as CursorPayload;
  if (!data.id || !Number.isFinite(data.createdAtMs)) {
    throw new Error("Invalid cursor payload");
  }
  return data;
}
