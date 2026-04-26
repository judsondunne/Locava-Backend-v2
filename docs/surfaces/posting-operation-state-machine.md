# Posting Operation State Machine (Durable)

Date: 2026-04-20  
Scope: `Locava Backendv2` posting control-plane state model for session/finalize/status/cancel/retry.

## Why this state machine exists

Posting must remain safe under retries, offline replay, ambiguous timeouts, and process restarts.  
This model defines strict transitions so requests are idempotent and pressure-safe.

## Current implicit states (before this phase)

Session states (implicit):

- `open`
- `finalized`
- `expired`

Operation states (implicit):

- `processing`
- `completed`
- `failed`

Gaps before this phase:

- state storage was in-memory only,
- no explicit cancel/retry transition model,
- no completion invalidation hook.

## Durable state model (this phase)

### Upload session states

- `open`: session accepted, finalize allowed.
- `finalized`: finalize already accepted for this session.
- `expired`: session TTL exceeded.

### Operation states

- `processing`: finalize accepted, publish flow in progress.
- `completed`: publish outcome accepted as complete.
- `failed`: operation failed and can be retried.
- `cancelled`: operation cancelled by client intent.

## Allowed transitions

Session transitions:

- create -> `open`
- `open` -> `finalized` (on first finalize acceptance)
- `open` -> `expired` (TTL)

Operation transitions:

- create on finalize -> `processing`
- `processing` -> `completed` (status progression)
- `processing` -> `failed` (failure path; current deterministic flow reserves this for explicit future failure hooks)
- `processing` -> `cancelled` (cancel route)
- `cancelled` -> `processing` (retry route)
- `failed` -> `processing` (retry route)

## Invalid transitions (explicit)

- finalize when session is not `open` -> invalid (`session_not_open` / expired / not found).
- cancel on `completed` -> invalid transition (`operation_cancel_not_allowed`).
- retry on `completed` -> invalid transition (`operation_retry_not_allowed`).

## Idempotent no-op semantics

- repeated session create with same `(viewerId, clientSessionKey)` -> replay existing session.
- repeated finalize with same `(viewerId, idempotencyKey)` -> replay existing operation/post.
- repeated cancel on already `cancelled` -> idempotent no-op.
- repeated retry while already `processing` -> idempotent no-op.

## Cancel semantics

- cancel is scoped to a single operation id.
- cancel does not perform broad media cleanup.
- cancel does not trigger feed/profile/search cache flushes.
- cancel records terminal state `cancelled` and prevents further progress until explicit retry.

## Retry semantics

- retry is scoped to a single operation id.
- retry never creates a new post identity for the same operation.
- retry reuses existing operation/session linkage and returns same `postId`.
- retry transitions operation back to `processing` and increments attempt metadata.

## Completion invalidation semantics

On first transition to `completed`, apply **scoped** invalidation:

- `post:{postId}:social`
- `post:{postId}:card`
- `post:{postId}:detail`
- `post:{postId}:viewer:{viewerId}:state`
- targeted detail route keys only where deterministic

Intentionally **not** invalidated:

- feed/search/profile list caches broadly.

Accepted stale windows:

- list surfaces may remain stale until TTL; detail/entity-level freshness is prioritized to avoid invalidation storms.

## Ambiguity/replay cases that must remain safe

- finalize timeout then replay finalize request,
- restart then status polling on existing operation id,
- restart then retry/cancel on existing operation id,
- duplicate retry/cancel requests from weak network.

## Intentionally unsupported (for now)

- full media-plane durable task orchestration,
- distributed multi-instance durable locking,
- broad route cache refresh on completion,
- client cutover behavior changes.
