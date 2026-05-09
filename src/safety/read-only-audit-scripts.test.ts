import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function readScript(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("read-only audit scripts", () => {
  const scripts = [
    "scripts/audit-feed-first-paint.mts",
    "scripts/audit-map-compact-markers.mts",
  ] as const;

  for (const scriptPath of scripts) {
    it(`${scriptPath} enables the read-only guard and rejects write observations`, () => {
      const source = readScript(scriptPath);
      expect(source.includes('const READ_ONLY_GUARD_FLAG = "READ_ONLY_LATENCY_AUDIT";')).toBe(true);
      expect(source.includes('process.env[READ_ONLY_GUARD_FLAG] = "1";')).toBe(true);
      expect(source.includes('method: "GET"')).toBe(true);
      expect(source.includes("if (dbWrites !== 0) {")).toBe(true);
      expect(source.includes("throw new Error(`read_only_violation:")).toBe(true);
    });
  }
});
