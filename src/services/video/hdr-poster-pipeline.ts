/**
 * SDR BT.709 normalization filter chains for the Locava video pipeline.
 *
 * Why this exists:
 *   Some iPhone videos are HDR (Dolby Vision / HDR10 / HLG) or wide-gamut SDR (P3 / Rec.2020). When
 *   the video player displays them brightly but the poster JPG was extracted from the raw HDR source
 *   without tone mapping, the poster looks dull/flat compared to the video. Likewise, a startup720
 *   AVC re-encode that does not normalize HDR ends up looking inconsistent across devices.
 *
 * What this provides:
 *   - `hdrFilterMode(hdr, target)` — returns the encode filter chain string for a given target size,
 *     branching:
 *       * `"sdr"`           — plain `scale=...,format=yuv420p`
 *       * `"wide_gamut"`    — convert primaries to BT.709 with `colorspace=all=bt709:iall=...`
 *       * `"hdr_tonemap"`   — full HDR -> SDR tone-mapping chain via `zscale` + `tonemap=…` (PQ/HLG default
 *         `hable`; override with `LOCAVA_HDR_PQ_TONEMAP` / `LOCAVA_HDR_HLG_TONEMAP`, e.g. `mobius`.)
 *         Linear `npl` from `linearizeNplForHdr`; override with `LOCAVA_HDR_HLG_LINEAR_NPL` /
 *         `LOCAVA_HDR_PQ_LINEAR_NPL`.
 *
 *   - `buildHdrAwareEncodeFilter` — convenience wrapper that mirrors `buildPlaybackLabScaleFilter`'s
 *     orientation handling so the SAME normalized filter chain is applied to BOTH the startup AVC
 *     videos and the poster JPG (avoids the "dull poster, bright video" mismatch).
 *
 * Important constraints:
 *   - We never apply arbitrary brightness/contrast adjustments. Only color-space normalization.
 *   - The SDR / non-HDR fast path is byte-identical to the previous filter (`scale=...,format=yuv420p`)
 *     so existing iPhone non-HDR outputs are unchanged.
 *   - `zscale` and `tonemap` filters require ffmpeg built with `--enable-libzimg`. Most distros
 *     ship this; fallback is to `colorspace=all=bt709:iall=bt2020nc` which works on any ffmpeg but
 *     does not tonemap. Set `LOCAVA_HDR_TONEMAP_FALLBACK=1` to force fallback.
 */

import type { HdrDetectionResult } from "./ffprobe.js";

export type HdrFilterChainKind = "sdr" | "wide_gamut" | "hdr_tonemap";

/** Nominal peak luminance (nits) passed to `zscale=t=linear:npl=…` before tonemap. Too low → flat/washed SDR. */
function linearizeNplForHdr(input: { isHlg: boolean }): number {
  /**
   * `npl` is nominal peak luminance (nits) for `zscale=t=linear:npl=…`. Too low → compressed linear
   * range → flat / washed SDR after tonemap (common complaint at ~500 for phone HLG). Too high with
   * aggressive curves can read harsh. Default HLG **900** targets consumer phone HLG (~1000 nit
   * diffuse white) without the old npl=100 bug. Override: `LOCAVA_HDR_HLG_LINEAR_NPL`.
   */
  const raw = input.isHlg
    ? Number(process.env.LOCAVA_HDR_HLG_LINEAR_NPL ?? "900")
    : Number(process.env.LOCAVA_HDR_PQ_LINEAR_NPL ?? "400");
  const n = Number.isFinite(raw) && raw > 0 ? raw : input.isHlg ? 900 : 400;
  return Math.min(10000, Math.max(50, Math.floor(n)));
}

/** PQ and HLG both default to `hable` (contrast); use `mobius` for softer rolloff via `LOCAVA_HDR_HLG_TONEMAP`. */
function tonemapOpForHdr(isHlg: boolean): string {
  const allowed = new Set(["hable", "mobius", "reinhard", "gamma", "clipping"]);
  if (isHlg) {
    const t = String(process.env.LOCAVA_HDR_HLG_TONEMAP ?? "hable")
      .trim()
      .toLowerCase();
    return allowed.has(t) ? t : "hable";
  }
  const t = String(process.env.LOCAVA_HDR_PQ_TONEMAP ?? "hable")
    .trim()
    .toLowerCase();
  return allowed.has(t) ? t : "hable";
}

export type HdrFilterChainBuilder = {
  kind: HdrFilterChainKind;
  /** Build the `vf` string for a given target. */
  build(input: { width: number; height: number; targetH: number; targetW: number }): string;
};

/** Decide which color normalization mode to apply for a probed source. */
export function hdrFilterMode(hdr: HdrDetectionResult): HdrFilterChainKind {
  if (hdr.isHdr) return "hdr_tonemap";
  if (hdr.isWideGamutOrHdr) return "wide_gamut";
  return "sdr";
}

