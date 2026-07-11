// @ts-nocheck
/** Ported from Locava Web instagram-reel resolve — Backendv2 native */

function httpJson(body, status = 200) {
  return {
    kind: 'json',
    status,
    contentType: 'application/json; charset=utf-8',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import http from "http";
import https from "https";
import { getCobaltBaseUrl, getCobaltEnvProbeInfo } from "./cobaltConfig.js";
import {
  parseInstagramCookiesFromBody,
  cookieObjectsToHeaderString,
  writeNetscapeCookiesFromBrowserArray,
} from "./instagramCookieHelpers.js";
import {
  resolveInstagramPublicGraphql,
  resolveInstagramEmbedScrape,
} from "./instagramGraphqlResolve.js";
import {
  pickBestInstagramVideoCandidate,
  pickBestInstagramVideoUrl,
} from "./videoQuality.js";

/** Force Node; avoid edge quirks with localhost / env. */
const IG_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Referer: "https://www.instagram.com/",
};

function exposeResolveDebug() {
  return (
    process.env.NODE_ENV === "development" ||
    process.env.INSTAGRAM_RESOLVE_DEBUG === "1"
  );
}

function shouldExposeDebug(opts) {
  if (exposeResolveDebug()) return true;
  return Boolean(opts?.debug);
}

function truncateUrl(u, max = 160) {
  if (!u || typeof u !== "string") return null;
  return u.length <= max ? u : `${u.slice(0, max)}… (${u.length} chars)`;
}

/** Cobalt POST via Node http(s) — some environments break fetch() to 127.0.0.1. */
function cobaltPostJson(base, payload, headers) {
  const endpoint = `${base.replace(/\/$/, "")}/`;
  const u = new URL(endpoint);
  const bodyStr = JSON.stringify(payload);
  const h = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "Content-Length": Buffer.byteLength(bodyStr, "utf8"),
    ...headers,
  };

  return new Promise((resolve, reject) => {
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method: "POST",
        headers: h,
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

function parseShortcode(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  try {
    const u = new URL(s.includes("://") ? s : `https://${s}`);
    const path = u.pathname || "";
    const m = path.match(
      /\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]{5,})\/?/,
    );
    return m ? m[1] : null;
  } catch {
    const m = s.match(/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]{5,})/i);
    return m ? m[1] : null;
  }
}

function unescapeJsonUrl(s) {
  if (!s) return s;
  return s
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"');
}

function collectMp4Candidates(html) {
  const out = new Set();
  if (!html) return [];
  const patterns = [
    /"video_url"\s*:\s*"([^"]+)"/g,
    /"playback_url"\s*:\s*"([^"]+)"/g,
    /"url"\s*:\s*"(https:\\\/\\\/[^"]+\.mp4[^"]*)"/g,
    /https:\\\/\\\/scontent[^"\\]+\.mp4[^"\\]*/g,
    /https:\/\/scontent[^"'\\\s]+\.mp4[^\s"'\\]*/g,
  ];
  for (const re of patterns) {
    let m;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(html)) !== null) {
      const u = unescapeJsonUrl(m[1] || m[0]);
      if (u && u.includes("http") && /\.mp4/i.test(u)) out.add(u.split("\\")[0]);
    }
  }
  return [...out];
}

function pickBestVideoUrl(urls) {
  return pickBestInstagramVideoUrl((Array.isArray(urls) ? urls : []).map((url) => ({ url })));
}

async function fetchText(url, extraHeaders = {}) {
  const res = await fetch(url, {
    headers: { ...IG_HEADERS, ...extraHeaders },
    redirect: "follow",
  });
  if (!res.ok) return null;
  return res.text();
}

async function scrapeInstagramPage(canonicalUrl, cookieHeader) {
  const extra = cookieHeader ? { Cookie: cookieHeader } : {};
  const html = await fetchText(canonicalUrl, extra);
  if (!html) return null;
  const urls = collectMp4Candidates(html);
  const videoUrl = pickBestVideoUrl(urls);
  return videoUrl ? { videoUrl, thumbnailUrl: null, title: null } : null;
}

function normalizeUrlForCobalt(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  try {
    return new URL(s.includes("://") ? s : `https://${s}`).href;
  } catch {
    return s;
  }
}

