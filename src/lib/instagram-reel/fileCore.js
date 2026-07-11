// @ts-nocheck
/** Ported from Locava Web instagram-reel file — Backendv2 native */

function httpJson(body, status = 200) {
  return {
    kind: 'json',
    status,
    contentType: 'application/json; charset=utf-8',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

function httpBinary(buf, status, headers) {
  const out = {};
  for (const [k, v] of headers.entries()) out[k.toLowerCase()] = v;
  return { kind: 'binary', status, body: buf, headers: out };
}

import fs from "fs";
import os from "os";
import path from "path";
import { spawn, spawnSync } from "child_process";
import http from "http";
import https from "https";
import { writeNetscapeCookiesFromBrowserArray } from "./instagramCookieHelpers.js";

export const runtime = "nodejs";
// Vercel Hobby: maxDuration must be 1–60s. Use Pro for longer.
export const maxDuration = 60;

/**
 * Proxies remote video through our origin so the browser can download with a filename
 * and avoid some hotlink/CORS issues. For very long CDN URLs, use POST (see below).
 *
 * POST buffers the full body before responding — streaming `upstream.body` through Next dev
 * has caused browser `fetch()` to fail with generic "fetch failed" on large MP4s.
 */
const BASE_UPSTREAM = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
};

function looksLikeInstagramCdn(targetUrl) {
  try {
    const h = new URL(targetUrl).hostname;
    return /instagram|cdninstagram|fbcdn\.net|facebook\.com/i.test(h);
  } catch {
    return false;
  }
}

/** Instagram/Facebook CDNs often return HTML or 403 bytes without a browser-like Referer. */
function buildUpstreamHeaders(targetUrl, { range } = {}) {
  const headers = { ...BASE_UPSTREAM };
  if (looksLikeInstagramCdn(targetUrl)) {
    headers.Referer = "https://www.instagram.com/";
    headers.Origin = "https://www.instagram.com";
  }
  if (range) {
    headers.Range = range;
  }
  return headers;
}

function upstreamLooksWrongForVideo(upstream) {
  const ct = (upstream.headers.get("content-type") || "").toLowerCase();
  if (ct.startsWith("image/") || ct.startsWith("video/")) return false;
  if (ct.includes("text/html") || ct.includes("application/json")) return true;
  return false;
}

function looksLikeInstagramMediaPageUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return false;
  try {
    const u = new URL(s);
    if (!/(^|\.)instagram\.com$/i.test(u.hostname)) return false;
    return /\/(?:[A-Za-z0-9._-]+\/)?(?:reel|reels|p|tv)\//i.test(u.pathname || "");
  } catch {
    return false;
  }
}

function parseShortcode(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const m = s.match(/\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]{5,})/i);
  return m ? m[1] : "";
}

function shortcodeFromFilename(filename) {
  const s = String(filename || "").trim();
  if (!s) return "";
  const m = s.match(/instagram-([A-Za-z0-9_-]{5,})\.(?:mp4|m4v|mov|webm)$/i);
  return m ? m[1] : "";
}

function resolveFfmpegBinary() {
  const fromEnv =
    process.env.FFMPEG_PATH?.trim() ||
    process.env.FFMPEG_BINARY?.trim() ||
    "";
  if (fromEnv) return fromEnv;
  const probe = spawnSync("/bin/sh", ["-lc", "command -v ffmpeg"], { encoding: "utf8" });
  const p = String(probe.stdout || "").trim().split("\n")[0].trim();
  return p || "ffmpeg";
}

function resolveFfprobeBinary() {
  const fromEnv = process.env.FFPROBE_PATH?.trim() || "";
  if (fromEnv) return fromEnv;
  const probe = spawnSync("/bin/sh", ["-lc", "command -v ffprobe"], { encoding: "utf8" });
  const p = String(probe.stdout || "").trim().split("\n")[0].trim();
  return p || "ffprobe";
}

