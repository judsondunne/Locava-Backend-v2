#!/usr/bin/env bash

set -euo pipefail

SERVICE_NAME="locava-backend-v2"
REGION="us-central1"
PORT="8080"

# --- Cloud Run production shape (aligned with legacy monolith idea: warm baseline + headroom, not oversized) ---
# Memory: in-process GeoNames / caches; 2Gi avoids tight OOM during startup spikes (legacy used 4Gi for heavier GeoNames path).
MEMORY="${MEMORY:-2Gi}"
CPU="${CPU:-1}"
MIN_INSTANCES="${MIN_INSTANCES:-1}"
MAX_INSTANCES="${MAX_INSTANCES:-15}"
CONCURRENCY="${CONCURRENCY:-24}"
# Request timeout (gcloud duration). Video work is Cloud Tasks–offloaded.
TIMEOUT="${TIMEOUT:-10m}"
# Startup probe: wait for listen + early hooks; /health is the lightest liveness-style route.
STARTUP_PROBE="${STARTUP_PROBE:-httpGet.path=/health,initialDelaySeconds=35,failureThreshold=8,timeoutSeconds=5,periodSeconds=5}"

# Keep-warm Scheduler (hedge on top of min-instances; keeps TLS + instance churn smoother). Disable: WARM_PING_ENABLED=false
WARM_PING_ENABLED="${WARM_PING_ENABLED:-true}"
WARM_PING_JOB_NAME="${WARM_PING_JOB_NAME:-locava-backend-v2-warm-ping}"
WARM_PING_SCHEDULE="${WARM_PING_SCHEDULE:-*/10 * * * *}"
WARM_PING_TIMEZONE="${WARM_PING_TIMEZONE:-America/New_York}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
MONOREPO_ROOT="$(cd "$PROJECT_ROOT/.." && pwd)"

cd "$PROJECT_ROOT"

GCLOUD_BIN="${GCLOUD_BIN:-$(command -v gcloud || true)}"
if [ -z "$GCLOUD_BIN" ]; then
  echo "❌ gcloud CLI not found"
  exit 1
fi

ENV_FILE="$(mktemp)"
trap 'rm -f "$ENV_FILE"' EXIT

PROJECT_ID="$(
  node --input-type=module <<'EOF_NODE'
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
/* Same layering as Backendv2 loadEnv(): parent monorepo first, Backendv2 .env, then .env.local wins */
const envPaths = [
  path.resolve(cwd, "..", "Locava Backend", ".env"),
  path.resolve(cwd, "..", "Locava-Native", ".env"),
  path.resolve(cwd, ".env"),
  path.resolve(cwd, ".env.local")
];

function parseIntoMerged(filePath, merged) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!value.trim().length) continue;
    merged[key] = value;
  }
}

const merged = {};
for (const fp of envPaths) parseIntoMerged(fp, merged);

const projectId =
  process.env.GCP_PROJECT_ID ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  merged.GCP_PROJECT_ID ||
  merged.GOOGLE_CLOUD_PROJECT ||
  merged.FIREBASE_PROJECT_ID ||
  merged.EXPO_PUBLIC_FIREBASE_PROJECT_ID ||
  "";

process.stdout.write(projectId);
EOF_NODE
)"

if [ -z "$PROJECT_ID" ]; then
  PROJECT_ID="$("$GCLOUD_BIN" config get-value project 2>/dev/null || true)"
fi

if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "(unset)" ]; then
  echo "❌ No GCP project configured. Set GCP_PROJECT_ID in .env or run: gcloud config set project <project-id>"
  exit 1
fi

node --input-type=module > "$ENV_FILE" <<'EOF_NODE'
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const envPaths = [
  path.resolve(cwd, "..", "Locava Backend", ".env"),
  path.resolve(cwd, "..", "Locava-Native", ".env"),
  path.resolve(cwd, ".env"),
  path.resolve(cwd, ".env.local")
];

