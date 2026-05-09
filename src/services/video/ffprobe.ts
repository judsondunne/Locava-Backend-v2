import { spawn } from "node:child_process";

export type FfprobeStreamSideData = {
  side_data_type?: string;
  /** Dolby Vision side data fields. */
  dv_version_major?: number;
  dv_version_minor?: number;
  dv_profile?: number;
  dv_level?: number;
};

export type FfprobeStream = {
  index: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  disposition?: { attached_pic?: number };
  /** Color metadata used for HDR / wide-gamut detection. Some sources omit these. */
  color_space?: string;
  color_transfer?: string;
  color_primaries?: string;
  color_range?: string;
  pix_fmt?: string;
  /** ffprobe -show_frames -show_entries side_data exposes per-stream HDR side_data. */
  side_data_list?: FfprobeStreamSideData[];
  bit_rate?: string;
  /** Tags often carry mediabox metadata for iPhone / Apple devices. */
  tags?: Record<string, string>;
};

export type FfprobeResult = {
  format?: { duration?: string; bit_rate?: string };
  streams?: FfprobeStream[];
};

export async function runFfprobeJson(inputPath: string, ffmpegBin = "ffprobe"): Promise<FfprobeResult> {
  // -show_entries pulls color_space/transfer/primaries/range/pix_fmt and side_data_list when present.
  // We deliberately do not request -show_frames here (too expensive on long videos); side_data_list
  // is still surfaced from the stream-level entries when the source carries Dolby Vision config records.
  const args = [
    "-v",
    "error",
    "-show_entries",
    "format=duration,bit_rate:stream=index,codec_type,codec_name,width,height,disposition,color_space,color_transfer,color_primaries,color_range,pix_fmt,bit_rate,tags,side_data_list",
    "-of",
    "json",
    inputPath,
  ];
  const out = await spawnReadStdout(ffmpegBin, args);
  return JSON.parse(out) as FfprobeResult;
}

export type DetectedHdrKind = "dolbyvision" | "hdr10" | "hlg" | "wide_gamut" | "sdr";

export type HdrDetectionResult = {
  /** Coarse classification used to choose the encoder filter chain. */
  kind: DetectedHdrKind;
  /** True iff the source is HDR (Dolby Vision / HDR10 / HLG). Wide-gamut alone is not HDR. */
  isHdr: boolean;
  /** True iff the source is HDR or non-BT.709 wide-gamut (covers iPhone P3 / Rec.2020 SDR cases). */
  isWideGamutOrHdr: boolean;
  /** Raw detected fields for diagnostics. */
  colorSpace: string | null;
  colorTransfer: string | null;
  colorPrimaries: string | null;
  pixFmt: string | null;
  /** True when ffprobe surfaced a Dolby Vision side_data record. */
  dolbyVisionSideData: boolean;
  /** Reason hint string for diagnostics output. */
  reason: string;
};

const HDR_TRANSFERS = new Set([
  "smpte2084", // PQ / HDR10
  "arib-std-b67", // HLG
]);
const WIDE_GAMUT_PRIMARIES = new Set([
  "bt2020",
  "smpte431",
  "smpte432", // Display P3
]);

/**
 * Detect HDR / wide-gamut source from ffprobe metadata. Conservative: only flags HDR when the
 * transfer function or Dolby Vision side data clearly indicates HDR. iPhone SDR videos in P3 still
 * pass through normalize-to-BT.709 instead of tone mapping.
 */
