#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:18081}"
VIEWER_ID="${VIEWER_ID:-user-self}"
OUT_DIR="${OUT_DIR:-docs/evidence}"

mkdir -p "$OUT_DIR"

json_get() {
  jq -r "$1"
}

get() {
  local url="$1"
  curl -sS "$BASE_URL$url" -H "x-viewer-id: $VIEWER_ID"
}

post() {
  local url="$1"
  local body="$2"
  curl -sS -X POST "$BASE_URL$url" -H "x-viewer-id: $VIEWER_ID" -H "content-type: application/json" -d "$body"
}

run_startup_fanin() {
  for i in $(seq 1 8); do
    get "/v2/auth/session" >/dev/null &
    get "/v2/bootstrap" >/dev/null &
    get "/v2/feed/bootstrap" >/dev/null &
    get "/v2/notifications?limit=20" >/dev/null &
    get "/v2/chats/inbox?limit=10" >/dev/null &
    get "/v2/achievements/hero" >/dev/null &
    get "/v2/achievements/snapshot" >/dev/null &
    get "/v2/map/bootstrap?bbox=-125.0%2C24.0%2C-66.0%2C49.0&limit=120" >/dev/null &
    wait
  done
}

run_feed_burst() {
  local post_id="$1"
  for i in $(seq 1 10); do
    get "/v2/feed/bootstrap" >/dev/null &
    get "/v2/feed/page?limit=10" >/dev/null &
    get "/v2/feed/items/$post_id/detail" >/dev/null &
    post "/v2/posts/$post_id/like" "{\"clientMutationKey\":\"like-final-$i\"}" >/dev/null &
    post "/v2/posts/$post_id/save" "{\"clientMutationKey\":\"save-final-$i\"}" >/dev/null &
    post "/v2/posts/$post_id/comments" "{\"text\":\"final flow comment $i\",\"clientMutationKey\":\"cmk-final-$i\"}" >/dev/null &
    wait
  done
}

run_profile_search_burst() {
  local author_id="$1"
  local post_id="$2"
  for i in $(seq 1 8); do
    get "/v2/profiles/$author_id/bootstrap" >/dev/null &
    get "/v2/profiles/$author_id/posts/$post_id/detail" >/dev/null &
    get "/v2/search/results?q=creator&limit=10" >/dev/null &
    get "/v2/search/users?q=creator&limit=8" >/dev/null &
    get "/v2/directory/users?q=creator&limit=8" >/dev/null &
    wait
  done
}

run_posting_burst() {
  local session
  local session_id
  local finalize
  local operation_id

  session="$(post "/v2/posting/upload-session" '{"clientSessionId":"final-session-main"}')"
  echo "$session" > "$OUT_DIR/final-posting-session.json"
  session_id="$(echo "$session" | json_get '.data.session.id')"

  for i in $(seq 1 4); do
    local register
    local media_id
    register="$(post "/v2/posting/media/register" "{\"sessionId\":\"$session_id\",\"clientMediaId\":\"final-media-$i\",\"mimeType\":\"image/jpeg\",\"bytes\":1024}")"
    media_id="$(echo "$register" | json_get '.data.media.id')"
    post "/v2/posting/media/$media_id/mark-uploaded" '{"uploadedBytes":1024}' >/dev/null
    get "/v2/posting/media/$media_id/status" >/dev/null
  done

  finalize="$(post "/v2/posting/finalize" "{\"sessionId\":\"$session_id\",\"caption\":\"final verification post\"}")"
  echo "$finalize" > "$OUT_DIR/final-posting-finalize.json"
  operation_id="$(echo "$finalize" | json_get '.data.operation.id')"

  for i in $(seq 1 10); do
    get "/v2/posting/operations/$operation_id" >/dev/null &
    get "/v2/notifications?limit=20" >/dev/null &
    wait
  done
}

run_chat_burst() {
  local conversation_id="$1"
  for i in $(seq 1 10); do
    get "/v2/chats/inbox?limit=10" >/dev/null &
    get "/v2/chats/$conversation_id/messages?limit=20" >/dev/null &
    post "/v2/chats/$conversation_id/messages" "{\"text\":\"final chat $i\",\"clientMessageId\":\"final-cmid-$i\"}" >/dev/null &
    post "/v2/chats/$conversation_id/mark-read" "{}" >/dev/null &
    wait
  done
}

run_collections_notifications_burst() {
  local post_id="$1"
  for i in $(seq 1 8); do
    get "/v2/collections/saved?limit=12" >/dev/null &
    post "/v2/posts/$post_id/save" "{\"clientMutationKey\":\"save-col-$i\"}" >/dev/null &
    post "/v2/posts/$post_id/unsave" "{\"clientMutationKey\":\"unsave-col-$i\"}" >/dev/null &
    get "/v2/notifications?limit=20" >/dev/null &
    post "/v2/notifications/mark-read" '{"notificationIds":["notif-1"]}' >/dev/null &
    wait
  done
}

get "/health" > "$OUT_DIR/final-health.json"
feed="$(get "/v2/feed/bootstrap")"
echo "$feed" > "$OUT_DIR/final-feed-bootstrap.json"
post_id="$(echo "$feed" | json_get '.data.items[0].post.id')"
author_id="$(echo "$feed" | json_get '.data.items[0].author.id')"
inbox="$(get "/v2/chats/inbox?limit=10")"
echo "$inbox" > "$OUT_DIR/final-chats-inbox.json"
conversation_id="$(echo "$inbox" | json_get '.data.conversations[0].id')"

run_startup_fanin
run_feed_burst "$post_id"
run_profile_search_burst "$author_id" "$post_id"
run_posting_burst
run_chat_burst "$conversation_id"
run_collections_notifications_burst "$post_id"

get "/diagnostics?limit=200" > "$OUT_DIR/final-diagnostics-process-local.json"
get "/ready" > "$OUT_DIR/final-ready-process-local.json"

echo "final verification load complete"
