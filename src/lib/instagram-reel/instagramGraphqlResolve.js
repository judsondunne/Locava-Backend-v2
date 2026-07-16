// @ts-nocheck
/**
 * Public Instagram reel resolution (same building blocks as yt-dlp / FastDl-style tools):
 * web GraphQL + optional embed JSON. Works without user cookies when the server IP is in good standing.
 * Datacenter / rate-limited IPs get "Please wait" — callers should fall back to Cobalt / yt-dlp.
 *
 * Batched admin resolves hit Instagram's anonymous GraphQL budget quickly. We space internal
 * requests and retry the GraphQL chain when IG returns wait/rate/empty responses.
 */

import { pickBestInstagramVideoUrl } from "./videoQuality.js";

const IG_HEADERS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const IG_APP_ID = "936619743392459";
const DEFAULT_DOC_ID = "8845758582119845";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function stepDelayMs() {
  const n = Number(process.env.INSTAGRAM_GRAPHQL_STEP_DELAY_MS);
  return Number.isFinite(n) && n >= 0 ? n : 420;
}

function graphqlMaxAttempts() {
  const n = Number(process.env.INSTAGRAM_GRAPHQL_MAX_ATTEMPTS);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 8) : 4;
}

function graphqlAttemptGapMs(attemptIndex) {
  /** attemptIndex 0 = first try, no gap before it */
  const base = Number(process.env.INSTAGRAM_GRAPHQL_RETRY_BASE_MS);
  const b = Number.isFinite(base) && base > 0 ? base : 2400;
  return b * attemptIndex + Math.floor(Math.random() * 700);
}

const B64URL =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Instagram shortcode → numeric media pk (matches yt-dlp). */
export function shortcodeToMediaPk(shortcode) {
  let s = String(shortcode || "").trim();
  if (s.length > 28) s = s.slice(0, -28);
  let n = 0n;
  for (let i = 0; i < s.length; i++) {
    const v = B64URL.indexOf(s[i]);
    if (v < 0) return null;
    n = n * 64n + BigInt(v);
  }
  return n.toString();
}

function parseCookiePair(line) {
  const m = String(line || "").match(/^([^=]+)=([^;]+)/);
  if (!m) return null;
  return [m[1].trim(), m[2].trim()];
}

function mergeCookies(baseObj, setCookieHeaders) {
  const out = { ...baseObj };
  const arr = Array.isArray(setCookieHeaders)
    ? setCookieHeaders
    : setCookieHeaders
      ? [setCookieHeaders]
      : [];
  for (const line of arr) {
    const p = parseCookiePair(line);
    if (p && p[0] && p[1]) out[p[0]] = p[1];
  }
  return out;
}

function cookiesToHeader(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function parseExtraCookieHeader(header) {
  const out = {};
  if (!header || typeof header !== "string") return out;
  for (const part of header.split(";")) {
    const p = parseCookiePair(part.trim());
    if (p) out[p[0]] = p[1];
  }
  return out;
}

function pickVideoUrlFromXdtMedia(media) {
  if (!media || typeof media !== "object") return null;
  const vv = media.video_versions;
  const candidates = [];
  if (Array.isArray(vv) && vv.length) {
    /** Highest resolution / bandwidth first so tie-breakers favor the real best encode. */
    const sorted = [...vv].sort((a, b) => {
      const hb = Number(b?.height) || 0;
      const ha = Number(a?.height) || 0;
      if (hb !== ha) return hb - ha;
      const wb = Number(b?.width) || 0;
      const wa = Number(a?.width) || 0;
      if (wb !== wa) return wb - wa;
      const bb = Number(b?.bandwidth ?? b?.bitrate ?? 0) || 0;
      const ba = Number(a?.bandwidth ?? a?.bitrate ?? 0) || 0;
      return bb - ba;
    });
    sorted.forEach((entry) => {
      candidates.push({
        url: entry?.url,
        width: entry?.width,
        height: entry?.height,
        bitrate: entry?.bitrate ?? entry?.bandwidth,
        hasAudio: true,
      });
    });
  }
  /**
   * Only use top-level `video_url` when there are no `video_versions`. Otherwise IG often
   * exposes a lower-quality progressive URL while still listing better encodes in
   * `video_versions`. Feeding both into the picker is worse: `video_url` incorrectly
   * inherits `media.dimensions` and can beat every real version on height/width.
   */
  if (
    (!Array.isArray(vv) || vv.length === 0) &&
    typeof media.video_url === "string" &&
    media.video_url.startsWith("http")
  ) {
    candidates.push({
      url: media.video_url,
      width: media?.dimensions?.width,
      height: media?.dimensions?.height,
      hasAudio: true,
    });
  }
  const bestDirect = pickBestInstagramVideoUrl(candidates);
  if (bestDirect) return bestDirect;
  const edges = media.edge_sidecar_to_children?.edges;
  if (Array.isArray(edges)) {
    for (const e of edges) {
      const node = e?.node;
      if (!node?.is_video) continue;
      const u = pickVideoUrlFromXdtMedia(node);
      if (u) return u;
    }
  }
  return null;
}

function extractMp4FromHtml(html) {
  if (!html || typeof html !== "string") return null;
  const patterns = [
    /"video_url"\s*:\s*"([^"]+)"/,
    /"playback_url"\s*:\s*"([^"]+)"/,
    /"url"\s*:\s*"(https:\\\/\\\/[^"]+\.mp4[^"]*)"/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      let u = m[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/");
      if (u.startsWith("http")) return u;
    }
  }
  return null;
}

