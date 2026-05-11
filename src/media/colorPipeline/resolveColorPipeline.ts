import { HDR_PIPELINE_INTERNAL } from "../../services/video/hdr-poster-pipeline.js";
import type { SourceColorClass } from "./sourceColorClass.js";
import { ffmpegFilterGraphHash } from "./filterHash.js";

export const COLOR_PIPELINE_VERSION = 2 as const;

export const DEFAULT_REELS_COLOR_PRESET_ID = "phone-hlg-sdr-v1-mobius" as const;

export const COLOR_PRESET_IDS = [
  "phone-hlg-sdr-v1-mobius",
  "phone-hlg-sdr-v1-hable",
  "phone-hlg-sdr-v1-soft",
  "sdr-rec709-pass-v1"
] as const;

export type ColorPresetId = (typeof COLOR_PRESET_IDS)[number];

export type ResolvedColorPipeline = {
  id: ColorPresetId;
  sourceClass: SourceColorClass;
  outputColor: "SDR_REC709";
  /** vf for a given display size (includes scale + format=yuv420p). */
  buildVideoFilter: (width: number, height: number, targetHLandscape: number, targetWPortrait: number) => string;
  /** Example vf at 720x1280 portrait → 720 target (for hashing / metadata). */
  sampleFilterGraphForHash: string;
  ffmpegOutputColorArgs: string[];
  notes: string;
  version: typeof COLOR_PIPELINE_VERSION;
  requiresHdrTonemap: boolean;
};

const OUT_TAGS = ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv"];

function scalePart(width: number, height: number, targetH: number, targetW: number): string {
  return HDR_PIPELINE_INTERNAL.scalePart(width, height, targetH, targetW);
}

function hdrLinearNpl(transferIsHlg: boolean, presetKind: "mobius" | "hable" | "soft"): number {
  if (!transferIsHlg) return 400;
  if (presetKind === "soft") return 750;
  return 900;
}

function tonemapNameForPreset(presetKind: "mobius" | "hable" | "soft"): string {
  if (presetKind === "soft") return "reinhard";
  if (presetKind === "hable") return "hable";
  return "mobius";
}

function buildHdrZscaleTonemapVf(input: {
  width: number;
  height: number;
  targetH: number;
  targetW: number;
  tin: "arib-std-b67" | "smpte2084";
  npl: number;
  tonemap: string;
}): string {
  const pin = "bt2020";
  return [
    scalePart(input.width, input.height, input.targetH, input.targetW),
    `zscale=t=linear:npl=${input.npl}:p=${pin}:tin=${input.tin}`,
    "format=gbrpf32le",
    "zscale=p=bt709",
    `tonemap=tonemap=${input.tonemap}:desat=0`,
    "zscale=t=bt709:m=bt709:r=tv",
    "format=yuv420p"
  ].join(",");
}

function buildSdrPassVf(width: number, height: number, targetH: number, targetW: number): string {
  return `${scalePart(width, height, targetH, targetW)},format=yuv420p`;
}

function resolveHdrPreset(
  presetId: ColorPresetId,
  sourceClass: SourceColorClass,
  tin: "arib-std-b67" | "smpte2084"
): ResolvedColorPipeline {
  const kind: "mobius" | "hable" | "soft" =
    presetId === "phone-hlg-sdr-v1-hable"
      ? "hable"
      : presetId === "phone-hlg-sdr-v1-soft"
        ? "soft"
        : "mobius";
  const transferIsHlg = tin === "arib-std-b67";
  const npl = hdrLinearNpl(transferIsHlg, kind);
  const tonemap = tonemapNameForPreset(kind);
  const notes =
    presetId === "phone-hlg-sdr-v1-mobius"
      ? "HLG/PQ → linear zscale → mobius tonemap → BT.709 limited; default for phone HLG."
      : presetId === "phone-hlg-sdr-v1-hable"
        ? "Same chain with hable; stronger highlight handling, can read darker."
        : "Reinhard tonemap + slightly lower HLG npl for harsh outdoor clips.";

  const buildVideoFilter = (width: number, height: number, targetHLandscape: number, targetWPortrait: number) =>
    buildHdrZscaleTonemapVf({
      width,
      height,
      targetH: targetHLandscape,
      targetW: targetWPortrait,
      tin,
      npl,
      tonemap
    });

  const sampleFilterGraphForHash = buildVideoFilter(720, 1280, 720, 720);

  return {
    id: presetId,
    sourceClass,
    outputColor: "SDR_REC709",
    buildVideoFilter,
    sampleFilterGraphForHash,
    ffmpegOutputColorArgs: OUT_TAGS,
    notes,
    version: COLOR_PIPELINE_VERSION,
    requiresHdrTonemap: true
  };
}

