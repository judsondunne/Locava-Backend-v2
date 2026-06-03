import { describe, expect, it } from "vitest";
import { resolveMapLayerEmoji } from "./mapLayerActivityEmoji.js";

describe("mapLayerActivityEmoji", () => {
  it("prefers category over generic hiking primaryActivity", () => {
    const emoji = resolveMapLayerEmoji(["waterfall", "hiking", "trail"]);
    expect(emoji).toBe("💦");
  });

  it("uses viewpoint category", () => {
    const emoji = resolveMapLayerEmoji(["viewpoint", "hiking"]);
    expect(emoji).toBe("🌄");
  });
});