function ffprobeAudioStreamCount(mediaPath) {
  const ffprobe = resolveFfprobeBinary();
  const r = spawnSync(
    ffprobe,
    [
      "-v",
      "error",
      "-select_streams",
      "a",
      "-show_entries",
      "stream=index",
      "-of",
      "csv=p=0",
      mediaPath,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    return null;
  }
  const lines = String(r.stdout || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  return lines.length;
}

function pickMediaFileFromTempDir(tempDir) {
  const files = fs.readdirSync(tempDir);
  const picked = files.find((f) => /\.(mp4|m4v|mov|webm)$/i.test(f)) || files[0];
  if (!picked) return null;
  return path.join(tempDir, picked);
}

function contentTypeForExt(ext) {
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  return "video/mp4";
}

function getCobaltBaseUrlForFileRoute() {
  const fromEnv =
    process.env.COBALT_INSTANCE_URL?.trim() ||
    process.env.COBALT_URL?.trim() ||
    "";
  return fromEnv || "http://127.0.0.1:9000";
}

function cobaltPostJson(base, payload) {
  const endpoint = `${base.replace(/\/$/, "")}/`;
  const u = new URL(endpoint);
  const bodyStr = JSON.stringify(payload);
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "Content-Length": Buffer.byteLength(bodyStr, "utf8"),
  };
  return new Promise((resolve, reject) => {
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method: "POST",
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode || 0,
            rawText: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}

function cobaltExtractVideoUrl(data) {
  if (!data || typeof data !== "object") return null;
  const u = data.url;
  if (typeof u !== "string") return null;
  if (u.startsWith("http")) return u;
  if (u.startsWith("//")) return `https:${u}`;
  return null;
}

async function resolveViaCobaltDirect(sourceForMux) {
  const base = getCobaltBaseUrlForFileRoute();
  const payload = {
    url: sourceForMux,
    videoQuality: "max",
    downloadMode: "auto",
  };
  const res = await cobaltPostJson(base, payload);
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`cobalt_http_${res.statusCode}`);
  }
  let data = {};
  try {
    data = res.rawText ? JSON.parse(res.rawText) : {};
  } catch {
    throw new Error("cobalt_non_json");
  }
  const status = String(data?.status || "");
  const direct = cobaltExtractVideoUrl(data);
  if ((status === "success" || status === "tunnel" || status === "redirect") && direct) {
    return { videoUrl: direct, cobaltStatus: status };
  }
  if (status === "picker" && Array.isArray(data?.picker) && data.picker.length) {
    const p = data.picker.find((x) => x && typeof x.url === "string" && /^https?:\/\//i.test(x.url));
    if (p?.url) return { videoUrl: p.url, cobaltStatus: status };
  }
  throw new Error(`cobalt_no_url_${status || "unknown"}`);
}

function runYtDlpOnce(sourceUrl, cookieObjects, formatString) {
  const bin =
    process.env.YTDLP_PATH?.trim() ||
    process.env.YT_DLP_PATH?.trim() ||
    "yt-dlp";
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ig-file-"));
  const outputTemplate = path.join(tempDir, "download.%(ext)s");
  let cookiePath = null;
  if (Array.isArray(cookieObjects) && cookieObjects.length) {
    cookiePath = path.join(tempDir, "cookies.txt");
    writeNetscapeCookiesFromBrowserArray(cookieObjects, cookiePath);
  }
  const ffmpeg = resolveFfmpegBinary();
  const args = [
    "--no-playlist",
    "--socket-timeout",
    "50",
    "--retries",
    "2",
    "--ffmpeg-location",
    ffmpeg,
    "-f",
    formatString,
    "--merge-output-format",
    "mp4",
    "-o",
    outputTemplate,
  ];
  if (cookiePath) {
    args.push("--cookies", cookiePath);
  }
  args.push(sourceUrl);

  return new Promise((resolve, reject) => {
    const stderrChunks = [];
    const child = spawn(bin, args, { env: process.env });
    child.stderr.on("data", (d) => stderrChunks.push(d));
    child.on("error", (err) => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        /* noop */
      }
      reject(err);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        const detail = Buffer.concat(stderrChunks).toString("utf8") || `yt-dlp exit ${code}`;
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
          /* noop */
        }
        reject(new Error(detail));
        return;
      }
      try {
        const outPath = pickMediaFileFromTempDir(tempDir);
        if (!outPath) {
          throw new Error("yt-dlp produced no output file");
        }
        const buf = fs.readFileSync(outPath);
        const ext = path.extname(outPath).toLowerCase();
        const ct = contentTypeForExt(ext);
        const audioStreams = ffprobeAudioStreamCount(outPath);
        fs.rmSync(tempDir, { recursive: true, force: true });
        resolve({ buf, contentType: ct, audioStreams, stderr: Buffer.concat(stderrChunks).toString("utf8") });
      } catch (err) {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
          /* noop */
        }
        reject(err);
      }
    });
  });
}

