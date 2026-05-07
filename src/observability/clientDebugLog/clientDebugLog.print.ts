import type { ClientDebugLogBatch, ClientDebugLogEntry } from "./clientDebugLog.schema.js";

/**
 * Sanitize + print client debug log batches to the Backendv2 console.
 *
 * Goals:
 * - Strict redaction. Never echo anything resembling auth/cookie/email/phone/token.
 * - Stable, greppable prefixes: [CLIENT_NET_END], [CLIENT_LOG_BATCH], etc.
 * - Bounded output. Each entry is printed as a single line key=value pair list.
 * - Pure. No Firestore reads/writes. No external IO.
 */

const MAX_ENTRY_FIELD_LEN = 240;
const MAX_META_KEYS = 12;

/**
 * Words that, when contained in a log key, force [redacted] on the value.
 * Intentionally narrow:
 * - Plain `session` is allowed because we use it as the greppable correlation key.
 * - `token` matches accessToken / idToken / refreshToken / authToken / sessionToken.
 * - Email / phone keys are redacted; any string value is also pattern-matched.
 */
const REDACT_KEYWORDS = [
  "authorization",
  "auth-token",
  "auth_token",
  "cookie",
  "set-cookie",
  "bearer",
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "api_key",
  "api-key",
  "x-api-key",
  "refresh",
  "access_token",
  "accesstoken",
  "access-token",
  "email",
  "phone",
  "ssn",
  "credit",
  "card"
];

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return REDACT_KEYWORDS.some((needle) => lower.includes(needle));
}

/** Match strings that look like a JWT or a long opaque token. Avoid false positives on dotted names. */
function looksLikeToken(value: string): boolean {
  if (value.length < 32) return false;
  if (/^[A-Za-z0-9_\-]{16,}\.[A-Za-z0-9_\-]{16,}\.[A-Za-z0-9_\-]{16,}$/.test(value)) return true;
  if (/^[A-Za-z0-9_\-]{60,}$/.test(value)) return true;
  return false;
}

function looksLikeEmail(value: string): boolean {
  return /[^\s@]+@[^\s@]+\.[^\s@]+/.test(value);
}

function looksLikePhone(value: string): boolean {
  if (value.length < 7) return false;
  return /^\+?\d[\d\s\-().]{6,}$/.test(value.trim());
}

function truncate(value: string, max = MAX_ENTRY_FIELD_LEN): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…(+${value.length - max})`;
}

function sanitizeScalar(key: string, raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "boolean" || typeof raw === "number") return String(raw);
  const stringValue = String(raw);
  if (isSensitiveKey(key)) return "[redacted]";
  if (looksLikeToken(stringValue)) return "[redacted-token]";
  if (looksLikeEmail(stringValue)) return "[redacted-email]";
  if (looksLikePhone(stringValue)) return "[redacted-phone]";
  return truncate(stringValue);
}

function sanitizeMeta(meta: ClientDebugLogEntry["meta"]): Record<string, string | number | boolean | null> {
  if (!meta) return {};
  const safe: Record<string, string | number | boolean | null> = {};
  let kept = 0;
  for (const [key, value] of Object.entries(meta)) {
    if (kept >= MAX_META_KEYS) break;
    if (isSensitiveKey(key)) {
      safe[key] = "[redacted]";
      kept += 1;
      continue;
    }
    if (typeof value === "string") {
      safe[key] = sanitizeScalar(key, value);
    } else {
      safe[key] = value as string | number | boolean | null;
    }
    kept += 1;
  }
  return safe;
}

function sanitizeUrlPathOnly(input?: string): string | undefined {
  if (!input) return input;
  // Path only: drop fragment + query but allow query keys list to flow via meta.
  const noQuery = input.split(/[?#]/)[0] ?? input;
  return truncate(noQuery, 240);
}

function safeKv(parts: Record<string, unknown>): string {
  const out: string[] = [];
  for (const [key, value] of Object.entries(parts)) {
    if (value === undefined || value === null || value === "") continue;
    const stringValue = sanitizeScalar(key, value);
    if (!stringValue.length) continue;
    if (/[\s"=]/.test(stringValue)) {
      out.push(`${key}="${stringValue.replace(/"/g, '\\"')}"`);
    } else {
      out.push(`${key}=${stringValue}`);
    }
  }
  return out.join(" ");
}

