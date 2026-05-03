#!/usr/bin/env bash

set -euo pipefail

SERVICE_NAME="locava-backend-v2"
REGION="us-central1"
PORT="8080"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

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
const envPaths = [
  path.resolve(cwd, ".env"),
  path.resolve(cwd, ".env.local"),
  path.resolve(cwd, "..", "Locava Backend", ".env"),
  path.resolve(cwd, "..", "Locava-Native", ".env")
];

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
    if (!(key in merged)) {
      merged[key] = value;
    }
  }
}

const projectId =
  process.env.GCP_PROJECT_ID ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  merged.GCP_PROJECT_ID ||
  merged.GOOGLE_CLOUD_PROJECT ||
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
  path.resolve(cwd, ".env"),
  path.resolve(cwd, ".env.local"),
  path.resolve(cwd, "..", "Locava Backend", ".env"),
  path.resolve(cwd, "..", "Locava-Native", ".env")
];

function parseEnvFile(filePath) {
  const values = {};
  if (!fs.existsSync(filePath)) return values;
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
    if (!(key in values)) values[key] = value;
  }
  return values;
}

const merged = {};
for (const filePath of envPaths) {
  const values = parseEnvFile(filePath);
  for (const [key, value] of Object.entries(values)) {
    if (!(key in merged)) merged[key] = value;
  }
}

const env = {
  NODE_ENV: "production",
  SERVICE_NAME: "locava-backend-v2",
  SERVICE_VERSION: process.env.SERVICE_VERSION || process.env.GIT_COMMIT_SHA || "manual",
  LOG_LEVEL: merged.LOG_LEVEL || "info"
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
  "POSTING_FINALIZE_SYNC_ACHIEVEMENTS",
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
echo "🧾 Carrying over old backend env families: Wasabi, Redis, analytics, admin tokens, worker flags, Firebase creds"

if ! "$GCLOUD_BIN" run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --allow-unauthenticated \
  --port "$PORT" \
  --env-vars-file "$ENV_FILE"; then
  echo ""
  echo "❌ Deploy failed"
  echo "If the error mentions 'cloudbuild.builds.get', this account needs Cloud Build access on project $PROJECT_ID."
  echo "Minimum fix: grant roles/cloudbuild.viewer on project $PROJECT_ID."
  exit 1
fi

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
