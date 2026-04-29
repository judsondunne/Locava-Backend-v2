import { z } from "zod";
import { config as loadDotEnvFile, parse as parseDotEnv } from "dotenv";
import fs from "node:fs";
import path from "node:path";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  /**
   * `::` + ipv6Only=false (see server.ts) binds dual-stack: IPv6 and IPv4.
   * Required for iOS Simulator + RN `fetch` to `http://localhost:PORT`, which
   * resolves `localhost` to `::1` first; `0.0.0.0` alone does not accept ::1.
   * Override with HOST=0.0.0.0 if your deploy only supports IPv4 sockets.
   */
  HOST: z.string().default("::"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  SERVICE_NAME: z.string().default("locava-backend-v2"),
  SERVICE_VERSION: z.string().default("0.1.0"),
  GCP_PROJECT_ID: z.string().optional(),
  FIRESTORE_SOURCE_ENABLED: z.coerce.boolean().default(true),
  FIRESTORE_TEST_MODE: z.enum(["emulator", "mock", "disabled"]).optional(),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  FIREBASE_WEB_API_KEY: z.string().optional(),
  DEBUG_VIEWER_ID: z.string().optional(),
  ENABLE_LOCAL_DEV_IDENTITY: z.string().optional().default("0"),
  ENABLE_DEV_DIAGNOSTICS: z.coerce.boolean().default(true),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  COHERENCE_MODE: z.enum(["process_local", "external_coordinator_stub", "redis"]).default("process_local"),
  REDIS_URL: z.string().optional(),
  REDIS_KEY_PREFIX: z.string().default("locava:v2:"),
  SOURCE_OF_TRUTH_STRICT: z.coerce.boolean().default(false),
  /** TEMP local-only probe namespace that bypasses canonical auth wrappers for direct Firestore diagnostics. */
  ENABLE_PUBLIC_FIRESTORE_PROBE: z.coerce.boolean().default(false),
  /** When set, enables POST /internal/ops/* bearer-protected maintenance routes (e.g. search-field backfill). */
  INTERNAL_OPS_TOKEN: z.string().optional(),
  MAP_MARKERS_CACHE_TTL_MS: z.coerce.number().int().min(30_000).max(120_000).default(60_000),
  MAP_MARKERS_MAX_DOCS: z.coerce.number().int().min(100).max(10_000).default(5000),
  /**
   * Optional classic Locava API origin (no trailing path). When set:
   * - Auth routes can forward to the monolith (see `legacy-monolith-auth-proxy.routes.ts` if wired).
   * - **Product upload post-creation** (`create-from-staged`, multipart `create-with-files`, Commons moderation)
   *   forwards from `/api/v1/product/upload/*` via `@fastify/http-proxy` while staging/presign stay native on v2.
   *   `POST /v2/posting/finalize` is native by default. Set `POSTING_FINALIZE_USE_LEGACY_PROXY=1` to forward
   *   `create-from-staged` to this origin (requires publish auth). Leave unset for Backendv2-owned finalize.
   */
  LEGACY_MONOLITH_PROXY_BASE_URL: z.string().url().optional(),
  /** Dev/test only: allow unauthenticated clients to hit /v2/posts/* routes. */
  ALLOW_PUBLIC_POSTING_TEST: z.coerce.boolean().default(false),
  /** Optional shared bearer token used by Backendv2 when forwarding publish to legacy monolith. */
  LEGACY_MONOLITH_PUBLISH_BEARER_TOKEN: z.string().optional(),
  /** Cloud Function / Run URL for `video-processor` (native finalize enqueues a Cloud Task to this target). */
  VIDEO_PROCESSOR_FUNCTION_URL: z.string().url().optional(),
  /** Cloud Tasks queue for video jobs (default matches classic monolith). */
  VIDEO_PROCESSING_CLOUD_TASKS_QUEUE: z.string().optional(),
  VIDEO_PROCESSING_CLOUD_TASKS_LOCATION: z.string().optional(),
  /** Enable synchronous minimal faststart processing attempt on finalize before async fallback. */
  POSTING_VIDEO_SYNC_FASTSTART_ENABLED: z.coerce.boolean().default(false),
  /** Max synchronous processing window in seconds for finalize faststart attempt. */
  POSTING_VIDEO_SYNC_FASTSTART_MAX_SECONDS: z.coerce.number().int().positive().default(45),
  /** Soft guard for future use (bytes); keep exposed for runtime policy parity. */
  POSTING_VIDEO_SYNC_FASTSTART_MAX_BYTES: z.coerce.number().int().positive().default(157286400),
  /** Enforce that processed variants must be verified before assetsReady can become true. */
  POSTING_VIDEO_FASTSTART_REQUIRED: z.coerce.boolean().default(true),
  /** Force synchronous achievements delta generation on finalize (default is async for lower latency). */
  POSTING_FINALIZE_SYNC_ACHIEVEMENTS: z.coerce.boolean().default(false)
});