function scalePart(width: number, height: number, targetH: number, targetW: number): string {
  return width >= height
    ? `scale=-2:${targetH}:flags=lanczos`
    : `scale=${targetW}:-2:flags=lanczos`;
}

/**
 * Pure filter-chain builder for a given probe. Decides the normalization once and emits the same
 * chain shape across all encoded outputs (and the poster), keyed only on width/height.
 */
export function makeHdrAwareFilterChain(hdr: HdrDetectionResult): HdrFilterChainBuilder {
  const kind = hdrFilterMode(hdr);
  const fallbackOnly = process.env.LOCAVA_HDR_TONEMAP_FALLBACK === "1";

  if (kind === "sdr") {
    return {
      kind: "sdr",
      build(input) {
        return `${scalePart(input.width, input.height, input.targetH, input.targetW)},format=yuv420p`;
      },
    };
  }

  if (kind === "wide_gamut") {
    /**
     * Wide-gamut SDR (e.g. iPhone P3): only the primaries differ from BT.709. Use `colorspace`
     * filter to convert to bt709 with the source's primaries / matrix / transfer as input. This
     * keeps tone mapping out of the path (we do NOT want to tonemap an SDR source).
     */
    const sourcePrimaries = (hdr.colorPrimaries ?? "bt2020").toLowerCase();
    const colorspaceArgs = `colorspace=all=bt709:iall=${
      sourcePrimaries === "smpte431" || sourcePrimaries === "smpte432" ? "bt709" : "bt2020nc"
    }:fast=1`;
    return {
      kind: "wide_gamut",
      build(input) {
        return [
          scalePart(input.width, input.height, input.targetH, input.targetW),
          colorspaceArgs,
          "format=yuv420p",
        ].join(",");
      },
    };
  }

  /**
   * HDR (HDR10, Dolby Vision, HLG). Tonemap with `zscale + tonemap=hable + zscale + format=yuv420p`.
   * The chain is: linearize PQ/HLG → tonemap to SDR (Hable, no desat) → BT.709 transfer/matrix/range.
   * `npl` must match how the source was mastered: HLG consumer clips expect ~1000 nit diffuse white
   * reference; using 100 nits here linearizes into a tiny luminance range and produces very washed
   * transcodes (see `linearizeNplForHdr` + `LOCAVA_HDR_*_LINEAR_NPL` overrides).
   *
   * If the user explicitly sets LOCAVA_HDR_TONEMAP_FALLBACK=1 (or zscale is unavailable in their
   * ffmpeg build), the fallback uses `colorspace=all=bt709:iall=bt2020nc`. This is not a true tone
   * map but at least produces SDR BT.709-tagged output.
   */
  if (fallbackOnly) {
    return {
      kind: "hdr_tonemap",
      build(input) {
        return [
          scalePart(input.width, input.height, input.targetH, input.targetW),
          "colorspace=all=bt709:iall=bt2020nc:fast=1",
          "format=yuv420p",
        ].join(",");
      },
    };
  }

  return {
    kind: "hdr_tonemap",
    build(input) {
      // Order matters: scale → linearize → tonemap → BT.709 → 8-bit yuv420p.
      const isHlg = (hdr.colorTransfer ?? "").toLowerCase() === "arib-std-b67";
      const tin = isHlg ? "arib-std-b67" : "smpte2084";
      const pin = (hdr.colorPrimaries ?? "bt2020").toLowerCase() === "bt2020" ? "bt2020" : "bt2020";
      const npl = linearizeNplForHdr({ isHlg });
      const tmap = tonemapOpForHdr(isHlg);
      return [
        scalePart(input.width, input.height, input.targetH, input.targetW),
        `zscale=t=linear:npl=${npl}:p=${pin}:tin=${tin}`,
        "format=gbrpf32le",
        "zscale=p=bt709",
        `tonemap=tonemap=${tmap}:desat=0`,
        "zscale=t=bt709:m=bt709:r=tv",
        "format=yuv420p",
      ].join(",");
    },
  };
}

/**
 * Convenience used by the encoding pipeline.
 * Mirrors `buildPlaybackLabScaleFilter(width, height, targetHLandscape, targetWPortrait)` but with
 * HDR-awareness baked in.
 */
export function buildHdrAwareEncodeFilter(
  hdr: HdrDetectionResult,
  width: number,
  height: number,
  targetHLandscape: number,
  targetWPortrait: number,
): string {
  const builder = makeHdrAwareFilterChain(hdr);
  return builder.build({
    width,
    height,
    targetH: targetHLandscape,
    targetW: targetWPortrait,
  });
}

export const HDR_PIPELINE_INTERNAL = {
  scalePart,
};
