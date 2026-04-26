#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"

curl -sS "$BASE_URL/health" | jq .
curl -sS "$BASE_URL/ready" | jq .
curl -sS "$BASE_URL/version" | jq .
curl -sS "$BASE_URL/routes" | jq .
curl -sS "$BASE_URL/test/ping" | jq .
curl -sS -X POST "$BASE_URL/test/echo" -H "content-type: application/json" -d '{"message":"hello","payload":{"source":"script"}}' | jq .
curl -sS "$BASE_URL/test/slow?ms=120" | jq .
curl -sS "$BASE_URL/test/db-simulate?reads=3&writes=2" | jq .
curl -sS "$BASE_URL/diagnostics" | jq .
