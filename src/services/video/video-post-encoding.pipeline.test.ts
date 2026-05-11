import { describe, expect, it } from "vitest";
import { buildMjpegPosterFilterChain, buildPlaybackLabScaleFilter } from "./video-post-encoding.pipeline.js";

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

describe("buildMjpegPosterFilterChain", () => {
  it("expands limited yuv420p to JPEG swing before yuvj420p", () => {
    const base = buildPlaybackLabScaleFilter(720, 1280, 1080, 1080);
    const out = buildMjpegPosterFilterChain(base);
    expect(out).toContain("in_range=tv:out_range=jpeg");
    expect(out).toContain("format=yuvj420p");
    expect(out).not.toMatch(/format=yuv420p,format=yuvj420p$/);
  });
});
