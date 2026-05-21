import type { AppEnv } from "../../config/env.js";

export function wikiSpotCurationEnabledFromEnv(env: AppEnv): boolean {
  const raw = process.env.WIKI_SPOT_CURATION_ENABLED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no") return false;
  void env;
  return true;
}

export function wikiSpotCurationApplyWritesEnabledFromEnv(): boolean {
  const raw = process.env.WIKI_CURATION_APPLY_WRITES_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/** Required on `POST .../apply-ai` when apply writes are enabled (header `x-wiki-curation-apply-secret`). */
export function wikiSpotCurationApplySecret(): string | null {
  const s = process.env.WIKI_CURATION_APPLY_SECRET?.trim();
  return s || null;
}

/** Gemini model id (e.g. gemini-2.5-flash, gemini-2.5-flash-lite). */
export function wikiSpotCurationGeminiModel(): string {
  return (
    process.env.WIKI_SPOT_CURATION_GEMINI_MODEL?.trim() ||
    process.env.WIKI_SPOT_CURATION_MODEL?.trim() ||
    "gemini-2.5-flash"
  );
}

export type WikiSpotCurationGeminiKeyMeta = {
  /** True if any non-empty Gemini key is visible in `process.env` (diagnostics only; wiki dry review does not use it). */
  configured: boolean;
  /** Which var is non-empty (`GEMINI_API_KEY` wins if both are set). */
  source: "GEMINI_API_KEY" | "GOOGLE_GEMINI_API_KEY" | null;
  keyLength: number;
  /** Both vars are non-empty; only `source` is reflected in `keyLength` / `source`. */
  bothGeminiVarsSet: boolean;
};

/**
 * Safe diagnostics (no key material). Use when debugging stray `GEMINI_*` in the shell or layered `.env`.
 * Wiki dry review uses header `x-wiki-curation-gemini-api-key` only for the Gemini HTTP call.
 *
 * Note: `dotenv` does **not** override variables already set in the shell. If you `export GEMINI_API_KEY=...`
 * in a profile or IDE run config, that value wins over `.env` until you `unset` it or restart without it.
 */
export function wikiSpotCurationGeminiApiKeyMeta(): WikiSpotCurationGeminiKeyMeta {
  const g = process.env.GEMINI_API_KEY?.trim() || "";
  const gg = process.env.GOOGLE_GEMINI_API_KEY?.trim() || "";
  const both = !!(g && gg);
  if (g) {
    return { configured: true, source: "GEMINI_API_KEY", keyLength: g.length, bothGeminiVarsSet: both };
  }
  if (gg) {
    return { configured: true, source: "GOOGLE_GEMINI_API_KEY", keyLength: gg.length, bothGeminiVarsSet: both };
  }
  return { configured: false, source: null, keyLength: 0, bothGeminiVarsSet: false };
}

/**
 * Reads `GEMINI_API_KEY` / `GOOGLE_GEMINI_API_KEY` from the environment (diagnostics and any non–wiki-curation callers).
 * Wiki spot dry review does not use this for the Google API request.
 */
export function wikiSpotCurationGeminiApiKey(): string | null {
  const meta = wikiSpotCurationGeminiApiKeyMeta();
  if (!meta.configured || !meta.source) return null;
  const k = process.env[meta.source]?.trim() || "";
  return k || null;
}