function cobaltExtractVideoUrl(data) {
  if (!data || typeof data !== "object") return null;
  const u = data.url;
  if (typeof u !== "string") return null;
  if (u.startsWith("http")) return u;
  if (u.startsWith("//")) return `https:${u}`;
  return null;
}

function inferCobaltPickerHasAudio(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (typeof entry.hasAudio === "boolean") return entry.hasAudio;
  if (typeof entry.audio === "boolean") return entry.audio;
  if (typeof entry.muted === "boolean") return !entry.muted;
  if (typeof entry.noAudio === "boolean") return !entry.noAudio;
  const acodec = String(entry.acodec || entry.audioCodec || "").trim().toLowerCase();
  if (!acodec) return null;
  if (acodec === "none" || acodec === "null") return false;
  return true;
}

async function resolveViaCobalt(cobaltUrl, log) {
  const base = getCobaltBaseUrl();
  if (!base) {
    log.push({
      step: "cobalt",
      skipped: true,
      reason: "COBALT_INSTANCE_URL / COBALT_URL not set in this Node process",
    });
    return null;
  }

  const apiKey = process.env.COBALT_API_KEY?.trim();
  const headers = {
    ...(apiKey ? { Authorization: `Api-Key ${apiKey}` } : {}),
  };

  const payload = {
    url: cobaltUrl,
    videoQuality: "max",
    downloadMode: "auto",
  };

  const t0 = Date.now();
  let res = null;
  let rawText = "";
  let transport = "unknown";

  try {
    const endpoint = `${base}/`;
    const resFetch = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    rawText = await resFetch.text();
    res = { statusCode: resFetch.status, ok: resFetch.ok };
    transport = "fetch";
  } catch (fetchErr) {
    log.push({
      step: "cobalt",
      transport: "fetch",
      ms: Date.now() - t0,
      error: String(fetchErr?.message || fetchErr),
      hint: "Retrying with Node http(s)…",
    });
    try {
      const nodeRes = await cobaltPostJson(base, payload, headers);
      rawText = nodeRes.rawText;
      res = { statusCode: nodeRes.statusCode, ok: nodeRes.statusCode >= 200 && nodeRes.statusCode < 300 };
      transport = "http";
    } catch (httpErr) {
      log.push({
        step: "cobalt",
        transport: "http_fallback",
        ms: Date.now() - t0,
        error: String(httpErr?.message || httpErr),
        cobaltBase: base,
      });
      return { error: `cobalt_unreachable: ${String(fetchErr?.message || fetchErr)}` };
    }
  }

  let data;
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch (parseErr) {
    log.push({
      step: "cobalt",
      transport,
      ms: Date.now() - t0,
      httpStatus: res?.statusCode,
      parseError: String(parseErr?.message || parseErr),
      bodySnippet: rawText.slice(0, 400),
    });
    return { error: `cobalt_non_json_${res?.statusCode || 0}` };
  }

  if (exposeResolveDebug()) {
    console.log("[instagram-reel] COBALT RESPONSE:", JSON.stringify(data));
  }

  log.push({
    step: "cobalt",
    transport,
    ms: Date.now() - t0,
    httpStatus: res?.statusCode,
    cobaltStatus: data.status,
    hasUrl: Boolean(data.url),
    urlPreview: truncateUrl(typeof data.url === "string" ? data.url : ""),
    cobaltBase: base,
  });

  if (!res?.ok) {
    const code = data?.error?.code || data?.status || `cobalt_http_${res.statusCode}`;
    return { error: typeof code === "string" ? code : `cobalt_http_${res.statusCode}` };
  }

  if (!data || typeof data !== "object") {
    return { error: "cobalt_empty_response" };
  }

  const status = data.status;

  if (status === "tunnel" || status === "redirect") {
    const videoUrl = cobaltExtractVideoUrl(data);
    if (videoUrl) {
      return {
        videoUrl,
        filename: data.filename || null,
        title: null,
        thumbnailUrl: null,
        method: "cobalt",
      };
    }
    return {
      error: "cobalt_missing_url",
      detail: JSON.stringify(data).slice(0, 300),
    };
  }

  if (status === "success" && cobaltExtractVideoUrl(data)) {
    return {
      videoUrl: cobaltExtractVideoUrl(data),
      filename: data.filename || null,
      title: null,
      thumbnailUrl: null,
      method: "cobalt",
    };
  }

  if (status === "picker" && Array.isArray(data.picker) && data.picker.length) {
    const pickerCandidates = data.picker
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        ...entry,
        hasAudio: inferCobaltPickerHasAudio(entry),
        bitrate: entry?.bitrate ?? entry?.bandwidth,
        contentLength: entry?.contentLength ?? entry?.size,
      }));
    const bestPickerItem = pickBestInstagramVideoCandidate(
      pickerCandidates,
    );
    if (bestPickerItem?.url) {
      log.push({
        step: "cobalt_picker_choice",
        hasAudio: bestPickerItem?.hasAudio ?? null,
        totalCandidates: pickerCandidates.length,
      });
      return {
        videoUrl: bestPickerItem.url,
        thumbnailUrl: bestPickerItem.raw?.thumb || null,
        title: null,
        method: "cobalt",
      };
    }
  }

  if (status === "error") {
    return { error: data.error?.code || "cobalt_error" };
  }

  return { error: "cobalt_unexpected_response" };
}

