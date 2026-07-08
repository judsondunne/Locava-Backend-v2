#!/usr/bin/env bash
# Deploy composite indexes from firestore.indexes.json (read-only Firestore operation).
#
# Staging-first workflow (Fable A6):
#   ./scripts/deployFirestoreIndexes.sh demo-locava-backendv2
#   npm run test:deterministic -- src/repositories/mixPosts.repository.test.ts
# Production (after staging index is Enabled):
#   CONFIRM_PRODUCTION_INDEX_DEPLOY=1 ./scripts/deployFirestoreIndexes.sh learn-32d72
#
# Index status: Firebase console → Firestore → Indexes (wait until "Enabled", not "Building").

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PRODUCTION_PROJECT_ID="learn-32d72"

cd "$PROJECT_ROOT"

PROJECT_ID="${1:-${GCP_PROJECT_ID:-${FIREBASE_PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-}}}}"
if [ -z "$PROJECT_ID" ]; then
  echo "❌ No project id. Usage: $0 <firebase-project-id>"
  echo "   Or set GCP_PROJECT_ID / FIREBASE_PROJECT_ID in the environment."
  exit 1
fi

if [ "$PROJECT_ID" = "$PRODUCTION_PROJECT_ID" ]; then
  if [ "${CONFIRM_PRODUCTION_INDEX_DEPLOY:-}" != "1" ]; then
    echo "❌ Refusing production index deploy to $PROJECT_ID without confirmation."
    echo "   Deploy to staging first: $0 demo-locava-backendv2"
    echo "   Then re-run with: CONFIRM_PRODUCTION_INDEX_DEPLOY=1 $0 $PROJECT_ID"
    exit 1
  fi
  echo "⚠️  Deploying Firestore indexes to PRODUCTION project: $PROJECT_ID"
else
  echo "📋 Deploying Firestore indexes to project: $PROJECT_ID"
fi

if ! command -v firebase >/dev/null 2>&1 && ! command -v npx >/dev/null 2>&1; then
  echo "❌ firebase-tools not available (install firebase-tools or use npx)"
  exit 1
fi

FIREBASE_BIN="${FIREBASE_BIN:-firebase}"
if ! command -v "$FIREBASE_BIN" >/dev/null 2>&1; then
  FIREBASE_BIN="npx --yes firebase-tools"
fi

export FIREBASE_SKIP_UPDATE_CHECK="${FIREBASE_SKIP_UPDATE_CHECK:-true}"
export CI="${CI:-true}"

if ! $FIREBASE_BIN projects:list --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo "❌ Firebase CLI is not authenticated for project $PROJECT_ID."
  echo ""
  echo "Try in order:"
  echo "  1) Fix config dir permissions (if update check failed):"
  echo "       sudo chown -R \"\$USER\":\$(id -gn \"\$USER\") ~/.config"
  echo "  2) Login (no global install required):"
  echo "       FIREBASE_SKIP_UPDATE_CHECK=true npx firebase-tools login --no-localhost"
  echo "  3) Or use a service account already on this machine:"
  echo "       export GOOGLE_APPLICATION_CREDENTIALS=/path/to/firebase-adminsdk.json"
  echo "       $0 $PROJECT_ID"
  echo ""
  echo "Manual fallback (Firebase console → Firestore → Indexes → Single field):"
  echo "  Confirm posts / time is indexed (Descending), not exempted"
  exit 1
fi

echo "📂 Index source: $PROJECT_ROOT/firestore.indexes.json"
$FIREBASE_BIN deploy --only firestore:indexes --project "$PROJECT_ID" --non-interactive

echo ""
echo "✅ Index deploy submitted. Open Firebase console → Firestore → Indexes and wait until new indexes show Enabled before shipping code that depends on them."
