import { describe, expect, it } from "vitest";
import type { FfprobeResult, FfprobeStream } from "../../services/video/ffprobe.js";
import { classifySourceColorFromStream } from "./sourceColorClass.js";
import { resolveColorPipeline } from "./resolveColorPipeline.js";

function stream(partial: Partial<FfprobeStream>): FfprobeStream {
  return {
    index: 0,
    codec_type: "video",
    codec_name: "hevc",
    width: 1080,
    height: 1920,
    ...partial
  } as FfprobeStream;
}

const emptyProbe: FfprobeResult = { format: {}, streams: [] };

describe("classifySourceColorFromStream", () => {
  it("classifies phone HLG BT2020", () => {
    const r = classifySourceColorFromStream(
      stream({
        codec_name: "hevc",
        pix_fmt: "yuv420p10le",
        color_transfer: "arib-std-b67",
        color_primaries: "bt2020",
        color_space: "bt2020nc"
      }),
      emptyProbe
    );
    expect(r.sourceClass).toBe("HDR_HLG_BT2020");
  });

  it("classifies HDR10 PQ", () => {
    const r = classifySourceColorFromStream(
      stream({
        codec_name: "hevc",
        color_transfer: "smpte2084",
        color_primaries: "bt2020",
        color_space: "bt2020nc"
      }),
      emptyProbe
    );
    expect(r.sourceClass).toBe("HDR_PQ_BT2020");
  });

  it("classifies SDR Rec709", () => {
    const r = classifySourceColorFromStream(
      stream({
        codec_name: "h264",
        color_transfer: "bt709",
        color_primaries: "bt709",
        color_space: "bt709"
      }),
      emptyProbe
    );
    expect(r.sourceClass).toBe("SDR_REC709");
  });
});

describe("resolveColorPipeline", () => {
  it("SDR_REC709 uses passthrough (no zscale tonemap substring)", () => {
    const p = resolveColorPipeline({ presetId: "phone-hlg-sdr-v1-mobius", sourceClass: "SDR_REC709" });
    expect(p.requiresHdrTonemap).toBe(false);
    const vf = p.buildVideoFilter(720, 1280, 720, 720);
    expect(vf).not.toContain("tonemap=");
    expect(vf).toContain("format=yuv420p");
  });

  it("HDR_HLG mobius preset includes zscale + tonemap + bt709 output chain", () => {
    const p = resolveColorPipeline({ presetId: "phone-hlg-sdr-v1-mobius", sourceClass: "HDR_HLG_BT2020" });
    expect(p.requiresHdrTonemap).toBe(true);
    const vf = p.buildVideoFilter(2160, 3840, 720, 720);
    expect(vf).toContain("zscale=t=linear:");
    expect(vf).toContain("tonemap=tonemap=mobius");
    expect(vf).toContain("tin=arib-std-b67");
    expect(vf).toContain("zscale=t=bt709:m=bt709:r=tv");
    expect(p.ffmpegOutputColorArgs).toContain("-color_primaries");
    expect(p.ffmpegOutputColorArgs).toContain("bt709");
  });

  it("rejects unknown source class", () => {
    expect(() =>
      resolveColorPipeline({ presetId: "phone-hlg-sdr-v1-mobius", sourceClass: "UNKNOWN_COLOR" })
    ).toThrow(/color_pipeline_refused_unknown_source/);
  });
});
