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
  /**
   * OAuth continue / request URI sent to Identity Toolkit (`createAuthUri`, `signInWithIdp`).
   * Must use a host listed under Firebase Console → Authentication → Authorized domains.
   * Local dev: `http://127.0.0.1:8080/auth/callback` (add `127.0.0.1` + `localhost` as authorized domains first).
   */
  FIREBASE_AUTH_CONTINUE_URI: z.string().url().optional(),
  /**
   * Public origin of this Backendv2 instance (e.g. deployed Cloud Run URL). Used only to detect
   * accidental `LEGACY_MONOLITH_PROXY_BASE_URL` loops (Backendv2 proxying to itself).
   */
  BACKEND_PUBLIC_BASE_URL: z.string().url().optional(),
  /** Apple native bundle ID label (Diagnostics + audience mismatch UX). Prefer EXPO_IOS_BUNDLE_ID from native if syncing. */
  APPLE_IOS_BUNDLE_ID: z.string().optional(),
  /** Apple OAuth Services ID (web) label — Firebase Apple provider often binds this audience for Identity Toolkit REST. */
  APPLE_WEB_SERVICES_ID: z.string().optional(),
  DEBUG_VIEWER_ID: z.string().optional(),
  ENABLE_LOCAL_DEV_IDENTITY: z.string().optional().default("0"),
  ENABLE_DEV_DIAGNOSTICS: z.coerce.boolean().default(true),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  ANALYTICS_ENABLED: z.coerce.boolean().default(true),
  ANALYTICS_DATASET: z.string().default("analytics_prod"),
  ANALYTICS_EVENTS_TABLE: z.string().default("client_events"),
  ANALYTICS_QUEUE_MAX_ITEMS: z.coerce.number().int().min(100).max(20_000).default(5_000),
  ANALYTICS_PUBLISH_BATCH_SIZE: z.coerce.number().int().min(1).max(250).default(50),
  ANALYTICS_MAX_BATCH: z.coerce.number().int().min(1).max(250).default(250),
  ANALYTICS_RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  ANALYTICS_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(100).max(60_000).default(1_500),
  ANALYTICS_RETRY_MAX_DELAY_MS: z.coerce.number().int().min(500).max(300_000).default(30_000),
  ANALYTICS_DEBUG_RECENT_LIMIT: z.coerce.number().int().min(20).max(1_000).default(200),
  COHERENCE_MODE: z.enum(["process_local", "external_coordinator_stub", "redis"]).default("process_local"),
  /**
   * Optional explicit Cloud Run max instances hint for coherence checks.
   * Set to 1 when process-local correctness assumptions are intentionally single-instance.
   */
  CLOUD_RUN_MAX_INSTANCES: z.coerce.number().int().positive().optional(),
  REDIS_URL: z.string().optional(),
  REDIS_KEY_PREFIX: z.string().default("locava:v2:"),
  SOURCE_OF_TRUTH_STRICT: z.coerce.boolean().default(false),
  /** TEMP local-only probe namespace that bypasses canonical auth wrappers for direct Firestore diagnostics. */
  ENABLE_PUBLIC_FIRESTORE_PROBE: z.coerce.boolean().default(false),
  /** Enables one-post canonical rebuild preview/write/revert debug endpoints. */
  ENABLE_POST_REBUILDER_DEBUG_ROUTES: z.coerce.boolean().default(false),
  /** When set, enables POST /internal/ops/* bearer-protected maintenance routes (e.g. search-field backfill). */
  INTERNAL_OPS_TOKEN: z.string().optional(),
  /** When set, protects the internal health dashboard endpoints. */
  INTERNAL_DASHBOARD_TOKEN: z.string().optional(),
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
  /**
   * When true (non-production only), contact sync diagnostics may include redacted samples.
   * Production never logs raw PII regardless of this flag.
   */
  CONTACT_SYNC_VERBOSE_DIAGNOSTICS: z.coerce.boolean().default(false),
  /** Dev/test only: allow unauthenticated clients to hit /v2/posts/* routes. */
  ALLOW_PUBLIC_POSTING_TEST: z.coerce.boolean().default(false),
  /** Optional shared bearer token used by Backendv2 when forwarding publish to legacy monolith. */
  LEGACY_MONOLITH_PUBLISH_BEARER_TOKEN: z.string().optional(),
  /**
   * Cutover guard: keep legacy compat/proxy routes disabled by default.
   * Enable only for explicit dev migration testing.
   */
  ENABLE_LEGACY_COMPAT_ROUTES: z.coerce.boolean().default(false),
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
  POSTING_FINALIZE_SYNC_ACHIEVEMENTS: z.coerce.boolean().default(false),
  /** When true, post envelopes and feed cards include `appPost` (App Post V2 contract). */
  BACKEND_APP_POST_V2_RESPONSES: z.coerce.boolean().default(true)
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

