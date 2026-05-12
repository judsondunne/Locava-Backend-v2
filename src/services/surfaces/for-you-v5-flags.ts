/**
 * For You V5 feature flags (`for-you-v5-get-page.ts`, route variant, etc.).
 *
 * **No .env is required for the normal path:** with all of these unset, the server uses
 * V5 ready-deck + compact seen writes. Set variables only to **turn behavior off** or for
 * verification (readonly / dry-run).
 */
const OFF = new Set(["0", "false", "no", "off"]);

function envIsExplicitlyOff(raw: string | undefined): boolean {
  if (raw === undefined || raw === null) return false;
  return OFF.has(String(raw).trim().toLowerCase());
}

/** When unset or empty → V5 is on. Only `ENABLE_FOR_YOU_V5_READY_DECK=false` (or 0/off) disables. */
export function isForYouV5ReadyDeckEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !envIsExplicitlyOff(env.ENABLE_FOR_YOU_V5_READY_DECK);
}

/** When unset or empty → seen writes on. Only `FOR_YOU_SEEN_WRITES_ENABLED=false` (or 0/off) disables. */
export function isForYouV5SeenWritesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !envIsExplicitlyOff(env.FOR_YOU_SEEN_WRITES_ENABLED);
}

const READONLY_ON = new Set(["1", "true", "yes", "on"]);

export function isForYouV5EnvVerifyReadOnly(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = String(env.FOR_YOU_VERIFY_READONLY ?? "").trim().toLowerCase();
  return READONLY_ON.has(raw);
}

export function isForYouV5VerifyReadOnly(
  env: NodeJS.ProcessEnv = process.env,
  opts?: { dryRunSeen?: boolean; headerReadonly?: boolean }
): boolean {
  if (isForYouV5EnvVerifyReadOnly(env)) return true;
  if (opts?.dryRunSeen) return true;
  if (opts?.headerReadonly) return true;
  return false;
}