/**
 * @param {string} shortcode
 * @param {{ extraCookieHeader?: string | null }} opts
 * @returns {Promise<{ videoUrl: string, thumbnailUrl?: string | null, method: string } | null>}
 */
export async function resolveInstagramPublicGraphql(shortcode, log, opts = {}) {
  const pk = shortcodeToMediaPk(shortcode);
  if (!pk) return null;

  const docId =
    process.env.INSTAGRAM_GRAPHQL_DOC_ID?.trim() || DEFAULT_DOC_ID;
  const reelUrl = `https://www.instagram.com/reel/${encodeURIComponent(shortcode)}/`;
  const maxAttempts = graphqlMaxAttempts();
  const stepMs = stepDelayMs();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      const gap = graphqlAttemptGapMs(attempt - 1);
      log.push({
        step: "ig_graphql",
        retryAttempt: attempt,
        pauseMs: gap,
        reason: "spacing after throttle/empty/rate response",
      });
      await sleep(gap);
    }

    let cookies = parseExtraCookieHeader(opts.extraCookieHeader || "");

    const baseFetch = {
      headers: {
        "User-Agent": IG_HEADERS_UA,
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://www.instagram.com/",
        "Cache-Control": "no-cache",
      },
    };

    try {
      const warm = await fetch(reelUrl, {
        ...baseFetch,
        redirect: "follow",
        headers: {
          ...baseFetch.headers,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          Cookie: cookiesToHeader(cookies),
        },
      });
      const sc = warm.headers.getSetCookie?.() || [];
      cookies = mergeCookies(cookies, sc);

      await warm.text().catch(() => {});

      if (stepMs > 0) await sleep(stepMs);

      const rulingUrl = `https://i.instagram.com/api/v1/web/get_ruling_for_content/?content_type=MEDIA&target_id=${encodeURIComponent(pk)}`;
      const ruling = await fetch(rulingUrl, {
        headers: {
          ...graphqlHeaders(reelUrl, cookies),
          Cookie: cookiesToHeader(cookies),
        },
      });
      const rulingSc = ruling.headers.getSetCookie?.() || [];
      cookies = mergeCookies(cookies, rulingSc);
      await ruling.json().catch(() => ({}));

      if (stepMs > 0) await sleep(stepMs);

      const variables = {
        shortcode,
        child_comment_count: 3,
        fetch_comment_count: 40,
        parent_comment_count: 24,
        has_threaded_comments: true,
      };
      const varsStr = JSON.stringify(variables);
      const gqlUrl = new URL("https://www.instagram.com/graphql/query/");
      gqlUrl.searchParams.set("doc_id", docId);
      gqlUrl.searchParams.set("variables", varsStr);

      const gqlRes = await fetch(gqlUrl.toString(), {
        headers: {
          ...graphqlHeaders(reelUrl, cookies),
          Cookie: cookiesToHeader(cookies),
        },
      });
      const raw = await gqlRes.text();
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        log.push({
          step: "ig_graphql",
          ok: false,
          attempt,
          httpStatus: gqlRes.status,
          parseError: true,
        });
        if (
          attempt < maxAttempts &&
          (gqlRes.status === 429 ||
            gqlRes.status >= 500 ||
            gqlRes.status === 200)
        ) {
          /** 200 + HTML often means login/wait wall instead of JSON. */
          continue;
        }
        return null;
      }

      if (gqlRes.status === 429) {
        log.push({
          step: "ig_graphql",
          ok: false,
          attempt,
          httpStatus: 429,
          rateLimited: true,
        });
        if (attempt < maxAttempts) continue;
        return null;
      }

      if (data?.message && String(data.message).includes("wait")) {
        log.push({
          step: "ig_graphql",
          ok: false,
          attempt,
          rateLimited: true,
          snippet: String(data.message).slice(0, 80),
        });
        if (attempt < maxAttempts) continue;
        return null;
      }
      if (data?.require_login) {
        log.push({ step: "ig_graphql", ok: false, attempt, requireLogin: true });
        return null;
      }

      const media =
        data?.data?.xdt_shortcode_media ||
        data?.data?.shortcode_media ||
        null;
      const videoUrl = pickVideoUrlFromXdtMedia(media);
      const thumb =
        media?.display_url ||
        media?.thumbnail_src ||
        media?.owner?.profile_pic_url ||
        null;

      const owner = media?.owner
        ? {
            username: media.owner.username || null,
            full_name: media.owner.full_name || null,
            profile_pic_url: media.owner.profile_pic_url || null,
          }
        : null;

      // Owner-only callers (creator attribution) want the authoritative poster
      // even for reels we won't download — return as soon as we have it.
      if (opts.ownerOnly && owner) {
        log.push({ step: "ig_graphql", ok: true, attempt, ownerOnly: true });
        return { owner, method: "ig_graphql" };
      }

      if (videoUrl) {
        log.push({
          step: "ig_graphql",
          ok: true,
          attempt,
          httpStatus: gqlRes.status,
        });
        return {
          videoUrl,
          thumbnailUrl: thumb || null,
          title: null,
          owner,
          method: "ig_graphql",
        };
      }

      log.push({
        step: "ig_graphql",
        ok: false,
        attempt,
        emptyMedia: true,
        httpStatus: gqlRes.status,
      });
      /** Empty body often clears after a pause when the IP was just throttled. */
      if (attempt < maxAttempts) continue;
    } catch (e) {
      log.push({
        step: "ig_graphql",
        ok: false,
        attempt,
        error: String(e?.message || e).slice(0, 200),
      });
      if (attempt < maxAttempts) continue;
    }
  }
  return null;
}

