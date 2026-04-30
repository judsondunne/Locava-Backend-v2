# Feed For You V2 Architecture

## Endpoint

- `GET /v2/feed/for-you`
- Query: `viewerId?`, `limit`, `cursor?`, `debug?`
- Response: deterministic page of post cards, `nextCursor`, `exhausted`, optional debug diagnostics.

## Layering

- Route: `src/routes/v2/feed-for-you.routes.ts`
- Contract: `src/contracts/surfaces/feed-for-you.contract.ts`
- Orchestration: `src/orchestration/surfaces/feed-for-you.orchestrator.ts`
- Service (ranking + mixing + cursor): `src/services/surfaces/feed-for-you.service.ts`
- Repository (candidate windows + served tracking writes): `src/repositories/surfaces/feed-for-you.repository.ts`

## Candidate Strategy

- Reel bucket: `posts where reel == true`, ordered by recency.
- Regular bucket: recency window from `posts`, then in-memory filter for `reel !== true`.
- Firestore bounded oversample windows only; no global NOT IN scan.
- Served exclusion is done by reading `users/{viewerId}/feedServed/{postId}` only for candidate IDs.

## Ranking + Mixing

- Deterministic score inputs:
  - reel boost
  - recency decay
  - lightweight engagement signal (`likes + comments`)
  - deterministic postId tiebreaker
- Mix policy:
  - strong reel preference
  - regular insertion around every 6th/7th slot while reels remain
  - fallback to regular once reels are exhausted
- Author diversity:
  - swap pass prevents 3+ consecutive posts from same author when alternatives exist.

## Served Tracking

- Collection: `users/{viewerId}/feedServed/{postId}`
- Written only for posts actually returned.
- Batched write commit per page.
- Fields:
  - `postId`
  - `servedAt`
  - `feedSurface = "home_for_you"`
  - `feedRequestId`
  - `rank`
  - `sourceBucket`
  - `authorId`
  - `reel`

## Required Indexes

- `posts(reel asc, time desc)`
- `posts(visibility asc, reel asc, time desc)`
- `posts(status asc, reel asc, time desc)`
- `posts(time desc)`
- `posts(userId asc, time desc)` (author diversity/author-scoped diagnostics support)

## Verification checklist

- Emulator integration route tests:
  - `npm run test:feed-for-you:emulator`
- Unit tests:
  - `npm run test:feed-for-you`
- Budget audit:
  - `npm run budget:feed-for-you`
- Restart/served-flow probe:
  - `npm run debug:feed-for-you:served-flow`
- Expected endpoint:
  - `GET http://127.0.0.1:${PORT:-8080}/v2/feed/for-you?viewerId=<id>&limit=12&debug=1`
- Required local env vars:
  - `FIRESTORE_TEST_MODE=emulator` and `FIRESTORE_EMULATOR_HOST=<host:port>` (for emulator route tests)
  - `FIRESTORE_SOURCE_ENABLED=true`
  - `PORT` (optional; defaults to `8080`) for budget audit
  - `DEBUG_VIEWER_ID` (optional) for budget audit
- Known acceptable limitations:
  - budget audit assumes local server is already running and warmup request succeeds
  - emulator route tests depend on seeded deterministic fixtures plus local test-seeded for-you posts

