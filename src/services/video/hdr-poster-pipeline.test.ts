import { describe, expect, it } from "vitest";
import {
  buildHdrAwareEncodeFilter,
  hdrFilterMode,
  makeHdrAwareFilterChain,
} from "./hdr-poster-pipeline.js";
import { detectHdrFromFfprobe, type FfprobeResult } from "./ffprobe.js";

function probe(stream: Record<string, unknown>): FfprobeResult {
  return {
    format: { duration: "10.0" },
    streams: [
      {
        index: 0,
        codec_type: "video",
        codec_name: "hevc",
        width: 1080,
        height: 1920,
        ...stream,
      } as FfprobeResult["streams"] extends (infer S)[] ? S : never,
    ],
  };
}

describe("detectHdrFromFfprobe", () => {
  it("returns sdr for typical iPhone H.264 BT.709 SDR videos", () => {
    const r = detectHdrFromFfprobe(
      probe({
        codec_name: "h264",
        color_space: "bt709",
        color_transfer: "bt709",
        color_primaries: "bt709",
      }),
    );
    expect(r.kind).toBe("sdr");
    expect(r.isHdr).toBe(false);
    expect(r.isWideGamutOrHdr).toBe(false);
  });

  it("returns hdr10 when color_transfer is smpte2084 (PQ)", () => {
    const r = detectHdrFromFfprobe(
      probe({
        color_space: "bt2020nc",
        color_transfer: "smpte2084",
        color_primaries: "bt2020",
      }),
    );
    expect(r.kind).toBe("hdr10");
    expect(r.isHdr).toBe(true);
    expect(r.isWideGamutOrHdr).toBe(true);
    expect(r.reason).toBe("transfer_smpte2084");
  });

  it("returns hlg when color_transfer is arib-std-b67", () => {
    const r = detectHdrFromFfprobe(
      probe({
        color_space: "bt2020nc",
        color_transfer: "arib-std-b67",
        color_primaries: "bt2020",
      }),
    );
    expect(r.kind).toBe("hlg");
    expect(r.isHdr).toBe(true);
  });

  it("returns dolbyvision when DOVI side data is present", () => {
    const r = detectHdrFromFfprobe(
      probe({
        color_space: "bt2020nc",
        color_transfer: "smpte2084",
        color_primaries: "bt2020",
        side_data_list: [
          {
            side_data_type: "DOVI configuration record",
            dv_profile: 8,
            dv_level: 4,
          },
        ],
      }),
    );
    expect(r.kind).toBe("dolbyvision");
    expect(r.isHdr).toBe(true);
    expect(r.dolbyVisionSideData).toBe(true);
  });

  it("returns wide_gamut for SDR P3 (display) primaries", () => {
    const r = detectHdrFromFfprobe(
      probe({
        codec_name: "h264",
        color_space: "bt709",
        color_transfer: "bt709",
        color_primaries: "smpte432",
      }),
    );
    expect(r.kind).toBe("wide_gamut");
    expect(r.isHdr).toBe(false);
    expect(r.isWideGamutOrHdr).toBe(true);
  });

  it("returns wide_gamut for SDR Rec.2020 primaries (no HDR transfer)", () => {
    const r = detectHdrFromFfprobe(
      probe({
        color_space: "bt2020nc",
        color_transfer: "bt709",
        color_primaries: "bt2020",
      }),
    );
    expect(r.kind).toBe("wide_gamut");
    expect(r.isHdr).toBe(false);
  });
});

describe("hdrFilterMode + makeHdrAwareFilterChain", () => {
  it("sdr -> simple scale + format=yuv420p", () => {
    const r = detectHdrFromFfprobe(
      probe({
        color_space: "bt709",
        color_transfer: "bt709",
        color_primaries: "bt709",
      }),
    );
    expect(hdrFilterMode(r)).toBe("sdr");
    const chain = makeHdrAwareFilterChain(r);
    const out = chain.build({ width: 720, height: 1280, targetH: 720, targetW: 720 });
    expect(out).toBe("scale=720:-2:flags=lanczos,format=yuv420p");
  });

  it("wide_gamut -> uses colorspace filter to convert to bt709 (no tonemap)", () => {
    const r = detectHdrFromFfprobe(
      probe({
        color_space: "bt2020nc",
        color_transfer: "bt709",
        color_primaries: "bt2020",
      }),
    );
    expect(hdrFilterMode(r)).toBe("wide_gamut");
    const out = buildHdrAwareEncodeFilter(r, 1080, 1920, 720, 720);
    expect(out).toContain("colorspace=all=bt709");
    expect(out).toContain("format=yuv420p");
    expect(out).not.toContain("tonemap=");
  });

  it("hdr_tonemap -> includes zscale + tonemap=hable + bt709", () => {
    const r = detectHdrFromFfprobe(
      probe({
        color_space: "bt2020nc",
        color_transfer: "smpte2084",
        color_primaries: "bt2020",
      }),
    );
    expect(hdrFilterMode(r)).toBe("hdr_tonemap");
    const out = buildHdrAwareEncodeFilter(r, 1080, 1920, 720, 720);
    expect(out).toContain("zscale=t=linear");
    expect(out).toContain("tonemap=tonemap=hable");
    expect(out).toContain("zscale=t=bt709:m=bt709:r=tv");
    expect(out).toContain("format=yuv420p");
  });

  it("respects LOCAVA_HDR_TONEMAP_FALLBACK=1 for HDR sources", () => {
    const original = process.env.LOCAVA_HDR_TONEMAP_FALLBACK;
    try {
      process.env.LOCAVA_HDR_TONEMAP_FALLBACK = "1";
      const r = detectHdrFromFfprobe(
        probe({
          color_space: "bt2020nc",
          color_transfer: "smpte2084",
          color_primaries: "bt2020",
        }),
      );
      const out = buildHdrAwareEncodeFilter(r, 1080, 1920, 720, 720);
      expect(out).not.toContain("zscale");
      expect(out).not.toContain("tonemap=");
      expect(out).toContain("colorspace=all=bt709:iall=bt2020nc");
    } finally {
      if (original === undefined) {
        delete process.env.LOCAVA_HDR_TONEMAP_FALLBACK;
      } else {
        process.env.LOCAVA_HDR_TONEMAP_FALLBACK = original;
      }
    }
  });

  it("landscape vs portrait scale selection matches existing buildPlaybackLabScaleFilter behavior for SDR", () => {
    const r = detectHdrFromFfprobe(
      probe({ color_space: "bt709", color_transfer: "bt709", color_primaries: "bt709" }),
    );
    const portrait = buildHdrAwareEncodeFilter(r, 1080, 1920, 720, 720);
    const landscape = buildHdrAwareEncodeFilter(r, 1920, 1080, 720, 720);
    expect(portrait.startsWith("scale=720:-2")).toBe(true);
    expect(landscape.startsWith("scale=-2:720")).toBe(true);
  });
});
