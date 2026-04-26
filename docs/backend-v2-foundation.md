# Locava Backend V2 Foundation

## Local run

```bash
cd "Locava Backendv2"
npm install
npm run dev
```

## Local curl tests

```bash
BASE_URL=http://localhost:8080 ./scripts/test-local.sh
```

Individual examples:

```bash
curl -sS http://localhost:8080/health | jq .
curl -sS http://localhost:8080/ready | jq .
curl -sS http://localhost:8080/version | jq .
curl -sS http://localhost:8080/routes | jq .
curl -sS -X POST http://localhost:8080/test/echo -H 'content-type: application/json' -d '{"message":"hello"}' | jq .
curl -sS "http://localhost:8080/test/slow?ms=250" | jq .
curl -sS "http://localhost:8080/test/db-simulate?reads=3&writes=2" | jq .
curl -sS http://localhost:8080/diagnostics | jq .
```

Dashboard:

```bash
open http://localhost:8080/admin
```

## Deploy to Cloud Run (manual)

```bash
PROJECT_ID="your-gcp-project"
REGION="us-central1"
SERVICE="locava-backend-v2"
IMAGE="us-central1-docker.pkg.dev/$PROJECT_ID/$SERVICE/$SERVICE:$(git rev-parse --short HEAD)"

gcloud auth login
gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

gcloud artifacts repositories create "$SERVICE" --repository-format=docker --location="$REGION" || true

gcloud builds submit --tag "$IMAGE"

gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --set-env-vars NODE_ENV=production,SERVICE_NAME=locava-backend-v2,SERVICE_VERSION=$(git rev-parse --short HEAD)
```

After deploy:

```bash
SERVICE_URL="$(gcloud run services describe locava-backend-v2 --region us-central1 --format='value(status.url)')"
curl -sS "$SERVICE_URL/health" | jq .
curl -sS "$SERVICE_URL/diagnostics" | jq .
```

## Observability foundations included

- Structured JSON logs with request metadata
- Request IDs from `x-request-id` fallback to generated UUID
- Latency timing on all requests
- Error classification (`validation_error`, `timeout`, `internal_error`)
- Route manifest and OpenAPI-like contract endpoint
- Per-request DB operation counters (`reads`, `writes`, `queries`) via repository instrumentation hooks
- Diagnostics endpoint and admin dashboard for recent route behavior