export type AppEnv = z.infer<typeof EnvSchema>;

function readEnvFileIfPresent(filePath: string): Record<string, string> {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return parseDotEnv(raw);
  } catch {
    return {};
  }
}

function stripWrappingQuotes(value: string | undefined): string | undefined {
  if (!value) return value;
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function mergeCandidateEnvFiles(cwd: string): Record<string, string> {
  const candidates = [
    path.resolve(cwd, ".env"),
    path.resolve(cwd, ".env.local"),
    path.resolve(cwd, "..", "Locava Backend", ".env"),
    path.resolve(cwd, "..", "Locava-Native", ".env")
  ];
  const merged: Record<string, string> = {};
  for (const candidate of candidates) {
    const values = readEnvFileIfPresent(candidate);
    for (const [key, value] of Object.entries(values)) {
      if (!(key in merged)) merged[key] = value;
    }
  }
  return merged;
}

export function loadEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  // Load local .env in this project (existing process env wins).
  loadDotEnvFile();
  const candidateFileEnv = mergeCandidateEnvFiles(process.cwd());
  const mergedSource: Record<string, string | undefined> = {
    ...candidateFileEnv,
    ...source
  };

  // Native already carries this key for local auth; mirror it to Backendv2 when missing.
  if (!mergedSource.FIREBASE_WEB_API_KEY && candidateFileEnv.EXPO_PUBLIC_FIREBASE_API_KEY) {
    mergedSource.FIREBASE_WEB_API_KEY = candidateFileEnv.EXPO_PUBLIC_FIREBASE_API_KEY;
  }

  // Allow admin SDK applicationDefault() to discover credentials without user shell exports.
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && candidateFileEnv.GOOGLE_APPLICATION_CREDENTIALS) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = candidateFileEnv.GOOGLE_APPLICATION_CREDENTIALS;
  }

  if (!process.env.FIREBASE_WEB_API_KEY && mergedSource.FIREBASE_WEB_API_KEY) {
    process.env.FIREBASE_WEB_API_KEY = mergedSource.FIREBASE_WEB_API_KEY;
  }

  // Keep local debug viewer identity deterministic for dev harness routes/scripts.
  if (mergedSource.NODE_ENV !== "production" && !mergedSource.DEBUG_VIEWER_ID) {
    mergedSource.DEBUG_VIEWER_ID = "aXngoh9jeqW35FNM3fq1w9aXdEh1";
  }
  if (mergedSource.DEBUG_VIEWER_ID && !process.env.DEBUG_VIEWER_ID) {
    process.env.DEBUG_VIEWER_ID = mergedSource.DEBUG_VIEWER_ID;
  }
  if (mergedSource.ENABLE_LOCAL_DEV_IDENTITY && !process.env.ENABLE_LOCAL_DEV_IDENTITY) {
    process.env.ENABLE_LOCAL_DEV_IDENTITY = mergedSource.ENABLE_LOCAL_DEV_IDENTITY;
  }

  // Normalize and export Firestore admin envs so runtime clients that read process.env
  // always see deterministic values (including values loaded from legacy .env files).
  const candidateCredentialPath = stripWrappingQuotes(mergedSource.GOOGLE_APPLICATION_CREDENTIALS);
  if (candidateCredentialPath) {
    mergedSource.GOOGLE_APPLICATION_CREDENTIALS = candidateCredentialPath;
    process.env.GOOGLE_APPLICATION_CREDENTIALS = candidateCredentialPath;
  }
  const candidateProjectId = stripWrappingQuotes(mergedSource.GCP_PROJECT_ID);
  if (candidateProjectId) {
    mergedSource.GCP_PROJECT_ID = candidateProjectId;
    process.env.GCP_PROJECT_ID = candidateProjectId;
  }
  const candidateFirebaseProjectId = stripWrappingQuotes(mergedSource.FIREBASE_PROJECT_ID);
  if (candidateFirebaseProjectId) {
    mergedSource.FIREBASE_PROJECT_ID = candidateFirebaseProjectId;
    process.env.FIREBASE_PROJECT_ID = candidateFirebaseProjectId;
  }
  const candidateClientEmail = stripWrappingQuotes(mergedSource.FIREBASE_CLIENT_EMAIL);
  if (candidateClientEmail) {
    mergedSource.FIREBASE_CLIENT_EMAIL = candidateClientEmail;
    process.env.FIREBASE_CLIENT_EMAIL = candidateClientEmail;
  }
  const candidatePrivateKey = stripWrappingQuotes(mergedSource.FIREBASE_PRIVATE_KEY);
  if (candidatePrivateKey) {
    mergedSource.FIREBASE_PRIVATE_KEY = candidatePrivateKey;
    process.env.FIREBASE_PRIVATE_KEY = candidatePrivateKey;
  }

  return EnvSchema.parse(mergedSource);
}
