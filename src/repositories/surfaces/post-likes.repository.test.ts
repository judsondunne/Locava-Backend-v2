import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

describe("post-likes.repository", () => {
  it("lists likes without orderBy(createdAt) so docs missing that field still appear", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "post-likes.repository.ts"), "utf8");
    expect(src).not.toMatch(/\.orderBy\("createdAt"/);
    expect(src).toContain("resolveLikeCreatedAtMs");
    expect(src).toContain(".sort((a, b) => b.sortMs - a.sortMs)");
  });
});