function mergeEnvFilesLaydown() {
  const merged = {};
  for (const filePath of envPaths) {
    if (!fs.existsSync(filePath)) continue;
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!value.trim().length) continue;
      merged[key] = value;
    }
  }
  return merged;
}

const merged = mergeEnvFilesLaydown();

const env = {
  NODE_ENV: "production",
  SERVICE_NAME: "locava-backend-v2",
  SERVICE_VERSION: process.env.SERVICE_VERSION || process.env.GIT_COMMIT_SHA || "manual",
  LOG_LEVEL: merged.LOG_LEVEL || "info",
  // Client telemetry / field-test logging — default on for Cloud Run (override via shell or layered .env)
  ENABLE_CLIENT_TELEMETRY_INGEST:
    process.env.ENABLE_CLIENT_TELEMETRY_INGEST ?? merged.ENABLE_CLIENT_TELEMETRY_INGEST ?? "1",
  ENABLE_CLIENT_DEBUG_LOG_INGEST:
    process.env.ENABLE_CLIENT_DEBUG_LOG_INGEST ?? merged.ENABLE_CLIENT_DEBUG_LOG_INGEST ?? "1",
  FIELD_TEST_LOGGING_ENABLED:
    process.env.FIELD_TEST_LOGGING_ENABLED ?? merged.FIELD_TEST_LOGGING_ENABLED ?? "1"
};

const passthroughKeys = [
  "GCP_PROJECT_ID",
  "GOOGLE_CLOUD_PROJECT",
  "FIRESTORE_SOURCE_ENABLED",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_WEB_API_KEY",
  "LEGACY_MONOLITH_PROXY_BASE_URL",
  "LEGACY_MONOLITH_PUBLISH_BEARER_TOKEN",
  "VIDEO_PROCESSOR_TASK_SECRET",
  "VIDEO_MAIN720_HEVC_ENABLED",
  "VIDEO_PROCESSING_CLOUD_TASKS_QUEUE",
  "VIDEO_PROCESSING_CLOUD_TASKS_LOCATION",
  "POSTING_VIDEO_SYNC_FASTSTART_ENABLED",
  "POSTING_VIDEO_SYNC_FASTSTART_MAX_SECONDS",
  "POSTING_VIDEO_SYNC_FASTSTART_MAX_BYTES",
  "POSTING_VIDEO_FASTSTART_REQUIRED",
  "POSTING_FINALIZE_SYNC_ACHIEVEMENTS",
  "ANALYTICS_ENABLED",
  "ANALYTICS_TOPIC",
  "ANALYTICS_DATASET",
  "ANALYTICS_EVENTS_TABLE",
  "ANALYTICS_EXECUTED_TABLE",
  "ANALYTICS_WRITE_DIRECT_TO_BQ",
  "ANALYTICS_ADMIN_UIDS",
  "ENABLE_FIRESTORE_ANALYTICS_FALLBACK",
  "ENABLE_FEED_CANDIDATE_REFRESH_ON_STARTUP",
  "INIT_POSTS_CACHE_ON_STARTUP",
  "REDIS_URL",
  "REDIS_TLS",
  "REDIS_KEY_PREFIX",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "COHERENCE_MODE",
  "WASABI_ACCESS_KEY_ID",
  "WASABI_SECRET_ACCESS_KEY",
  "WASABI_REGION",
  "WASABI_ENDPOINT",
  "WASABI_BUCKET_NAME",
  "BRANCH_API_KEY",
  "ADMIN_TOKEN",
  "TEST_POST_SECRET",
  "ENABLE_PUBLIC_FIRESTORE_PROBE",
  "ENABLE_LOCAL_DEV_IDENTITY",
  "ENABLE_DEV_DIAGNOSTICS",
  "ALLOW_PUBLIC_POSTING_TEST",
  "INTERNAL_OPS_TOKEN",
  "INTERNAL_DASHBOARD_TOKEN",
  "DEBUG_VIEWER_ID",
  "MAP_MARKERS_CACHE_TTL_MS",
  "MAP_MARKERS_MAX_DOCS",
  "OPENWEATHER_API_KEY",
  "SOURCE_OF_TRUTH_STRICT",
  "REQUEST_TIMEOUT_MS",
  "ENABLE_SCHEDULED_LIKES_WORKER",
  "ENABLE_AUTO_LIKE_BOOSTER_WORKER"
];