/** Netscape cookies.txt for Instagram — same idea as Cobalt's COOKIE_PATH but yt-dlp format. */
function getYtDlpCookieFilePath() {
  const p =
    process.env.YTDLP_COOKIES_FILE?.trim() ||
    process.env.INSTAGRAM_COOKIES_TXT?.trim() ||
    "";
  return p;
}

/** Instagram often returns DASH or split formats — top-level `url` may be absent. */
function pickVideoUrlFromYtDlpJson(j) {
  if (!j || typeof j !== "object") return null;
  const candidates = [];
  if (typeof j.url === "string" && j.url.startsWith("http")) {
    candidates.push({
      url: j.url,
      width: j.width,
      height: j.height,
      bitrate: j.tbr ?? j.vbr,
      filesize: j.filesize ?? j.filesize_approx,
      hasAudio: true,
      protocol: j.protocol,
      ext: j.ext,
    });
  }

  const requested = Array.isArray(j.requested_formats)
    ? j.requested_formats
    : j.requested_formats && typeof j.requested_formats === "object"
      ? [j.requested_formats]
      : [];
  requested.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const url = typeof entry.url === "string" ? entry.url : "";
    const vcodec = String(entry.vcodec || "").toLowerCase();
    if (!url.startsWith("http")) return;
    if (vcodec === "none") return;
    if (!vcodec && !entry.width && !entry.height) return;
    candidates.push({
      url,
      width: entry.width,
      height: entry.height,
      bitrate: entry.tbr ?? entry.vbr,
      filesize: entry.filesize ?? entry.filesize_approx,
      hasAudio:
        typeof entry.acodec === "string" ? String(entry.acodec).toLowerCase() !== "none" : undefined,
      protocol: entry.protocol,
      ext: entry.ext,
      acodec: entry.acodec,
    });
  });

  const formats = Array.isArray(j.formats) ? j.formats : [];
  formats.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const url = typeof entry.url === "string" ? entry.url : "";
    const vcodec = String(entry.vcodec || "").toLowerCase();
    if (!url.startsWith("http") || !vcodec || vcodec === "none") return;
    candidates.push({
      url,
      width: entry.width,
      height: entry.height,
      bitrate: entry.tbr ?? entry.vbr,
      filesize: entry.filesize ?? entry.filesize_approx,
      hasAudio:
        typeof entry.acodec === "string" ? String(entry.acodec).toLowerCase() !== "none" : undefined,
      protocol: entry.protocol,
      ext: entry.ext,
      acodec: entry.acodec,
    });
  });

  const best = pickBestInstagramVideoCandidate(candidates);
  return best?.url || null;
}