/**
 * Map ffprobe classification + requested preset id to a concrete ffmpeg filter plan.
 * SDR sources always use passthrough scaling regardless of requested HLG preset id.
 */
export function resolveColorPipeline(input: {
  presetId: string;
  sourceClass: SourceColorClass;
}): ResolvedColorPipeline {
  if (input.sourceClass === "UNKNOWN_HDR" || input.sourceClass === "UNKNOWN_COLOR") {
    throw new Error(
      `color_pipeline_refused_unknown_source:${input.sourceClass} — set a known HDR/SDR source or fix ffprobe metadata.`
    );
  }

  const requested = (COLOR_PRESET_IDS as readonly string[]).includes(input.presetId)
    ? (input.presetId as ColorPresetId)
    : DEFAULT_REELS_COLOR_PRESET_ID;
  let id: ColorPresetId =
    input.sourceClass !== "SDR_REC709" && requested === "sdr-rec709-pass-v1"
      ? DEFAULT_REELS_COLOR_PRESET_ID
      : requested;

  if (input.sourceClass === "SDR_REC709") {
    const buildVideoFilter = (width: number, height: number, targetHLandscape: number, targetWPortrait: number) =>
      buildSdrPassVf(width, height, targetHLandscape, targetWPortrait);
    return {
      id: "sdr-rec709-pass-v1",
      sourceClass: "SDR_REC709",
      outputColor: "SDR_REC709",
      buildVideoFilter,
      sampleFilterGraphForHash: buildVideoFilter(720, 1280, 720, 720),
      ffmpegOutputColorArgs: OUT_TAGS,
      notes: "SDR BT.709: lanczos scale + yuv420p only; no tonemap.",
      version: COLOR_PIPELINE_VERSION,
      requiresHdrTonemap: false
    };
  }

  if (input.sourceClass === "HDR_HLG_BT2020") {
    return resolveHdrPreset(id, "HDR_HLG_BT2020", "arib-std-b67");
  }

  if (input.sourceClass === "HDR_PQ_BT2020") {
    return resolveHdrPreset(id, "HDR_PQ_BT2020", "smpte2084");
  }

  throw new Error(`color_pipeline_unsupported_source:${input.sourceClass}`);
}

export function colorPipelineMetaBase(input: {
  sourceClass: SourceColorClass;
  presetId: string;
  effectivePreset: ResolvedColorPipeline;
  details: import("./sourceColorClass.js").SourceColorProbeDetails;
}): Record<string, unknown> {
  const graphSample = input.effectivePreset.sampleFilterGraphForHash;
  return {
    sourceClass: input.sourceClass,
    preset: input.effectivePreset.id,
    version: COLOR_PIPELINE_VERSION,
    outputColor: "SDR_REC709",
    ffmpegFilterHash: ffmpegFilterGraphHash(graphSample),
    generatedAt: new Date().toISOString(),
    sourceColor: {
      transfer: input.details.colorTransfer,
      primaries: input.details.colorPrimaries,
      matrix: input.details.colorSpace,
      range: input.details.colorRange,
      pixFmt: input.details.pixFmt,
      codec: input.details.codec,
      dolbyVisionSideData: input.details.dolbyVisionSideData,
      bitDepthHint: input.details.bitDepthHint
    },
    notes: input.effectivePreset.notes
  };
}
