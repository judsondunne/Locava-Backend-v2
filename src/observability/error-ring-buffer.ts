export type ErrorFeedEntry = {
  level: "warn" | "error";
  timestamp: string;
  routeName: string | null;
  route: string | null;
  method: string | null;
  requestId: string | null;
  statusCode: number | null;
  message: string;
  stack: string | null;
};

const LOGGER_PATCHED = Symbol.for("locava.backendv2.errorRingBufferPatched");
const MAX_ERROR_ENTRIES = 200;

type LogContextDefaults = {
  routeName?: string | null;
  route?: string | null;
  method?: string | null;
  requestId?: string | null;
  statusCode?: number | null;
};

class ErrorRingBuffer {
  private readonly entries: ErrorFeedEntry[] = [];

  add(entry: ErrorFeedEntry): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_ERROR_ENTRIES) {
      this.entries.shift();
    }
  }

  capture(level: "warn" | "error", args: unknown[], defaults: LogContextDefaults = {}): void {
    const entry = buildEntry(level, args, defaults);
    if (!entry) return;
    this.add(entry);
  }

  getRecent(limit = 50): ErrorFeedEntry[] {
    return this.entries.slice(-Math.max(1, limit)).reverse();
  }

  countRecent(level: "warn" | "error", limit = 100): number {
    return this.getRecent(limit).filter((entry) => entry.level === level).length;
  }

  clear(): void {
    this.entries.length = 0;
  }
}

function buildEntry(
  level: "warn" | "error",
  args: unknown[],
  defaults: LogContextDefaults
): ErrorFeedEntry | null {
  const context = extractContext(args[0]);
  const message = extractMessage(args, context);
  if (!message) return null;
  const error = extractError(args[0]);
  return {
    level,
    timestamp: new Date().toISOString(),
    routeName: context.routeName ?? defaults.routeName ?? null,
    route: context.route ?? defaults.route ?? null,
    method: context.method ?? defaults.method ?? null,
    requestId: context.requestId ?? defaults.requestId ?? null,
    statusCode: context.statusCode ?? defaults.statusCode ?? null,
    message,
    stack: shortenStack(error?.stack ?? context.stack ?? null)
  };
}

function extractContext(value: unknown): {
  routeName: string | null;
  route: string | null;
  method: string | null;
  requestId: string | null;
  statusCode: number | null;
  stack: string | null;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      routeName: null,
      route: null,
      method: null,
      requestId: null,
      statusCode: null,
      stack: null
    };
  }
  const record = value as Record<string, unknown>;
  return {
    routeName: asString(record.routeName),
    route: asString(record.route ?? record.url),
    method: asString(record.method),
    requestId: asString(record.requestId),
    statusCode: typeof record.statusCode === "number" ? record.statusCode : null,
    stack: asString(record.stack)
  };
}

function extractError(value: unknown): Error | null {
  if (value instanceof Error) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.err instanceof Error) return record.err;
  if (record.error instanceof Error) return record.error;
  if (record.cause instanceof Error) return record.cause;
  return null;
}

function extractMessage(args: unknown[], context: ReturnType<typeof extractContext>): string | null {
  const first = args[0];
  const second = args[1];
  const error = extractError(first);
  if (typeof first === "string" && first.trim()) {
    return first.trim();
  }
  if (typeof second === "string" && second.trim()) {
    if (error?.message) {
      return `${second.trim()}: ${error.message}`;
    }
    return second.trim();
  }
  if (error?.message) {
    return error.message;
  }
  if (context.stack) {
    return first instanceof Error ? first.message : "log entry captured";
  }
  if (first && typeof first === "object" && !Array.isArray(first)) {
    const record = first as Record<string, unknown>;
    const directMessage = asString(record.message);
    if (directMessage) return directMessage;
  }
  return null;
}

function shortenStack(stack: string | null): string | null {
  if (!stack) return null;
  return stack
    .split("\n")
    .slice(0, 6)
    .join("\n")
    .trim();
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function attachErrorBufferToLogger(
  logger: Record<string, unknown> | null | undefined,
  defaultsProvider: () => LogContextDefaults = () => ({})
): void {
  const symbolAwareLogger = logger as Record<string | symbol, unknown> | null | undefined;
  if (!symbolAwareLogger || symbolAwareLogger[LOGGER_PATCHED]) return;
  for (const level of ["warn", "error"] as const) {
    const original = symbolAwareLogger[level];
    if (typeof original !== "function") continue;
    symbolAwareLogger[level] = function patchedLevel(this: unknown, ...args: unknown[]) {
      errorRingBuffer.capture(level, args, defaultsProvider());
      return original.apply(this, args);
    };
  }
  Object.defineProperty(symbolAwareLogger, LOGGER_PATCHED, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
}

export const errorRingBuffer = new ErrorRingBuffer();
