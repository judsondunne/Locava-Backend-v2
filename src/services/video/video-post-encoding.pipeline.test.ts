import { describe, expect, it } from "vitest";
import { buildPlaybackLabScaleFilter } from "./video-post-encoding.pipeline.js";

describe("buildPlaybackLabScaleFilter", () => {
  it("uses width:-2 for portrait (720×1280)", () => {
    const vf = buildPlaybackLabScaleFilter(720, 1280, 360, 360);
    expect(vf).toMatch(/scale=360:-2:/);
    expect(vf).not.toContain("360=-2");
  });

  it("uses -2:height for landscape (1280×720)", () => {
    const vf = buildPlaybackLabScaleFilter(1280, 720, 360, 360);
    expect(vf).toContain("scale=-2:360:");
  });
});