async function runYtDlpMuxedDownload(sourceUrl, cookieObjects) {
  const formatAttempts = [
    "bv*+ba/bestaudio/b",
    "bestvideo*+bestaudio/best",
    "bv*+ba/b",
    "b",
  ];
  let lastErr = null;
  for (let i = 0; i < formatAttempts.length; i += 1) {
    try {
      const attempt = await runYtDlpOnce(sourceUrl, cookieObjects, formatAttempts[i]);
      if (attempt.audioStreams == null) {
        lastErr = new Error("ffprobe_failed_to_count_audio_streams");
        continue;
      }
      if (attempt.audioStreams > 0) {
        return { buf: attempt.buf, contentType: attempt.contentType, formatUsed: formatAttempts[i] };
      }
      lastErr = new Error(`yt_dlp_output_has_no_audio_streams (format=${formatAttempts[i]})`);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr || new Error("yt_dlp_mux_failed");
}

export async function downloadInstagramReelFileGet(request) {
  const { searchParams } = new URL(request.url);
  const preferMuxedAudio = searchParams.get("preferMuxedAudio") === "1";
  const sourceUrl = String(searchParams.get("sourceUrl") || "").trim();
  const requestedFilename =
    String(searchParams.get("filename") || "instagram-reel.mp4").replace(/[^\w.\-]+/g, "_") ||
    "instagram-reel.mp4";
  const raw = searchParams.get("url")?.trim();
  const disposition = searchParams.get("download") === "0" ? "inline" : "attachment";

  if (preferMuxedAudio) {
    const sourceShortcode =
      String(searchParams.get("shortcode") || "").trim() ||
      parseShortcode(sourceUrl) ||
      shortcodeFromFilename(requestedFilename);
    const sourceForMux = looksLikeInstagramMediaPageUrl(sourceUrl)
      ? sourceUrl
      : sourceShortcode
        ? `https://www.instagram.com/reel/${sourceShortcode}/`
        : "";
    if (!sourceForMux) {
      return httpJson(
        {
          error: "Unable to determine Instagram source URL for muxed preview",
          detail: "Provide sourceUrl or shortcode when preferMuxedAudio=1.",
        },
        { status: 422 },
      );
    }
    try {
      const cobalt = await resolveViaCobaltDirect(sourceForMux);
      const upstreamHeaders = buildUpstreamHeaders(cobalt.videoUrl);
      const upstream = await fetch(cobalt.videoUrl, {
        headers: upstreamHeaders,
        redirect: "follow",
      });
      if (!upstream.ok || !upstream.body) {
        throw new Error(`cobalt_upstream_http_${upstream.status}`);
      }
      if (upstreamLooksWrongForVideo(upstream)) {
        const peek = await upstream.text();
        throw new Error(`cobalt_upstream_not_video: ${peek.slice(0, 240)}`);
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      const out = new Headers();
      out.set("Content-Type", upstream.headers.get("content-type") || "video/mp4");
      out.set(
        "Content-Disposition",
        `${disposition}; filename="${requestedFilename.replace(/"/g, "")}"`,
      );
      out.set("Cache-Control", "private, max-age=30");
      out.set("Content-Length", String(buf.length));
      out.set("x-locava-download-path", `cobalt:${cobalt.cobaltStatus}`);
      return httpBinary(buf, 200, out);
    } catch {
      // Fall through to ytdlp verified-audio path.
    }

    try {
      const muxed = await runYtDlpMuxedDownload(sourceForMux, []);
      const out = new Headers();
      out.set("Content-Type", muxed.contentType || "video/mp4");
      out.set(
        "Content-Disposition",
        `${disposition}; filename="${requestedFilename.replace(/"/g, "")}"`,
      );
      out.set("Cache-Control", "private, max-age=30");
      out.set("Content-Length", String(muxed.buf.length));
      if (muxed.formatUsed) {
        out.set("x-locava-ytdlp-format", String(muxed.formatUsed).slice(0, 120));
      }
      out.set("x-locava-download-path", "ytdlp_fallback");
      return httpBinary(muxed.buf, 200, out);
    } catch (e) {
      return httpJson(
        {
          error: "yt-dlp muxed preview failed",
          sourceForMux,
          detail: String(e?.message || e).slice(0, 1200),
        },
        { status: 502 },
      );
    }
  }

  if (!raw) {
    return httpJson({ error: "Missing url" }, 400);
  }

  let target;
  try {
    target = decodeURIComponent(raw);
  } catch {
    return httpJson({ error: "Bad url encoding" }, 400);
  }

  if (!/^https:\/\//i.test(target)) {
    return httpJson({ error: "Only https URLs are allowed" }, 400);
  }

  const range = request.headers.get("Range") || undefined;
  const upstreamHeaders = buildUpstreamHeaders(target, { range });

  let upstream;
  try {
    upstream = await fetch(target, { headers: upstreamHeaders, redirect: "follow" });
  } catch (e) {
    return httpJson(
      { error: "Failed to fetch video", detail: String(e?.message || e) },
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    return httpJson(
      { error: "Upstream returned error", status: upstream.status },
      { status: 502 },
    );
  }

  if (upstreamLooksWrongForVideo(upstream)) {
    const peek = await upstream.text();
    return httpJson(
      {
        error: "Upstream did not return video data (often missing Referer or expired URL).",
        detail: peek.slice(0, 280),
      },
      { status: 502 },
    );
  }

  const ct = upstream.headers.get("content-type") || "video/mp4";
  const filename =
    searchParams.get("filename")?.replace(/[^\w.\-]+/g, "_") || "instagram-reel.mp4";

  const out = new Headers();
  out.set("Content-Type", ct);
  out.set(
    "Content-Disposition",
    `${disposition}; filename="${filename.replace(/"/g, "")}"`,
  );
  out.set("Cache-Control", "private, max-age=300");
  const acl = upstream.headers.get("Content-Length");
  if (acl) out.set("Content-Length", acl);
  const cr = upstream.headers.get("Content-Range");
  if (cr) out.set("Content-Range", cr);
  const ar = upstream.headers.get("Accept-Ranges");
  if (ar) out.set("Accept-Ranges", ar);

  return httpBinary(upstream.body, upstream.status, out);
}

export async function downloadInstagramReelFile(body) {

  const target = String(body?.url || "").trim();
  const download = body?.download !== false;
  const sourceUrl = String(body?.sourceUrl || "").trim();
  const resolverMethod = String(body?.resolverMethod || "").trim().toLowerCase();
  const postedCookies = Array.isArray(body?.cookies) ? body.cookies : [];
  const preferMuxedAudio = body?.preferMuxedAudio === true;
  const requestedFilename =
    String(body?.filename || "instagram-reel.mp4").replace(/[^\w.\-]+/g, "_") ||
    "instagram-reel.mp4";

  if (!target || !/^https:\/\//i.test(target)) {
    return httpJson({ error: "Missing or invalid url" }, 400);
  }

  const sourceShortcode =
    String(body?.shortcode || "").trim() ||
    parseShortcode(sourceUrl) ||
    parseShortcode(target) ||
    shortcodeFromFilename(requestedFilename);
  const sourceForMux = looksLikeInstagramMediaPageUrl(sourceUrl)
    ? sourceUrl
    : sourceShortcode
      ? `https://www.instagram.com/reel/${sourceShortcode}/`
      : "";
  const shouldUseYtDlpMux =
    Boolean(sourceForMux) && (resolverMethod === "ytdlp" || preferMuxedAudio);

  if (shouldUseYtDlpMux) {
    try {
      try {
        const cobalt = await resolveViaCobaltDirect(sourceForMux);
        const upstreamHeaders = buildUpstreamHeaders(cobalt.videoUrl);
        const upstream = await fetch(cobalt.videoUrl, { headers: upstreamHeaders, redirect: "follow" });
        if (!upstream.ok || !upstream.body) {
          throw new Error(`cobalt_upstream_http_${upstream.status}`);
        }
        if (upstreamLooksWrongForVideo(upstream)) {
          const peek = await upstream.text();
          throw new Error(`cobalt_upstream_not_video: ${peek.slice(0, 240)}`);
        }
        const buf = Buffer.from(await upstream.arrayBuffer());
        const filename = requestedFilename;
        const disp = download ? "attachment" : "inline";
        const out = new Headers();
        out.set("Content-Type", upstream.headers.get("content-type") || "video/mp4");
        out.set("Content-Disposition", `${disp}; filename="${filename.replace(/"/g, "")}"`);
        out.set("Cache-Control", "private, max-age=60");
        out.set("Content-Length", String(buf.length));
        out.set("x-locava-download-path", `cobalt:${cobalt.cobaltStatus}`);
        return httpBinary(buf, 200, out);
      } catch {
        // Fall through to ytdlp verified-audio path.
      }
      const muxed = await runYtDlpMuxedDownload(sourceForMux, postedCookies);
      const filename = requestedFilename;
      const disp = download ? "attachment" : "inline";
      const out = new Headers();
      out.set("Content-Type", muxed.contentType || "video/mp4");
      out.set("Content-Disposition", `${disp}; filename="${filename.replace(/"/g, "")}"`);
      out.set("Cache-Control", "private, max-age=60");
      out.set("Content-Length", String(muxed.buf.length));
      if (muxed.formatUsed) {
        out.set("x-locava-ytdlp-format", String(muxed.formatUsed).slice(0, 120));
      }
      out.set("x-locava-download-path", "ytdlp_fallback");
      return httpBinary(muxed.buf, 200, out);
    } catch (e) {
      return httpJson(
        {
          error: "yt-dlp muxed download failed",
          sourceForMux,
          detail: String(e?.message || e).slice(0, 1200),
        },
        { status: 502 },
      );
    }
  }

  if (preferMuxedAudio) {
    return httpJson(
      {
        error: "Unable to determine Instagram source URL for muxed audio download",
        detail: "Send sourceUrl or shortcode with preferMuxedAudio=true.",
      },
      { status: 422 },
    );
  }

  const upstreamHeaders = buildUpstreamHeaders(target);

  let upstream;
  try {
    upstream = await fetch(target, { headers: upstreamHeaders, redirect: "follow" });
  } catch (e) {
    return httpJson(
      { error: "Failed to fetch video", detail: String(e?.message || e) },
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    return httpJson(
      { error: "Upstream returned error", status: upstream.status },
      { status: 502 },
    );
  }

  if (upstreamLooksWrongForVideo(upstream)) {
    const peek = await upstream.text();
    return httpJson(
      {
        error: "Upstream did not return video data (often missing Referer or expired URL).",
        detail: peek.slice(0, 280),
      },
      { status: 502 },
    );
  }

  const ct = upstream.headers.get("content-type") || "video/mp4";
  const filename =
    String(body?.filename || "instagram-reel.mp4").replace(/[^\w.\-]+/g, "_") || "instagram-reel.mp4";
  const disp = download ? "attachment" : "inline";

  const buf = Buffer.from(await upstream.arrayBuffer());

  const out = new Headers();
  out.set("Content-Type", ct);
  out.set("Content-Disposition", `${disp}; filename="${filename.replace(/"/g, "")}"`);
  out.set("Cache-Control", "private, max-age=300");
  out.set("Content-Length", String(buf.length));

  return httpBinary(buf, upstream.status, out);
}