function runYtDlpJson(url, cookieFileOverride) {
  const bin =
    process.env.YTDLP_PATH?.trim() ||
    process.env.YT_DLP_PATH?.trim() ||
    "yt-dlp";
  const cookieFile = cookieFileOverride || getYtDlpCookieFilePath();
  const args = [
    "-j",
    "--no-download",
    "--no-warnings",
    "--socket-timeout",
    "50",
    "--retries",
    "2",
  ];
  if (cookieFile) {
    args.push("--cookies", cookieFile);
  }
  args.push(url);
  return new Promise((resolve, reject) => {
    const chunks = [];
    const errChunks = [];
    const child = spawn(bin, args, {
      env: process.env,
    });
    child.stdout.on("data", (d) => chunks.push(d));
    child.stderr.on("data", (d) => errChunks.push(d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            Buffer.concat(errChunks).toString("utf8") || `yt-dlp exit ${code}`,
          ),
        );
        return;
      }
      try {
        const txt = Buffer.concat(chunks).toString("utf8");
        const j = JSON.parse(txt);
        resolve(j);
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function resolveViaYtDlp(pageUrl, log, cookieFileOverride) {
  if (process.env.INSTAGRAM_DISABLE_YTDLP === "1") {
    log.push({ step: "yt-dlp", skipped: true, reason: "INSTAGRAM_DISABLE_YTDLP=1" });
    return null;
  }
  const t0 = Date.now();
  try {
    const j = await runYtDlpJson(pageUrl, cookieFileOverride);
    const u = pickVideoUrlFromYtDlpJson(j);
    log.push({
      step: "yt-dlp",
      ms: Date.now() - t0,
      ok: Boolean(u),
      bin: process.env.YTDLP_PATH || process.env.YT_DLP_PATH || "yt-dlp",
      cookiesFromFile: Boolean(cookieFileOverride || getYtDlpCookieFilePath()),
    });
    if (u && typeof u === "string") {
      return {
        videoUrl: u,
        title: j.title || j.description || null,
        thumbnailUrl: j.thumbnail || null,
        method: "ytdlp",
      };
    }
  } catch (e) {
    log.push({
      step: "yt-dlp",
      ms: Date.now() - t0,
      ok: false,
      error: String(e?.message || e).slice(0, 800),
    });
  }
  return null;
}

/** Try /reel/, /p/, /tv/ — some items only resolve on one path. */
async function resolveViaYtDlpFirstMatch(candidateUrls, log, cookieFileOverride) {
  let last = null;
  for (let i = 0; i < candidateUrls.length; i++) {
    const u = candidateUrls[i];
    if (i > 0) {
      log.push({
        step: "yt-dlp_retry",
        attempt: i + 1,
        url: truncateUrl(u, 200),
      });
    }
    last = await resolveViaYtDlp(u, log, cookieFileOverride);
    if (last?.videoUrl) return last;
  }
  return last;
}

function canonicalPageUrl(shortcode) {
  return `https://www.instagram.com/reel/${shortcode}/`;
}

/**
 * Cobalt fetches the URL you send. Profile-prefixed links like
 * instagram.com/{username}/reel/{code} often return empty HTML to automated
 * fetches (login walls, different routing), yielding error.api.fetch.empty.
 * Always try canonical /reel/, /p/, /tv/ before giving up.
 */
function buildCobaltCandidateUrls(shortcode) {
  const s = String(shortcode || "").trim();
  if (!s) return [];
  return [
    `https://www.instagram.com/reel/${s}/`,
    `https://www.instagram.com/p/${s}/`,
    `https://www.instagram.com/tv/${s}/`,
  ];
}

/** Retry with a different path only when Cobalt failed in a way another URL might fix. */
function shouldTryAlternateCobaltUrl(result) {
  if (!result || result.videoUrl) return false;
  const e = String(result.error || "");
  if (!e) return false;
  if (e.startsWith("cobalt_unreachable")) return false;
  if (e.startsWith("cobalt_non_json")) return false;
  return true;
}

async function resolveViaCobaltFirstMatch(candidateUrls, log) {
  let last = null;
  for (let i = 0; i < candidateUrls.length; i++) {
    const u = candidateUrls[i];
    if (i > 0) {
      log.push({
        step: "cobalt_retry",
        attempt: i + 1,
        url: truncateUrl(u, 200),
      });
    }
    last = await resolveViaCobalt(u, log);
    if (last?.videoUrl) return last;
    if (!shouldTryAlternateCobaltUrl(last)) break;
  }
  return last;
}

/**
 * Optional escape hatch: set INSTAGRAM_REMOTE_RESOLVER_URL to your own worker that accepts
 * POST JSON { url } and returns { videoUrl } or { url } (e.g. internal FastDl-like service).
 */
async function resolveViaRemoteResolver(pageUrl, log) {
  const endpoint = process.env.INSTAGRAM_REMOTE_RESOLVER_URL?.trim();
  if (!endpoint) return null;
  const t0 = Date.now();
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(process.env.INSTAGRAM_REMOTE_RESOLVER_KEY?.trim()
          ? {
              Authorization: `Bearer ${process.env.INSTAGRAM_REMOTE_RESOLVER_KEY.trim()}`,
            }
          : {}),
      },
      body: JSON.stringify({ url: pageUrl }),
      signal: AbortSignal.timeout(
        Math.min(
          Number(process.env.INSTAGRAM_REMOTE_RESOLVER_TIMEOUT_MS) || 28000,
          120000,
        ),
      ),
      cache: "no-store",
    });
    const raw = await res.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      log.push({
        step: "remote_resolver",
        ok: false,
        ms: Date.now() - t0,
        httpStatus: res.status,
        parseError: true,
      });
      return null;
    }
    const videoUrl =
      (typeof data.videoUrl === "string" && data.videoUrl) ||
      (typeof data.url === "string" && data.url.startsWith("http") ? data.url : null);
    if (videoUrl && res.ok) {
      log.push({ step: "remote_resolver", ok: true, ms: Date.now() - t0 });
      return {
        videoUrl,
        filename: data.filename || null,
        title: data.title || null,
        thumbnailUrl: data.thumbnailUrl || null,
        method: "remote_resolver",
      };
    }
    log.push({
      step: "remote_resolver",
      ok: false,
      ms: Date.now() - t0,
      httpStatus: res.status,
    });
  } catch (e) {
    log.push({
      step: "remote_resolver",
      ok: false,
      ms: Date.now() - t0,
      error: String(e?.message || e).slice(0, 200),
    });
  }
  return null;
}