export function detectHdrFromFfprobe(probe: FfprobeResult, primary?: FfprobeStream | null): HdrDetectionResult {
  const stream =
    primary ??
    (Array.isArray(probe.streams)
      ? (probe.streams.find((s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1) ?? null)
      : null);
  const colorSpace = (stream?.color_space ?? null) as string | null;
  const colorTransfer = (stream?.color_transfer ?? null) as string | null;
  const colorPrimaries = (stream?.color_primaries ?? null) as string | null;
  const pixFmt = (stream?.pix_fmt ?? null) as string | null;

  const sideData = Array.isArray(stream?.side_data_list) ? stream!.side_data_list : [];
  const dvSideData = sideData.some((sd) => {
    const name = typeof sd?.side_data_type === "string" ? sd.side_data_type : "";
    if (/dolby.?vision/i.test(name)) return true;
    if (/\bdovi\b/i.test(name)) return true; // ffprobe surfaces "DOVI configuration record"
    if (typeof sd?.dv_profile === "number" && sd.dv_profile > 0) return true;
    return false;
  });

  if (dvSideData) {
    return {
      kind: "dolbyvision",
      isHdr: true,
      isWideGamutOrHdr: true,
      colorSpace,
      colorTransfer,
      colorPrimaries,
      pixFmt,
      dolbyVisionSideData: true,
      reason: "dolby_vision_side_data",
    };
  }

  const transferLower = (colorTransfer ?? "").toLowerCase();
  if (HDR_TRANSFERS.has(transferLower)) {
    const isHlg = transferLower === "arib-std-b67";
    return {
      kind: isHlg ? "hlg" : "hdr10",
      isHdr: true,
      isWideGamutOrHdr: true,
      colorSpace,
      colorTransfer,
      colorPrimaries,
      pixFmt,
      dolbyVisionSideData: false,
      reason: isHlg ? "transfer_arib-std-b67" : "transfer_smpte2084",
    };
  }

  const primariesLower = (colorPrimaries ?? "").toLowerCase();
  if (WIDE_GAMUT_PRIMARIES.has(primariesLower)) {
    return {
      kind: "wide_gamut",
      isHdr: false,
      isWideGamutOrHdr: true,
      colorSpace,
      colorTransfer,
      colorPrimaries,
      pixFmt,
      dolbyVisionSideData: false,
      reason: `primaries_${primariesLower}`,
    };
  }

  // pix_fmt 10-bit doesn't necessarily imply HDR but is a useful diagnostic flag.
  return {
    kind: "sdr",
    isHdr: false,
    isWideGamutOrHdr: false,
    colorSpace,
    colorTransfer,
    colorPrimaries,
    pixFmt,
    dolbyVisionSideData: false,
    reason: "no_hdr_indicators",
  };
}

export function pickPrimaryStreams(streams: FfprobeStream[] | undefined): {
  video: FfprobeStream | null;
  audio: FfprobeStream | null;
} {
  if (!Array.isArray(streams)) return { video: null, audio: null };
  let video: FfprobeStream | null = null;
  for (const s of streams) {
    if (s.codec_type !== "video") continue;
    if (s.disposition?.attached_pic === 1) continue;
    const name = String(s.codec_name ?? "").toLowerCase();
    if (!name || name === "unknown") continue;
    video = s;
    break;
  }
  let audio: FfprobeStream | null = null;
  const audioCodecs = new Set(["aac", "mp3", "opus", "vorbis", "flac", "eac3", "ac3"]);
  for (const s of streams) {
    if (s.codec_type !== "audio") continue;
    const name = String(s.codec_name ?? "").toLowerCase();
    if (!name || name === "unknown") continue;
    if (!audioCodecs.has(name)) continue;
    audio = s;
    break;
  }
  return { video, audio };
}

function spawnReadStdout(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout?.on("data", (d) => chunks.push(Buffer.from(d)));
    child.stderr?.on("data", (d) => errChunks.push(Buffer.from(d)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks).toString("utf8"));
      else reject(new Error(`${cmd} exited ${code}: ${Buffer.concat(errChunks).toString("utf8").slice(0, 800)}`));
    });
  });
}

export function parseDurationSeconds(format: FfprobeResult["format"], streams: FfprobeStream[] | undefined): number {
  const raw = format?.duration;
  if (raw != null) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (Array.isArray(streams)) {
    for (const s of streams) {
      const d = (s as { duration?: string }).duration;
      if (d != null) {
        const n = Number(d);
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
  }
  return 0;
}
