import { isDebugScopeEnabled } from "./log-config.js";

type Payload = Record<string, unknown> | (() => Record<string, unknown>);

const warnKeys = new Set<string>();
const rateMap = new Map<string, number>();

function resolve(payload?: Payload): Record<string, unknown> | undefined {
  if (!payload) return undefined;
  return typeof payload === "function" ? payload() : payload;
}

export function debugLog(scope: string, event: string, payload?: Payload): void {
  if (!isDebugScopeEnabled(scope)) return;
  console.info(`[${event}]`, resolve(payload) ?? {});
}

export function warnOnce(scope: string, event: string, payload?: Payload): void {
  const key = `${scope}:${event}`;
  if (warnKeys.has(key)) return;
  warnKeys.add(key);
  console.warn(`[${event}]`, resolve(payload) ?? {});
}

export function rateLimitedLog(
  scope: string,
  event: string,
  payload?: Payload,
  intervalMs = 60_000
): void {
  const key = `${scope}:${event}`;
  const now = Date.now();
  const last = rateMap.get(key) ?? 0;
  if (now - last < intervalMs) return;
  rateMap.set(key, now);
  debugLog(scope, event, payload);
}