for (const key of passthroughKeys) {
  const value = process.env[key] ?? merged[key];
  if (value !== undefined && value !== "") {
    env[key] = value;
  }
}

if (!env.FIREBASE_WEB_API_KEY && merged.EXPO_PUBLIC_FIREBASE_API_KEY) {
  env.FIREBASE_WEB_API_KEY = merged.EXPO_PUBLIC_FIREBASE_API_KEY;
}

if (!env.OPENWEATHER_API_KEY && merged.EXPO_PUBLIC_OPENWEATHER_API_KEY) {
  env.OPENWEATHER_API_KEY = merged.EXPO_PUBLIC_OPENWEATHER_API_KEY;
}

const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || merged.GOOGLE_APPLICATION_CREDENTIALS;
if ((!env.FIREBASE_PRIVATE_KEY || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PROJECT_ID) && credentialsPath && fs.existsSync(credentialsPath)) {
  const raw = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
  if (raw.project_id && !env.FIREBASE_PROJECT_ID) env.FIREBASE_PROJECT_ID = raw.project_id;
  if (raw.client_email && !env.FIREBASE_CLIENT_EMAIL) env.FIREBASE_CLIENT_EMAIL = raw.client_email;
  if (raw.private_key && !env.FIREBASE_PRIVATE_KEY) env.FIREBASE_PRIVATE_KEY = raw.private_key;
  if (raw.project_id && !env.GCP_PROJECT_ID) env.GCP_PROJECT_ID = raw.project_id;
}

if (!env.GCP_PROJECT_ID && env.GOOGLE_CLOUD_PROJECT) {
  env.GCP_PROJECT_ID = env.GOOGLE_CLOUD_PROJECT;
}

// Never ship workstation-only credential paths or local debug routes to Cloud Run.
delete env.GOOGLE_APPLICATION_CREDENTIALS;
delete env.ALLOW_EXTENSION_DEV_ROUTES;
delete env.ENABLE_LOCAL_DEV_IDENTITY;

if (env.NODE_ENV === "production") {
  delete env.ENABLE_PUBLIC_FIRESTORE_PROBE;
  delete env.ENABLE_DEV_DIAGNOSTICS;
  delete env.ALLOW_PUBLIC_POSTING_TEST;
  delete env.DEBUG_VIEWER_ID;
}

