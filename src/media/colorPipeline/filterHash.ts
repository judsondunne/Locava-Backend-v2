import { createHash } from "node:crypto";

/** Short stable hash for diagnostics / Firestore (not cryptographic). */
export function ffmpegFilterGraphHash(filterGraph: string): string {
  return createHash("sha256").update(filterGraph, "utf8").digest("hex").slice(0, 16);
}
