/**
 * Detect whether an MP4 has moov before mdat in the first `prefixBytes` bytes (fast-start friendly).
 */
export type MoovHint = "moov_before_mdat_in_prefix" | "moov_after_mdat_or_ambiguous" | "no_moov_in_prefix";

export function moovHintFromMp4Prefix(buf: Buffer, prefixBytes = 524_288): MoovHint {
  const slice = buf.subarray(0, Math.min(buf.length, prefixBytes));
  if (slice.length < 8) return "no_moov_in_prefix";
  const body = slice.toString("binary");
  const moov = body.indexOf("moov");
  if (moov < 0) return "no_moov_in_prefix";
  const mdat = body.indexOf("mdat");
  if (mdat < 0 || moov < mdat) return "moov_before_mdat_in_prefix";
  return "moov_after_mdat_or_ambiguous";
}

export async function probeMoovHintFromUrl(url: string, prefixBytes = 524_288): Promise<MoovHint> {
  if (!/^https?:\/\//i.test(url)) return "no_moov_in_prefix";
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Range: `bytes=0-${prefixBytes - 1}` }
    });
    if (!res.ok && res.status !== 206) return "no_moov_in_prefix";
    const buf = Buffer.from(await res.arrayBuffer());
    return moovHintFromMp4Prefix(buf, prefixBytes);
  } catch {
    return "no_moov_in_prefix";
  }
}
