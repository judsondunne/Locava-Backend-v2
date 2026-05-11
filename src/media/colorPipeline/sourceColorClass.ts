import type { FfprobeResult, FfprobeStream } from "../../services/video/ffprobe.js";

export type SourceColorClass =
  | "SDR_REC709"
  | "HDR_HLG_BT2020"
  | "HDR_PQ_BT2020"
  | "UNKNOWN_HDR"
  | "UNKNOWN_COLOR";

export type SourceColorProbeDetails = {
  codec: string | null;
  pixFmt: string | null;
  colorTransfer: string | null;
  colorPrimaries: string | null;
  colorSpace: string | null;
  colorRange: string | null;
  dolbyVisionSideData: boolean;
  bitDepthHint: number | null;
};

function hasDolbyVisionSideData(stream: FfprobeStream): boolean {
  const side = Array.isArray(stream.side_data_list) ? stream.side_data_list : [];
  return side.some((sd) => {
    const name = typeof sd?.side_data_type === "string" ? sd.side_data_type : "";
    if (/dolby.?vision/i.test(name)) return true;
    if (/\bdovi\b/i.test(name)) return true;
    if (typeof sd?.dv_profile === "number" && sd.dv_profile > 0) return true;
    return false;
  });
}

function bitDepthFromPixFmt(pixFmt: string | null): number | null {
  if (!pixFmt) return null;
  const p = pixFmt.toLowerCase();
  if (p.includes("10le") || p.includes("10be") || p.includes("p10")) return 10;
  if (p.includes("12le") || p.includes("12be") || p.includes("p12")) return 12;
  if (p.includes("yuv420p") && !p.includes("10")) return 8;
  return null;
}

/**
 * Classify source color for encoder preset selection (ffprobe stream + container).
 * Conservative on HDR: requires transfer + (primaries or typical phone HEVC 10-bit BT2020 matrix).
 */
export function classifySourceColorFromStream(
  stream: FfprobeStream,
  _probe: FfprobeResult
): { sourceClass: SourceColorClass; details: SourceColorProbeDetails; reason: string } {
  const transfer = (stream.color_transfer ?? "").toLowerCase().trim();
  const primaries = (stream.color_primaries ?? "").toLowerCase().trim();
  const space = (stream.color_space ?? "").toLowerCase().trim();
  const range = (stream.color_range ?? "").toLowerCase().trim();
  const pixFmt = (stream.pix_fmt ?? "").toLowerCase().trim() || null;
  const codec = (stream.codec_name ?? "").toLowerCase().trim() || null;
  const dv = hasDolbyVisionSideData(stream);
  const details: SourceColorProbeDetails = {
    codec,
    pixFmt,
    colorTransfer: stream.color_transfer ?? null,
    colorPrimaries: stream.color_primaries ?? null,
    colorSpace: stream.color_space ?? null,
    colorRange: stream.color_range ?? null,
    dolbyVisionSideData: dv,
    bitDepthHint: bitDepthFromPixFmt(pixFmt)
  };

  if (dv) {
    return { sourceClass: "HDR_PQ_BT2020", details, reason: "dolby_vision_side_data_treated_as_pq" };
  }

  if (transfer === "arib-std-b67") {
    const primOk = primaries === "bt2020" || primaries === "" || primaries === "bt2020nc";
    const spaceOk =
      !space ||
      space === "bt2020nc" ||
      space === "bt2020_ncl" ||
      space === "bt2020c" ||
      space === "bt2020cl" ||
      space === "gbr";
    if (primOk && spaceOk) {
      return { sourceClass: "HDR_HLG_BT2020", details, reason: "hlg_transfer_bt2020_family" };
    }
    return { sourceClass: "UNKNOWN_HDR", details, reason: "hlg_transfer_unusual_primaries_or_matrix" };
  }

  if (transfer === "smpte2084") {
    if (primaries === "bt2020" || primaries === "" || primaries === "bt2020nc") {
      return { sourceClass: "HDR_PQ_BT2020", details, reason: "pq_smpte2084_bt2020" };
    }
    return { sourceClass: "UNKNOWN_HDR", details, reason: "pq_transfer_unusual_primaries" };
  }

  const hevc10PhoneHint =
    (codec === "hevc" || codec === "h265") &&
    (details.bitDepthHint === 10 || (pixFmt ?? "").includes("10")) &&
    (primaries === "bt2020" || space.includes("bt2020"));

  if (hevc10PhoneHint && !transfer) {
    return { sourceClass: "UNKNOWN_COLOR", details, reason: "hevc_10bit_bt2020_matrix_missing_transfer" };
  }

  if (transfer === "bt709" && (primaries === "bt709" || primaries === "") && (space === "bt709" || space === "")) {
    return { sourceClass: "SDR_REC709", details, reason: "bt709_transfer_primaries" };
  }

  if (!transfer && !primaries && (codec === "h264" || codec === "avc1")) {
    return { sourceClass: "SDR_REC709", details, reason: "legacy_avc_no_color_metadata_assumed_sdr" };
  }

  if (transfer === "bt709" && primaries === "bt709") {
    return { sourceClass: "SDR_REC709", details, reason: "explicit_sdr_tags" };
  }

  /** iPhone wide-gamut SDR: BT.709 transfer with P3/Rec.2020 primaries — treat as SDR path (colorspace filter not used in color-v2; still scale-only in SDR preset). */
  if (transfer === "bt709" && (primaries === "bt2020" || primaries === "smpte432" || primaries === "smpte431")) {
    return { sourceClass: "SDR_REC709", details, reason: "wide_gamut_sdr_bt709_transfer" };
  }

  return { sourceClass: "UNKNOWN_COLOR", details, reason: "unclassified_color_metadata" };
}