function graphqlHeaders(referer, cookieObj) {
  const csrf = cookieObj.csrftoken || "";
  return {
    "User-Agent": IG_HEADERS_UA,
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "X-IG-App-ID": IG_APP_ID,
    "X-ASBD-ID": "198387",
    "X-IG-WWW-Claim": "0",
    Origin: "https://www.instagram.com",
    Referer: referer,
    "X-CSRFToken": csrf,
    "X-Requested-With": "XMLHttpRequest",
  };
}

/**
 * Embed/captioned pages sometimes still expose JSON with video_url when GraphQL is blocked.
 */
export async function resolveInstagramEmbedScrape(shortcode, log) {
  const urls = [
    `https://www.instagram.com/reel/${encodeURIComponent(shortcode)}/embed/captioned/`,
    `https://www.instagram.com/reel/${encodeURIComponent(shortcode)}/embed/`,
    `https://www.instagram.com/p/${encodeURIComponent(shortcode)}/embed/`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": IG_HEADERS_UA,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://www.instagram.com/",
        },
        redirect: "follow",
      });
      const html = await res.text();
      const videoUrl = extractMp4FromHtml(html);
      if (videoUrl) {
        log.push({ step: "ig_embed", ok: true, url: truncate(url) });
        return {
          videoUrl,
          thumbnailUrl: null,
          title: null,
          method: "ig_embed",
        };
      }
    } catch (e) {
      log.push({
        step: "ig_embed",
        ok: false,
        error: String(e?.message || e).slice(0, 120),
      });
    }
  }
  log.push({ step: "ig_embed", ok: false });
  return null;
}

function truncate(u) {
  if (!u) return "";
  return u.length > 120 ? `${u.slice(0, 120)}…` : u;
}

/**
 * Fetch the authoritative Instagram creator (owner) for a reel by shortcode.
 * Reuses the public GraphQL path in owner-only mode. Best-effort — returns null
 * when Instagram gates the request (login/throttle) unless session cookies are
 * supplied via opts.extraCookieHeader. Never throws.
 */
export async function fetchInstagramMediaOwner(shortcode, opts = {}) {
  const log = [];
  try {
    const res = await resolveInstagramPublicGraphql(shortcode, log, { ...opts, ownerOnly: true });
    return res?.owner ?? null;
  } catch {
    return null;
  }
}