export interface PrintableBatchContext {
  serverReceivedAt: string;
  ageMs: number;
}

export interface ClientDebugLogPrinter {
  info: (line: string, meta?: Record<string, unknown>) => void;
  warn?: (line: string, meta?: Record<string, unknown>) => void;
  error?: (line: string, meta?: Record<string, unknown>) => void;
}

function formatHeader(batch: ClientDebugLogBatch, ctx: PrintableBatchContext): string {
  return safeKv({
    session: batch.clientSessionId,
    count: batch.entries.length,
    platform: batch.platform ?? "unknown",
    build: batch.appBuildType ?? "unknown",
    appVersion: batch.appVersion,
    surface: batch.surface,
    ageMs: ctx.ageMs,
    serverReceivedAt: ctx.serverReceivedAt
  });
}

export function formatClientDebugLogEntry(
  entry: ClientDebugLogEntry,
  batch: ClientDebugLogBatch
): { prefix: string; line: string; severity: "info" | "warn" | "error" } {
  const sanitizedPath = sanitizeUrlPathOnly(entry.urlPathOnly);
  const meta = sanitizeMeta(entry.meta);

  const base: Record<string, unknown> = {
    session: batch.clientSessionId,
    surface: entry.surface ?? batch.surface,
    screen: entry.screen,
    routeName: entry.routeName,
    method: entry.method,
    path: sanitizedPath,
    queryKeys: entry.queryKeys?.length ? entry.queryKeys.join(",") : undefined,
    requestId: entry.requestId,
    requestKey: entry.requestKey,
    status: entry.status,
    ok: entry.ok,
    durationMs: entry.durationMs,
    overlap: entry.overlapCount,
    inflightForKey: entry.inFlightCountForKey,
    totalInflight: entry.totalInFlightCount,
    duplicateWindowMs: entry.duplicateWindowMs,
    caller: entry.caller,
    name: entry.name,
    errorName: entry.errorName,
    errorMessage: entry.errorMessage,
    bodyKeys: entry.bodyKeys?.length ? entry.bodyKeys.join(",") : undefined,
    deviceTime: entry.deviceTime,
    monotonicMs: entry.monotonicMs,
    platform: batch.platform,
    appBuild: batch.appBuildType,
    appVersion: batch.appVersion,
    source: "native"
  };
  for (const [key, value] of Object.entries(meta)) {
    if (key in base) continue;
    base[`meta_${key}`] = value;
  }

  const severity: "info" | "warn" | "error" =
    entry.kind === "CLIENT_NET_ERROR"
      ? "error"
      : entry.kind === "CLIENT_NET_SLOW" || entry.kind === "CLIENT_NET_OVERLAP"
        ? "warn"
        : "info";

  return {
    prefix: entry.kind,
    line: safeKv(base),
    severity
  };
}

export function printClientDebugLogBatch(
  batch: ClientDebugLogBatch,
  ctx: PrintableBatchContext,
  printer: ClientDebugLogPrinter
): void {
  printer.info(`[CLIENT_LOG_BATCH] ${formatHeader(batch, ctx)}`);
  for (const entry of batch.entries) {
    const formatted = formatClientDebugLogEntry(entry, batch);
    const message = `[${formatted.prefix}] ${formatted.line}`;
    if (formatted.severity === "error") {
      (printer.error ?? printer.info)(message);
    } else if (formatted.severity === "warn") {
      (printer.warn ?? printer.info)(message);
    } else {
      printer.info(message);
    }
  }
}

export const __TEST__ = {
  isSensitiveKey,
  looksLikeToken,
  looksLikeEmail,
  looksLikePhone,
  sanitizeScalar,
  sanitizeMeta,
  sanitizeUrlPathOnly,
  truncate
};