const preferredOrder = [
  "NODE_ENV",
  "SERVICE_NAME",
  "SERVICE_VERSION",
  "LOG_LEVEL",
  "ENABLE_CLIENT_TELEMETRY_INGEST",
  "ENABLE_CLIENT_DEBUG_LOG_INGEST",
  "FIELD_TEST_LOGGING_ENABLED",
  "GCP_PROJECT_ID",
  "GOOGLE_CLOUD_PROJECT",
  "FIRESTORE_SOURCE_ENABLED",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_WEB_API_KEY",
  "WASABI_ACCESS_KEY_ID",
  "WASABI_SECRET_ACCESS_KEY",
  "WASABI_REGION",
  "WASABI_ENDPOINT",
  "WASABI_BUCKET_NAME",
  "REDIS_URL",
  "REDIS_TLS",
  "REDIS_KEY_PREFIX",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "ANALYTICS_TOPIC",
  "ANALYTICS_DATASET",
  "ANALYTICS_EVENTS_TABLE",
  "ANALYTICS_EXECUTED_TABLE",
  "ANALYTICS_WRITE_DIRECT_TO_BQ",
  "ANALYTICS_ADMIN_UIDS",
  "ENABLE_FIRESTORE_ANALYTICS_FALLBACK",
  "ENABLE_FEED_CANDIDATE_REFRESH_ON_STARTUP",
  "INIT_POSTS_CACHE_ON_STARTUP",
  "BRANCH_API_KEY",
  "ADMIN_TOKEN",
  "TEST_POST_SECRET",
  "POSTING_FINALIZE_SYNC_ACHIEVEMENTS",
  "ALLOW_EXTENSION_DEV_ROUTES",
  "ENABLE_SCHEDULED_LIKES_WORKER",
  "ENABLE_AUTO_LIKE_BOOSTER_WORKER",
  "LEGACY_MONOLITH_PROXY_BASE_URL",
  "LEGACY_MONOLITH_PUBLISH_BEARER_TOKEN",
  "VIDEO_PROCESSOR_TASK_SECRET",
  "VIDEO_MAIN720_HEVC_ENABLED",
  "VIDEO_PROCESSING_CLOUD_TASKS_QUEUE",
  "VIDEO_PROCESSING_CLOUD_TASKS_LOCATION",
  "POSTING_VIDEO_SYNC_FASTSTART_ENABLED",
  "POSTING_VIDEO_SYNC_FASTSTART_MAX_SECONDS",
  "POSTING_VIDEO_SYNC_FASTSTART_MAX_BYTES",
  "POSTING_VIDEO_FASTSTART_REQUIRED",
  "COHERENCE_MODE",
  "ENABLE_PUBLIC_FIRESTORE_PROBE",
  "ENABLE_LOCAL_DEV_IDENTITY",
  "ENABLE_DEV_DIAGNOSTICS",
  "ALLOW_PUBLIC_POSTING_TEST",
  "INTERNAL_OPS_TOKEN",
  "INTERNAL_DASHBOARD_TOKEN",
  "DEBUG_VIEWER_ID",
  "MAP_MARKERS_CACHE_TTL_MS",
  "MAP_MARKERS_MAX_DOCS",
  "OPENWEATHER_API_KEY",
  "SOURCE_OF_TRUTH_STRICT",
  "REQUEST_TIMEOUT_MS"
];

const yamlScalar = (value) => JSON.stringify(String(value));

for (const key of preferredOrder) {
  if (env[key] !== undefined && env[key] !== "") {
    process.stdout.write(`${key}: ${yamlScalar(env[key])}\n`);
  }
}

for (const [key, value] of Object.entries(env)) {
  if (!preferredOrder.includes(key) && value !== undefined && value !== "") {
    process.stdout.write(`${key}: ${yamlScalar(value)}\n`);
  }
}
EOF_NODE

# Cloud Run replaces env from --env-vars-file each deploy; include worker URL so it is not dropped.
# (Do not read VIDEO_PROCESSOR_FUNCTION_URL from local .env — it may be localhost.)
PRE_SERVICE_URL="$("$GCLOUD_BIN" run services describe "$SERVICE_NAME" --region "$REGION" --project "$PROJECT_ID" --format='value(status.url)' 2>/dev/null || true)"
if [ -n "$PRE_SERVICE_URL" ]; then
  export DEPLOY_ENV_FILE="$ENV_FILE"
  export DEPLOY_VP_URL="${PRE_SERVICE_URL%/}/video-processor"
  node -e "require('fs').appendFileSync(process.env.DEPLOY_ENV_FILE, 'VIDEO_PROCESSOR_FUNCTION_URL: ' + JSON.stringify(process.env.DEPLOY_VP_URL) + '\n');"
fi

echo "🚀 Deploying Backend v2..."
echo "📦 Service: $SERVICE_NAME"
echo "🗺️ Region: $REGION"
echo "☁️ Project: $PROJECT_ID"
echo "📂 Source (monorepo root): $MONOREPO_ROOT  — includes ../locava-contracts for @locava/contracts"
echo "🧾 Carrying over old backend env families: Wasabi, Redis, analytics, admin tokens, worker flags, Firebase creds, client telemetry (defaults on)"
echo "⚙️  Cloud Run: memory=$MEMORY cpu=$CPU min=$MIN_INSTANCES max=$MAX_INSTANCES concurrency=$CONCURRENCY timeout=$TIMEOUT"
echo "🩺 Startup probe: $STARTUP_PROBE"

