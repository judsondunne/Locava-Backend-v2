# Master Post V2 Rebuilder

## Why standardize posts

Locava post documents currently contain multiple overlapping media and metadata representations. This increases feed/runtime complexity and makes recoverability and validation inconsistent. Master Post V2 creates one canonical shape so one post can be safely normalized, inspected, validated, written additively, and reverted.

## What stays on main post doc

The canonical write keeps product-critical data directly on `/posts/{postId}`:

- `schema`
- `lifecycle`
- `author`
- `text`
- `location`
- `classification`
- `media` (including `media.assets[]` as canonical media truth)
- `engagement`
- `engagementPreview`
- `ranking`
- `compatibility`
- `legacy`
- `audit`

## What moves/copied to media processing debug docs

Large backend-only processing/debug payloads are copied to:

`/posts/{postId}/mediaProcessingDebug/masterPostV2`

When present, the extractor copies:

- `playbackLab`
- `videoProcessingProgress`
- `videoProcessingCompletedAt`
- `imageProcessingProgress`
- `posterFiles`
- large `asset.variantMetadata` slices
- `lastVerifyResults`
- `generationMetadata`
- `diagnosticsJson`
- processing errors/logs/stream inventories (if present)

No existing fields are deleted from the post yet.

## Master Post V2 shape

Canonical object written additively:

```ts
{
  id,
  schema,
  lifecycle,
  author,
  text,
  location,
  classification,
  media,
  engagement,
  engagementPreview,
  ranking,
  compatibility,
  legacy,
  audit
}
```

## Location display vs post title

- `text.title` is the real user-facing **post title** (e.g. `Lofoton🇳🇴` on an image post).
- `location.display.name` is the **place / address headline** for maps, pins, and location UI. This field **replaces** the earlier name `location.display.title` in the canonical contract to avoid confusion with `text.title`.
- `location.display.address` is the street or primary address line when present.
- `location.display.label` is a compact label (often the same as address or `locationLabel`) for feed/map/search chips when needed.
- `location.display.subtitle` prefers **`City, Country`** (or `State, Country`) from `geoData` when available.
- Rules: **never** fill `text.title` from location fallbacks; **never** copy `text.title` into `location.display.name`.

## Engagement: post document vs Firestore subcollections

**Observed production paths in Backend V2**

- **Post likes (subcollection):** `posts/{postId}/likes/{userId}` — created/removed by `PostMutationRepository` (`post-mutation.repository.ts`); list shape matches `PostLikesRepository` (`post-likes.repository.ts`) with `userName` / `userHandle` / `userPic` / `createdAt` on each like doc.
- **Post comments (subcollection):** `posts/{postId}/comments/{commentId}` — used by `CommentsRepository` when the post is in subcollection storage mode.
- **Embedded legacy:** some posts still carry `likes[]` and/or `comments[]` arrays on the root post document; counts may also be denormalized as `likesCount`, `likeCount`, `commentsCount`, `commentCount`, plus `likesVersion` / `commentsVersion`.

**Per-post rebuilder behavior (no mass migration)**

1. `auditPostEngagementSourcesV2(db, postId, rawPost)` loads:
   - Root post engagement fields and array lengths
   - Aggregate **count** on `posts/{postId}/likes` and `posts/{postId}/comments` when Firestore is available
   - A small window of **recent** like docs (newest first when `createdAt` index allows) and recent comment docs for preview/debug
2. The audit chooses a **selected source** per dimension (subcollection vs embedded array vs denormalized counts) and builds `recommendedCanonical` counts for the normalizer.
3. **Preview** returns `engagementSourceAudit` alongside the canonical preview; the canonical object also carries `audit.engagementSourceAuditSummary` when the audit runs.
4. **Write** re-runs the audit, normalizes with that audit, merges canonical fields only — it does **not** delete or rewrite `likes` / `comments` subcollections or arrays on the post.

**Liker preview preservation**

`engagementPreview.recentLikers[]` keeps the same ergonomic fields the product uses today when the data exists:

- `displayName` (from `userName` / legacy `name` / `displayName`)
- `handle` (`userHandle` / `handle`)
- `profilePicUrl` (`userPic` / `profilePicUrl` / common photo aliases on embedded rows)
- `likedAt` as ISO from `createdAt` / `likedAt` / timestamps

Full `likes[]` remains in **raw backup** and summaries under `legacy`; it is **not** the long-term canonical source of truth when subcollection data is authoritative — counts and this small preview are.

## Per-post rebuild flow

1. Load raw post from Firestore
2. Compute deterministic `rawHash`
3. Run `auditPostEngagementSourcesV2`
4. Normalize to Master Post V2
5. Validate canonical object (including engagement audit warnings when provided)
6. Extract media processing debug payload
7. Build diff summary
8. Optional write: requires `expectedHash` match and optional `force` for blocking validation errors (re-run audit immediately before write)

## Backup and revert safety

Before write, backup is created at:

`/postCanonicalBackups/{postId}_{timestamp}`

Backup stores:

- `postId`
- `createdAt`
- `rawBefore`
- `rawHash`
- `canonicalPreview`
- `engagementSourceAudit` (when computed at write time)
- `mediaProcessingDebugPreview`

Revert endpoint restores `rawBefore` exactly to `/posts/{postId}` with `set(..., { merge: false })`.

## Debug UI modes

The `/debug/post-rebuilder` page now supports:

- **Manual mode:** same original one-post flow, but inside a multi-post queue. Select one post, then run raw / preview / write / backups / revert on that selected card.
- **Auto mode:** sequential preview or preview+write queue processing with per-post status tracking. Each post still uses the same per-post backend preview/write safety logic.

## Testing real posts in the debug UI

Use debug UI:

1. Open `/debug/post-rebuilder`
2. Either paste one or many comma-separated `postId` values, or load the newest `N` posts
3. In manual mode, select a post card and load raw / preview canonical + validation + diff
4. Write only if the hash still matches preview and validation is clear
5. In auto mode, preview or preview+write the queue sequentially with per-post status tracking
6. If needed, list backups and revert by backup ID on the selected post

## What this does not do yet

- Not a mass migration
- No deleting legacy fields
- No native app contract changes
- No feed-wide routing changes
- No automatic background migration jobs
