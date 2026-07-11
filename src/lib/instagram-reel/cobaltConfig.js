// @ts-nocheck
/**
 * Cobalt base URL for Instagram reel resolve (server-only).
 * Default: local Cobalt at 127.0.0.1:9000. Override with COBALT_INSTANCE_URL.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

export const DEFAULT_COBALT_INSTANCE_URL = "http://127.0.0.1:9000";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_V2_ROOT = path.resolve(__dirname, "../../..");
const MONOREPO_ROOT = path.resolve(BACKEND_V2_ROOT, "..");

let hydrated = false;

function stripBom(s) {
  if (!s || s.charCodeAt(0) !== 0xfeff) return s;
  return s.slice(1);
}

function extractEnvLineValue(raw, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^\\s*${escaped}\\s*=\\s*(.*)$`, "m");
  const m = stripBom(raw).match(re);
  if (!m?.[1]) return null;
  let v = m[1].trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  const hash = v.search(/\s#/);
  if (hash > 0) v = v.slice(0, hash).trim();
  return v || null;
}

function fileHasCobaltLine(raw) {
  const s = stripBom(raw);
  return {
    hasCOBALT_INSTANCE_URL: /^\s*COBALT_INSTANCE_URL\s*=/m.test(s),
    hasCOBALT_URL: /^\s*COBALT_URL\s*=/m.test(s),
  };
}

function mergeParsedDotenv(parsed) {
  if (!parsed || typeof parsed !== "object") return;
  for (const [key, val] of Object.entries(parsed)) {
    if (val === undefined || val === null) continue;
    const str = String(val);
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = str;
    }
  }
}

function applyCobaltFromFileRaw(raw) {
  const a = extractEnvLineValue(raw, "COBALT_INSTANCE_URL");
  const b = extractEnvLineValue(raw, "COBALT_URL");
  const url = (a && a.trim()) || (b && b.trim());
  if (!url) return;
  const current =
    process.env.COBALT_INSTANCE_URL?.trim() ||
    process.env.COBALT_URL?.trim() ||
    "";
  if (!current) {
    const picked = a ?? b;
    if (picked) process.env.COBALT_INSTANCE_URL = picked;
  }
}

function hydrateEnvFromDisk() {
  if (hydrated) return;
  hydrated = true;

  const candidates = [
    path.join(BACKEND_V2_ROOT, ".env.local"),
    path.join(BACKEND_V2_ROOT, ".env"),
    path.join(MONOREPO_ROOT, ".env.local"),
    path.join(MONOREPO_ROOT, ".env"),
    path.join(process.cwd(), ".env.local"),
    path.join(process.cwd(), ".env"),
  ];

  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    let raw;
    try {
      raw = fs.readFileSync(p, "utf8");
    } catch {
      continue;
    }

    try {
      mergeParsedDotenv(dotenv.parse(raw));
    } catch {
      /* multiline / broken quotes */
    }

    applyCobaltFromFileRaw(raw);
  }
}

export function getCobaltBaseUrl() {
  hydrateEnvFromDisk();

  const raw =
    process.env.COBALT_INSTANCE_URL?.trim() ||
    process.env.COBALT_URL?.trim() ||
    DEFAULT_COBALT_INSTANCE_URL;
  if (!raw) return "";
  let s = raw.replace(/\/$/, "");
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  try {
    const u = new URL(s);
    if (u.hostname === "localhost") u.hostname = "127.0.0.1";
    return `${u.protocol}//${u.host}`.replace(/\/$/, "");
  } catch {
    return raw.replace(/\/$/, "");
  }
}

export function getCobaltEnvProbeInfo() {
  hydrateEnvFromDisk();

  const primary = path.join(BACKEND_V2_ROOT, ".env.local");
  let lineHints = null;
  if (fs.existsSync(primary)) {
    try {
      const raw = fs.readFileSync(primary, "utf8");
      lineHints = {
        ...fileHasCobaltLine(raw),
        parseSampleOk: (() => {
          try {
            dotenv.parse(raw);
            return true;
          } catch {
            return false;
          }
        })(),
      };
    } catch {
      lineHints = { readError: true };
    }
  }

  const fromEnv = Boolean(
    process.env.COBALT_INSTANCE_URL?.trim() || process.env.COBALT_URL?.trim(),
  );

  return {
    backendV2Root: BACKEND_V2_ROOT,
    monorepoRoot: MONOREPO_ROOT,
    cwd: process.cwd(),
    checkedFiles: [
      path.join(BACKEND_V2_ROOT, ".env.local"),
      path.join(BACKEND_V2_ROOT, ".env"),
      path.join(MONOREPO_ROOT, ".env.local"),
      path.join(MONOREPO_ROOT, ".env"),
    ].map((p) => ({ path: p, exists: fs.existsSync(p) })),
    cobaltConfigured: true,
    cobaltSource: fromEnv ? "env" : "hardcoded_default",
    cobaltDefault: DEFAULT_COBALT_INSTANCE_URL,
    lineHints,
  };
}