/**
 * Layer monorepo env files so values **closer to Backendv2 win** over shared parents:
 * `../Locava Backend/.env` → `../Locava-Native/.env` → `./.env` → `./.env.local`.
 * Later non-empty assignments overwrite earlier ones so `.env.local` can replace e.g.
 * analytics-only `GOOGLE_APPLICATION_CREDENTIALS` committed in `./.env` with a local Firebase-admin JSON path.
 */
function mergeCandidateEnvFiles(cwd: string): Record<string, string> {
  const candidates = [
    path.resolve(cwd, "..", "Locava Backend", ".env"),
    path.resolve(cwd, "..", "Locava-Native", ".env"),
    path.resolve(cwd, ".env"),
    path.resolve(cwd, ".env.local")
  ];
  const merged: Record<string, string> = {};
  for (const candidate of candidates) {
    const values = readEnvFileIfPresent(candidate);
    for (const [key, value] of Object.entries(values)) {
      const trimmed = stripWrappingQuotes(value)?.trim() ?? "";
      if (!trimmed.length) continue;
      merged[key] = value;
    }
  }
  return merged;
}

/** Process env overlays file env only where the incoming value is non-empty (avoid erasing merged file keys). */
function mergeCandidateWithProcessEnv(
  candidateFileEnv: Record<string, string>,
  processEnv: NodeJS.ProcessEnv
): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = { ...candidateFileEnv };
  for (const [key, raw] of Object.entries(processEnv)) {
    if (raw === undefined) continue;
    const trimmed = stripWrappingQuotes(raw)?.trim() ?? "";
    if (!trimmed.length) continue;
    merged[key] = raw;
  }
  return merged;
}

export function loadEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  // Load local .env in this project; process env overlays only when vars are non-empty.
  loadDotEnvFile();
  const candidateFileEnv = mergeCandidateEnvFiles(process.cwd());
  const mergedSource: Record<string, string | undefined> = mergeCandidateWithProcessEnv(candidateFileEnv, source);

  /**
   * Local dev ergonomics: terminals often `export GOOGLE_APPLICATION_CREDENTIALS` to an Analytics-only key.
   * Layered dotenv (ending in `.env.local`) is the intended Firebase-admin path for Backendv2 dev.
   * When `NODE_ENV=development`, prefer the merged file path if it exists on disk; opt out via
   * `KEEP_SHELL_GOOGLE_APPLICATION_CREDENTIALS=1`. Production/test keep standard process precedence.
   */
  const keepShellGadc = stripWrappingQuotes(process.env.KEEP_SHELL_GOOGLE_APPLICATION_CREDENTIALS)?.trim() === "1";
  if (mergedSource.NODE_ENV === "development" && !keepShellGadc) {
    const fromFiles = stripWrappingQuotes(candidateFileEnv.GOOGLE_APPLICATION_CREDENTIALS);
    const effective = stripWrappingQuotes(mergedSource.GOOGLE_APPLICATION_CREDENTIALS);
    if (fromFiles && effective && fromFiles !== effective) {
      try {
        if (fs.existsSync(fromFiles)) {
          mergedSource.GOOGLE_APPLICATION_CREDENTIALS = fromFiles;
          process.env.GOOGLE_APPLICATION_CREDENTIALS = fromFiles;
        }
      } catch {
        /* ignore */
      }
    }
  }

  // Native already carries this key for local auth; mirror it to Backendv2 when missing.
  if (!mergedSource.FIREBASE_WEB_API_KEY && candidateFileEnv.EXPO_PUBLIC_FIREBASE_API_KEY) {
    mergedSource.FIREBASE_WEB_API_KEY = candidateFileEnv.EXPO_PUBLIC_FIREBASE_API_KEY;
  }

  // Allow admin SDK applicationDefault() to discover credentials without user shell exports.
  if (
    !(stripWrappingQuotes(process.env.GOOGLE_APPLICATION_CREDENTIALS)?.trim()?.length ?? 0) &&
    mergedSource.GOOGLE_APPLICATION_CREDENTIALS
  ) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = mergedSource.GOOGLE_APPLICATION_CREDENTIALS;
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
