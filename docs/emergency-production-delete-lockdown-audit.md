# Emergency Production Delete Lockdown Audit

This audit covers the dangerous debug, harness, test, restore, and reseed paths identified during the production `/posts` incident lockdown.

| File path | Package script name(s) | Exact dangerous operation | Can touch `/posts` | Can run against production before lockdown | Action taken |
| --- | --- | --- | --- | --- | --- |
| `scripts/debug-feed-for-you-simple.mts` | `debug:feed-for-you:simple`, `debug:feed:for-you-simple`, `debug:feed:for-you-ready-deck` | `wipePostsCollection()` batch-deleted `/posts`, then `seedPosts(...)` rewrote harness fixtures | Yes | Yes | Disabled permanently with top-level throw; npm aliases now routed to `scripts/safety/refuse-dangerous-script.cjs` |
| `scripts/debug-reset-feed-state.mts` | `debug:reset-feed-state` | Deletes `feedState` and optional `feedServed` rows | No | Yes | Guarded with `assertEmulatorOnlyDestructiveFirestoreOperation(...)` |
| `scripts/backfill-post-random-key.mts` | `backfill:post-random-key` | Batch set across `/posts` for `randomKey` | Yes | Yes | Guarded with emulator-only destructive confirmation |
| `scripts/backfill-user-search-fields.mts` | `backfill:user-search-fields` | Writes user search fields when not dry-run | No | Yes | Guarded for non-dry-run writes |
| `scripts/backfill-user-phone-search-keys.mts` | `backfill:user-phone-search-keys` | Writes user phone search keys when `--write` is used | No | Yes | Guarded for write mode |
| `scripts/repair-user-document-shape.mts` | none | Writes repaired user document shape when `--apply` is used | No | Yes | Guarded for apply mode |
| `scripts/seed-inbox-notifications.mts` | `debug:notifications:seed-inbox` | Inserts notification rows when not dry-run | No | Yes | Guarded for non-dry-run execution |
| `scripts/audit-home-feeds.mts` | `budget:home-feeds` | Deletes viewer feed-state rows before audit | No | Yes | Guarded before delete path |
| `scripts/debug-full-app-v2-audit.mts` | `debug:full-app:v2-audit` | Creates and deletes fixture posts/comments/users | Yes | Yes | Guarded at top-level before any Firebase init/write path |
| `scripts/debug-real-user-v2-semantics.mts` | `debug:real-user:v2-semantics` | Writes semantic probe fixtures | Yes | Yes | Guarded at top-level before any Firebase init/write path |
| `scripts/emergency-restore-posts-from-canonical-backups.ts` | `emergency:restore-posts:dry-run`, `emergency:restore-posts:apply` | Restore flow can overwrite `/posts` from backup payloads | Yes | Yes | `--apply` path permanently disabled; package apply script routed to refusal stub; dry-run kept read-only |
| `test/firestore/common.mts` | `test:firestore:reset`, `test:firestore:seed`, `test:deterministic` | Emulator reset wipes docs including `/posts`; seed repopulates fixtures | Yes | No, but destructive | Guarded with emulator-only confirmation and explicit logging |
| `src/routes/v2/feed-for-you-simple.routes.test.ts` | `test:feed.for-you.simple`, `test:feed-for-you:simple:emulator` | Emulator test deletes `/posts`, reseeds posts, writes `feedSeen` fixtures | Yes | Yes if misconfigured source client | Guarded around every destructive helper used in test setup |
| `src/routes/v2/feed-for-you.routes.test.ts` | `test:feed-for-you:emulator` | Emulator test seeds `/posts` and `feedState` fixtures | Yes | Yes if misconfigured source client | Guarded around test write helpers |
| `src/routes/debug/post-rebuilder.routes.ts` | none | Debug route can overwrite `/posts` and user-post mirrors | Yes | Yes | Kept but route registration is gated to explicit emulator-only confirmations |
| `src/routes/debug/emergency-post-restore.routes.ts` | none | Debug route can restore and overwrite `/posts` | Yes | Yes | Kept but route registration is gated to explicit emulator-only confirmations |
| `src/routes/debug/post-canonical-backups-restore-preview.routes.ts` | none | Debug restore preview participates in `/posts` restore workflow | Yes | Yes | Kept but route registration is gated to explicit emulator-only confirmations |

## New Safety Files

- `src/safety/firestoreDestructiveGuard.ts`
- `scripts/safety/refuse-dangerous-script.cjs`
- `scripts/safety/destructive-firestore-scan.ts`
- `scripts/safety/audit-destructive-firestore.ts`
- `scripts/safety/assert-no-production-delete-scripts.ts`

## Remaining Risky Files

- `scripts/repair-video-playback-faststart.mts`
  It does not delete or overwrite Firestore directly, but it can enqueue repair work that may mutate post-processing state later. It is documented as operationally risky and should remain manual-only.
- `src/routes/debug/local-debug.routes.ts`
  This file contains bulk delete/set helpers for non-post debug collections. It was not part of the `/posts` incident path, but it remains a dangerous local-debug surface and should be handled cautiously.
