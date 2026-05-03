import { moovHintFromMp4Prefix, type MoovHint } from "./mp4-moov-hint.js";

export type RemoteVerifyOk = {
  ok: true;
  contentLength: number;
  contentType: string;
  moovHint: MoovHint;
};

export type RemoteVerifyFail = {
  ok: false;
  reason: string;
};

function parseTotalLengthFromContentRange(value: string): number {
  const m = value.match(/\/(\d+)\s*$/);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : 0;
}

export async function verifyRemoteMp4Faststart(
  url: string,
  originalUrl: string,
  opts?: { requireMoovBeforeMdat?: boolean },
): Promise<RemoteVerifyOk | RemoteVerifyFail> {
  if (!/^https?:\/\//i.test(url)) return { ok: false, reason: "bad_url" };
  if (originalUrl && url.trim() === originalUrl.trim()) return { ok: false, reason: "url_equals_original" };
  let headLen = 0;
  let contentType = "";
  let headDenied = false;
  try {
    const head = await fetch(url, { method: "HEAD" });
    if (!head.ok) {
      if (head.status === 403 || head.status === 405 || head.status === 501) {
        headDenied = true;
      } else {
        return { ok: false, reason: `head_http_${head.status}` };
      }
    } else {
      headLen = Number(head.headers?.get("content-length") ?? "0");
      contentType =
        String(head.headers?.get("content-type") ?? "")
          .split(";")[0]
          ?.trim()
          .toLowerCase() ?? "";
    }
  } catch {
    headDenied = true;
  }
  let moovHint: MoovHint = "no_moov_in_prefix";
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-524287" }
    });
    if (!res.ok && res.status !== 206) return { ok: false, reason: `range_http_${res.status}` };
    if (headDenied) {
      contentType =
        String(res.headers?.get("content-type") ?? "")
          .split(";")[0]
          ?.trim()
          .toLowerCase() ?? "";
      const fromRange = parseTotalLengthFromContentRange(String(res.headers?.get("content-range") ?? ""));
      const fromLen = Number(res.headers?.get("content-length") ?? "0");
      headLen = fromRange > 0 ? fromRange : fromLen;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    moovHint = moovHintFromMp4Prefix(buf);
  } catch {
    return { ok: false, reason: "range_read_failed" };
  }
  if (!Number.isFinite(headLen) || headLen <= 0) return { ok: false, reason: "missing_content_length" };
  if (!contentType.includes("video/mp4") && !contentType.includes("application/octet-stream")) {
    return { ok: false, reason: `unexpected_content_type:${contentType || "empty"}` };
  }
  if (opts?.requireMoovBeforeMdat !== false && moovHint !== "moov_before_mdat_in_prefix") {
    return { ok: false, reason: `moov_hint:${moovHint}` };
  }
  return { ok: true, contentLength: headLen, contentType, moovHint };
}

export async function verifyRemoteImage(url: string): Promise<RemoteVerifyOk | RemoteVerifyFail> {
  if (!/^https?:\/\//i.test(url)) return { ok: false, reason: "bad_url" };
  try {
    const head = await fetch(url, { method: "HEAD" });
    let headLen = 0;
    let contentType = "";
    if (!head.ok) {
      if (head.status !== 403 && head.status !== 405 && head.status !== 501) return { ok: false, reason: `head_http_${head.status}` };
      const get = await fetch(url, { method: "GET", headers: { Range: "bytes=0-1023" } });
      if (!get.ok && get.status !== 206) return { ok: false, reason: `range_http_${get.status}` };
      contentType =
        String(get.headers?.get("content-type") ?? "")
          .split(";")[0]
          ?.trim()
          .toLowerCase() ?? "";
      const fromRange = parseTotalLengthFromContentRange(String(get.headers?.get("content-range") ?? ""));
      const fromLen = Number(get.headers?.get("content-length") ?? "0");
      headLen = fromRange > 0 ? fromRange : fromLen;
      await get.arrayBuffer();
    } else {
      headLen = Number(head.headers?.get("content-length") ?? "0");
      contentType =
        String(head.headers?.get("content-type") ?? "")
          .split(";")[0]
          ?.trim()
          .toLowerCase() ?? "";
    }
    if (!Number.isFinite(headLen) || headLen <= 0) return { ok: false, reason: "missing_content_length" };
    if (!contentType.includes("jpeg") && !contentType.includes("jpg") && !contentType.includes("image/")) {
      return { ok: false, reason: `unexpected_content_type:${contentType}` };
    }
    return { ok: true, contentLength: headLen, contentType, moovHint: "moov_before_mdat_in_prefix" };
  } catch {
    return { ok: false, reason: "head_failed" };
  }
}
