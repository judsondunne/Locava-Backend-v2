// @ts-nocheck
/**
 * Shared helpers for browser-export Instagram cookies (Chrome extension JSON array).
 * Used by resolve, post-photos, etc.
 */

import fs from "fs";

/** @param {unknown} body */
export function parseInstagramCookiesFromBody(body) {
  const raw = body?.cookies ?? body?.cookiesJson;
  if (raw == null) return { cookies: null, error: null };
  if (Array.isArray(raw)) return { cookies: raw, error: null };
  const s = String(raw).trim();
  if (!s) return { cookies: null, error: null };
  try {
    const j = JSON.parse(s);
    if (!Array.isArray(j)) {
      return { cookies: null, error: "cookies must be a JSON array" };
    }
    return { cookies: j, error: null };
  } catch {
    return { cookies: null, error: "cookies is not valid JSON" };
  }
}

/**
 * @param {unknown[]} arr
 * @returns {{ header: string | null, count: number }}
 */
export function cookieObjectsToHeaderString(arr) {
  if (!Array.isArray(arr)) return { header: null, count: 0 };
  const pairs = [];
  const seenNames = new Set();
  for (const entry of arr) {
    if (!entry || typeof entry !== "object") continue;
    const domainRaw = entry.domain != null ? String(entry.domain).trim() : "";
    if (domainRaw && !domainRaw.includes("instagram.com")) continue;
    const name = entry.name != null ? String(entry.name).trim() : "";
    const value = entry.value != null ? String(entry.value) : "";
    if (!name) continue;
    if (seenNames.has(name)) continue;
    seenNames.add(name);
    pairs.push(`${name}=${value}`);
  }
  const header = pairs.length ? pairs.join("; ") : null;
  return { header, count: pairs.length };
}

/** Netscape cookies.txt for yt-dlp (--cookies file is more reliable than headers for IG). */
export function writeNetscapeCookiesFromBrowserArray(arr, destPath) {
  const lines = ["# Netscape HTTP Cookie File", "# request-scoped temp file for yt-dlp"];
  for (const e of arr) {
    if (!e || typeof e !== "object") continue;
    const domainRaw = e.domain != null ? String(e.domain).trim() : "";
    if (domainRaw && !domainRaw.includes("instagram.com")) continue;
    let domain = domainRaw || ".instagram.com";
    if (!domain.startsWith(".")) domain = `.${domain.replace(/^\.+/, "")}`;
    const name = e.name != null ? String(e.name).trim() : "";
    const value = e.value != null ? String(e.value) : "";
    if (!name) continue;
    const p = e.path != null ? String(e.path) : "/";
    const secure = e.secure === false ? "FALSE" : "TRUE";
    const exp = Math.min(
      Math.floor(Number(e.expirationDate) || Date.now() / 1000 + 86400 * 365),
      2147483647,
    );
    lines.push([domain, "TRUE", p, secure, String(exp), name, value].join("\t"));
  }
  fs.writeFileSync(destPath, `${lines.join("\n")}\n`, "utf8");
}