# Cloud Run source builds use the uploaded directory as Docker context. Backend v2 depends on
# `file:../locava-contracts`, so the context must be the monorepo root (./Dockerfile → Locava Backendv2/Dockerfile).
pushd "$MONOREPO_ROOT" >/dev/null
if ! "$GCLOUD_BIN" run deploy "$SERVICE_NAME" \
  --source . \
  --platform managed \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --allow-unauthenticated \
  --memory "$MEMORY" \
  --cpu "$CPU" \
  --min-instances "$MIN_INSTANCES" \
  --max-instances "$MAX_INSTANCES" \
  --concurrency "$CONCURRENCY" \
  --timeout "$TIMEOUT" \
  --startup-probe "$STARTUP_PROBE" \
  --port "$PORT" \
  --env-vars-file "$ENV_FILE"; then
  popd >/dev/null
  echo ""
  echo "❌ Deploy failed"
  echo "If the error mentions 'cloudbuild.builds.get', this account needs Cloud Build access on project $PROJECT_ID."
  echo "Minimum fix: grant roles/cloudbuild.viewer on project $PROJECT_ID."
  exit 1
fi
popd >/dev/null

SERVICE_URL="$("$GCLOUD_BIN" run services describe "$SERVICE_NAME" --region "$REGION" --project "$PROJECT_ID" --format='value(status.url)')"
VIDEO_PROCESSOR_FUNCTION_URL_VALUE="${SERVICE_URL%/}/video-processor"

# First deploy (no prior URL) or rare host change: env file could not include the worker URL — patch Cloud Run only then.
if [ -z "${PRE_SERVICE_URL:-}" ] || [ "${PRE_SERVICE_URL%/}" != "${SERVICE_URL%/}" ]; then
  echo "🎬 Setting Cloud Run VIDEO_PROCESSOR_FUNCTION_URL → $VIDEO_PROCESSOR_FUNCTION_URL_VALUE"
  if ! "$GCLOUD_BIN" run services update "$SERVICE_NAME" \
    --region "$REGION" \
    --project "$PROJECT_ID" \
    --update-env-vars="VIDEO_PROCESSOR_FUNCTION_URL=$VIDEO_PROCESSOR_FUNCTION_URL_VALUE"; then
    echo "⚠️  Could not set VIDEO_PROCESSOR_FUNCTION_URL on Cloud Run. Set it manually to: $VIDEO_PROCESSOR_FUNCTION_URL_VALUE"
  fi
else
  echo "🎬 VIDEO_PROCESSOR_FUNCTION_URL already baked into this deploy: $VIDEO_PROCESSOR_FUNCTION_URL_VALUE"
fi

export UPSERT_ENV_PATH="$PROJECT_ROOT/.env"
export UPSERT_VIDEO_PROCESSOR_URL="$VIDEO_PROCESSOR_FUNCTION_URL_VALUE"
node --input-type=module <<'UPSERT_ENV'
import fs from "node:fs";

const path = process.env.UPSERT_ENV_PATH ?? "";
const url = process.env.UPSERT_VIDEO_PROCESSOR_URL ?? "";
if (!path || !url) process.exit(0);
if (!fs.existsSync(path)) {
  console.warn(`Skipping .env upsert (missing file): ${path}`);
  process.exit(0);
}

const marker = "\n############################################\n# 🎬 VIDEO WORKER (Cloud Tasks → POST)\n############################################\n";
const line = `VIDEO_PROCESSOR_FUNCTION_URL=${url}\n`;
const re = /^VIDEO_PROCESSOR_FUNCTION_URL=.*$/m;

let text = fs.readFileSync(path, "utf8");
if (re.test(text)) {
  text = text.replace(re, line.trimEnd());
} else {
  const sep = text.endsWith("\n") || text.length === 0 ? "" : "\n";
  text = `${text}${sep}${marker.trim()}\n${line}`;
}
if (!text.endsWith("\n")) text += "\n";
fs.writeFileSync(path, text);
UPSERT_ENV