async function runInstagramScrapeFallbacks(shortcode, pageUrl, cookieHeaderForScrape, steps) {
  let scraped = await scrapeInstagramPage(pageUrl, cookieHeaderForScrape);
  if (!scraped) {
    scraped = await scrapeInstagramPage(
      `https://www.instagram.com/p/${shortcode}/`,
      cookieHeaderForScrape,
    );
  }
  if (!scraped) {
    scraped = await scrapeInstagramPage(
      `https://www.instagram.com/p/${shortcode}/embed/`,
      cookieHeaderForScrape,
    );
  }
  if (!scraped) {
    scraped = await scrapeInstagramPage(
      `https://www.instagram.com/reel/${shortcode}/embed/`,
      cookieHeaderForScrape,
    );
  }
  steps.push({ step: "scrape", ok: Boolean(scraped?.videoUrl) });
  return scraped;
}

function buildResolveLog(ctx, opts) {
  const {
    shortcode,
    cobaltBase,
    steps,
    pageUrl,
    inputUrl,
    finalError,
  } = opts;
  return {
    at: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV,
    cobaltConfigured: Boolean(cobaltBase),
    cobaltBase: cobaltBase || null,
    shortcode,
    pageUrl,
    inputUrl,
    userAgent: opts?.userAgent?.slice(0, 120) || null,
    steps,
    finalError: finalError || null,
  };
}

/** Same-origin probe (avoids a separate /cobalt-status route that some setups 404 as HTML). */
export async function instagramReelProbe() {
  const base = getCobaltBaseUrl();
  const probe = getCobaltEnvProbeInfo();
  const msg =
    probe.cobaltSource === "env"
      ? "Using COBALT_INSTANCE_URL from env. POST /admin/instagram-downloader/api/resolve will call Cobalt."
      : `Using hardcoded default Cobalt URL (${probe.cobaltDefault}). Set COBALT_INSTANCE_URL to override in production.`;
  return httpJson({
    kind: "instagram-reel-probe",
    cobaltConfigured: true,
    cobaltBase: base || null,
    cobaltSource: probe.cobaltSource,
    cobaltDefault: probe.cobaltDefault,
    nodeEnv: process.env.NODE_ENV,
    envFiles: probe.checkedFiles,
    cwd: probe.cwd,
    lineHints: probe.lineHints,
    message: msg,
  });
}