echo "📝 Locava Backendv2/.env — VIDEO_PROCESSOR_FUNCTION_URL set to this revision worker URL"

DASHBOARD_TOKEN="$(
  node --input-type=module <<'EOF_NODE'
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const envPaths = [
  path.resolve(cwd, ".env"),
  path.resolve(cwd, ".env.local"),
  path.resolve(cwd, "..", "Locava Backend", ".env"),
  path.resolve(cwd, "..", "Locava-Native", ".env")
];

for (const filePath of envPaths) {
  if (!fs.existsSync(filePath)) continue;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key === "INTERNAL_DASHBOARD_TOKEN" && value) {
      process.stdout.write(value);
      process.exit(0);
    }
  }
}
EOF_NODE
)"

echo "✅ Deploy complete"
echo "🌐 Service URL: $SERVICE_URL"
echo "🧪 Test health:"
echo "curl \"$SERVICE_URL/health\""
if [ -n "$DASHBOARD_TOKEN" ]; then
  echo "📊 Health dashboard:"
  echo "$SERVICE_URL/internal/health-dashboard?token=$DASHBOARD_TOKEN"
fi

# ========== Keep-warm Scheduler (optional; same pattern as Locava Backend maindeploy) ==========
if [ "$WARM_PING_ENABLED" = "true" ]; then
  echo ""
  echo "🧊 Configuring keep-warm Scheduler job..."
  echo "   Job: $WARM_PING_JOB_NAME"
  echo "   Schedule: $WARM_PING_SCHEDULE ($WARM_PING_TIMEZONE)"
  echo "   Target: $SERVICE_URL/health"
  echo ""
  "$GCLOUD_BIN" services enable cloudscheduler.googleapis.com --project "$PROJECT_ID" >/dev/null 2>&1 || true
  if "$GCLOUD_BIN" scheduler jobs describe "$WARM_PING_JOB_NAME" \
    --location "$REGION" \
    --project "$PROJECT_ID" >/dev/null 2>&1; then
    "$GCLOUD_BIN" scheduler jobs update http "$WARM_PING_JOB_NAME" \
      --location "$REGION" \
      --project "$PROJECT_ID" \
      --schedule "$WARM_PING_SCHEDULE" \
      --time-zone "$WARM_PING_TIMEZONE" \
      --http-method GET \
      --uri "$SERVICE_URL/health" \
      --attempt-deadline "30s" || echo "⚠️  Warm-ping job update failed (check Cloud Scheduler permissions)."
    echo "✅ Updated existing warm-ping job"
  else
    "$GCLOUD_BIN" scheduler jobs create http "$WARM_PING_JOB_NAME" \
      --location "$REGION" \
      --project "$PROJECT_ID" \
      --schedule "$WARM_PING_SCHEDULE" \
      --time-zone "$WARM_PING_TIMEZONE" \
      --http-method GET \
      --uri "$SERVICE_URL/health" \
      --attempt-deadline "30s" || echo "⚠️  Warm-ping job create failed (check Cloud Scheduler permissions)."
    echo "✅ Created new warm-ping job"
  fi
else
  echo ""
  echo "ℹ️  Keep-warm Scheduler skipped (WARM_PING_ENABLED=$WARM_PING_ENABLED)"
fi

echo ""
echo "🔎 Post-deploy smoke (HTTP status):"
HTTP_HEALTH="$(curl -sS -o /dev/null -w "%{http_code}" "$SERVICE_URL/health" || echo "000")"
HTTP_READY="$(curl -sS -o /dev/null -w "%{http_code}" "$SERVICE_URL/ready" || echo "000")"
echo "   GET /health → $HTTP_HEALTH (expect 200)"
echo "   GET /ready  → $HTTP_READY (expect 200)"
if [ "$HTTP_HEALTH" != "200" ] || [ "$HTTP_READY" != "200" ]; then
  echo "⚠️  Smoke check returned non-200; inspect Cloud Run logs and revision health."
fi