export async function resolveInstagramReel(body, ctx = {}) {
  const steps = [];

  const { cookies: pastedCookies, error: cookieErr } =
    parseInstagramCookiesFromBody(body);
  if (cookieErr) {
    return httpJson({ error: cookieErr }, 400);
  }

  let cookieHeaderForScrape = null;
  let tempCookieDir = null;
  let tempCookiePath = null;
  if (pastedCookies?.length) {
    const { header, count } = cookieObjectsToHeaderString(pastedCookies);
    if (count === 0) {
      return httpJson(
        {
          error:
            "No usable Instagram cookies (export must include instagram.com cookie domains).",
        }, 400);
    }
    cookieHeaderForScrape = header;
    tempCookieDir = fs.mkdtempSync(path.join(os.tmpdir(), "ig-resolve-"));
    tempCookiePath = path.join(tempCookieDir, "cookies.txt");
    writeNetscapeCookiesFromBrowserArray(pastedCookies, tempCookiePath);
    steps.push({
      step: "request_cookies",
      count,
      ytDlpNetscape: true,
    });
  }

  try {
    const inputUrl = String(body?.url || "").trim();
    if (!inputUrl) {
      return httpJson({ error: "Missing url" }, 400);
    }

    const shortcode = parseShortcode(inputUrl);
    if (!shortcode) {
      return httpJson(
        {
          error:
            "Could not read an Instagram shortcode from that link. Use a reel or post URL.",
        }, 400);
    }

    const pageUrl = canonicalPageUrl(shortcode);
    const cobaltInputUrl = normalizeUrlForCobalt(inputUrl);
    const cobaltBase = getCobaltBaseUrl();

    console.log("[instagram-reel] resolve", {
      shortcode,
      cobaltConfigured: Boolean(cobaltBase),
      cobaltBase: cobaltBase || "(not set)",
      pastedCookies: Boolean(pastedCookies?.length),
    });

    const candidateUrls = buildCobaltCandidateUrls(shortcode);
    const hasSessionCookies = Boolean(tempCookiePath);
    let cobalt = null;

    const debugLog = () =>
      shouldExposeDebug(ctx)
        ? buildResolveLog(ctx, {
            shortcode,
            cobaltBase,
            steps,
            pageUrl,
            inputUrl: cobaltInputUrl,
          })
        : undefined;

    const remote = await resolveViaRemoteResolver(pageUrl, steps);
    if (remote?.videoUrl) {
      const log = debugLog();
      return httpJson({
        ok: true,
        pageUrl,
        shortcode,
        ...remote,
        ...(log ? { resolveLog: log } : {}),
      });
    }

    /** With pasted cookies, yt-dlp + scrape are reliable; Cobalt is slow and ignores cookies — try it last. */
    if (hasSessionCookies) {
      steps.push({ step: "resolve_order", order: "session_ytdlp_then_scrape_then_cobalt" });
      const ytdlpFirst = await resolveViaYtDlpFirstMatch(
        candidateUrls,
        steps,
        tempCookiePath,
      );
      if (ytdlpFirst?.videoUrl) {
        const log = debugLog();
        return httpJson({
          ok: true,
          pageUrl,
          shortcode,
          ...ytdlpFirst,
          ...(log ? { resolveLog: log } : {}),
        });
      }

      const scrapedSession = await runInstagramScrapeFallbacks(
        shortcode,
        pageUrl,
        cookieHeaderForScrape,
        steps,
      );
      if (scrapedSession?.videoUrl) {
        const log = debugLog();
        return httpJson({
          ok: true,
          pageUrl,
          shortcode,
          ...scrapedSession,
          method: "scrape",
          ...(log ? { resolveLog: log } : {}),
        });
      }

      cobalt = await resolveViaCobaltFirstMatch(candidateUrls, steps);
      if (cobalt?.videoUrl) {
        const log = debugLog();
        return httpJson({
          ok: true,
          pageUrl,
          shortcode,
          ...cobalt,
          ...(log ? { resolveLog: log } : {}),
        });
      }
    } else {
      /** yt-dlp often survives when Cobalt gets error.api.fetch.empty from the same server IP. */
      steps.push({ step: "resolve_order", order: "ytdlp_then_cobalt_then_scrape" });
      const ytdlpNoCookie = await resolveViaYtDlpFirstMatch(
        candidateUrls,
        steps,
        tempCookiePath,
      );
      if (ytdlpNoCookie?.videoUrl) {
        const log = debugLog();
        return httpJson({
          ok: true,
          pageUrl,
          shortcode,
          ...ytdlpNoCookie,
          ...(log ? { resolveLog: log } : {}),
        });
      }

      cobalt = await resolveViaCobaltFirstMatch(candidateUrls, steps);
      if (cobalt?.videoUrl) {
        const log = debugLog();
        return httpJson({
          ok: true,
          pageUrl,
          shortcode,
          ...cobalt,
          ...(log ? { resolveLog: log } : {}),
        });
      }

      const scrapedNoCookie = await runInstagramScrapeFallbacks(
        shortcode,
        pageUrl,
        cookieHeaderForScrape,
        steps,
      );
      if (scrapedNoCookie?.videoUrl) {
        const log = debugLog();
        return httpJson({
          ok: true,
          pageUrl,
          shortcode,
          ...scrapedNoCookie,
          method: "scrape",
          ...(log ? { resolveLog: log } : {}),
        });
      }
    }

    /**
     * GraphQL + embed last: they often expose a small progressive MP4 while yt-dlp / Cobalt
     * see the full format ladder (matches typical third-party downloaders). Running GraphQL first
     * made every "session cookies" batch return ig_graphql and skip yt-dlp entirely.
     */
    if (process.env.INSTAGRAM_DISABLE_GRAPHQL !== "1") {
      steps.push({ step: "resolve_order_tail", order: "ig_graphql_then_embed_after_extractors" });
      const igGql = await resolveInstagramPublicGraphql(shortcode, steps, {
        extraCookieHeader: cookieHeaderForScrape,
      });
      if (igGql?.videoUrl) {
        const log = debugLog();
        return httpJson({
          ok: true,
          pageUrl,
          shortcode,
          ...igGql,
          ...(log ? { resolveLog: log } : {}),
        });
      }
      const igEmb = await resolveInstagramEmbedScrape(shortcode, steps);
      if (igEmb?.videoUrl) {
        const log = debugLog();
        return httpJson({
          ok: true,
          pageUrl,
          shortcode,
          ...igEmb,
          ...(log ? { resolveLog: log } : {}),
        });
      }
    }

    const hintParts = [];
    if (cobalt?.error) {
      hintParts.push(
        `Cobalt error: ${cobalt.error}${cobalt.detail ? ` (${cobalt.detail})` : ""}`,
      );
    }
    hintParts.push(
      "All resolution methods failed for this shortcode (order depends on whether session cookies were sent). See resolveLog in dev — check yt-dlp stderr for rate limits or removed media.",
    );

    const cobaltCode = cobalt?.error;
    const remediation =
      cobaltCode === "error.api.fetch.empty"
        ? {
            summary:
              "Cobalt got an empty response from Instagram for this reel (not a bad URL shape). Self-hosted Cobalt often needs Instagram cookies or a different outbound IP.",
            cobaltEnv: [
              "Set COOKIE_PATH (cookies.json next to Cobalt) per Cobalt run-an-instance docs.",
              "Optionally set API_EXTERNAL_PROXY to a residential HTTP(S) proxy if your server IP is blocked.",
            ],
            serverEnv: [
              "Paste browser-export cookies at the top of Admin → Instagram downloader (this request).",
              "Or set YTDLP_COOKIES_FILE to a Netscape cookies.txt on the server.",
            ],
          }
        : undefined;

    const resolveLog = buildResolveLog(ctx, {
      shortcode,
      cobaltBase,
      steps,
      pageUrl,
      inputUrl: cobaltInputUrl,
      finalError: "all_methods_failed",
    });

    const retryable = steps.some(
      (s) =>
        s?.rateLimited ||
        s?.emptyMedia ||
        s?.httpStatus === 429 ||
        (s?.step === "ig_graphql" &&
          s?.ok === false &&
          !s?.requireLogin),
    );

    return httpJson(
      {
        ok: false,
        error:
          "Could not resolve a direct video URL. Try again later, or configure Cobalt / yt-dlp on the server.",
        detail: hintParts.join(" "),
        pageUrl,
        shortcode,
        /** Client batching can retry 422s after Instagram throttles anonymous GraphQL. */
        retryable,
        ...(retryable ? { retryAfterMs: 2800 } : {}),
        ...(remediation ? { remediation } : {}),
        ...(shouldExposeDebug(ctx) ? { resolveLog } : {}),
      }, 422);
  } finally {
    if (tempCookieDir) {
      try {
        fs.rmSync(tempCookieDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}
