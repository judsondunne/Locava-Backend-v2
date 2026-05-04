# Native Post Media Backend Compatibility Audit (2026-05-04)

## Executive Summary

**Conclusion: mixed.**

- Backend v2 can and should normalize media contracts globally to fix several production bugs immediately (duplicate-first-asset payloads, inconsistent route shapes, video variant quality/fast-start selection).
- However, the current native build still has multiple surfaces that intentionally read only hero/thumb fields or `assets[0]`, so **not all media rendering bugs can be fully solved by backend-only changes**.
- Immediate recommendation for App Store review window: **ship backend normalization hardening now, but do not claim full multi-asset parity across all surfaces until native updates land.**

Final recommendation string required by request:

**Do not attempt backend-only fix because native app requires code changes.**

---

## Native Surface Audit (Read-Only)

| Native surface/component | Native file(s) audited | Backend endpoint(s) supplying posts | Media fields read by native | Array vs single behavior | Backend-only fix possible? | Risk |
|---|---|---|---|---|---|---|
| For You feed item normalization | `Locava-Native/src/features/home/backendv2/feedV2.normalize.ts` | `/v2/feed/for-you/simple` | `item.assets?.[0]`, `item.media.posterUrl`, `item.firstAssetUrl` | **Single first asset** | Partial only (poster/quality fixes) | High |
| Liftable fullscreen carousel | `Locava-Native/src/features/liftable/AssetCarouselOnly.tsx` | Hydrated post payloads from feed/profile/map/search/chat open flows | canonical normalized asset list from `normalizeClientCarouselListFromPost(post)` | **Full array** | Yes, strong | Low |
| Reusable post tile (grid/list/chat card) | `Locava-Native/src/features/liftable/PostTile.tsx` | profile/map/search/chat cards | `displayPhotoLink`, `thumbUrl`, `getHeroUri`, `assets?.[0]` | Mostly hero + first asset | Partial | Medium |
| Chat shared post message bubble | `Locava-Native/src/features/chatThread/components/MessageBubble.tsx` | chats message payloads | `post.displayPhotoLink ?? post.thumbUrl ?? post.photoLink` | Single thumb preview | Partial | Medium |

### Legacy/native fields still actively consumed

- `thumbUrl`
- `displayPhotoLink`
- `photoLink`
- `media.posterUrl`
- first-asset derived fields (`assets[0].posterUrl`, `assets[0].previewUrl`, `assets[0].streamUrl`, `assets[0].mp4Url`)

### Native evidence summary

- For You card normalization is hardcoded to first asset:
  - `feedV2.normalize.ts` reads `item.assets?.[0]` for poster, preview, stream, mp4.
- Fullscreen viewer is array-capable:
  - `AssetCarouselOnly.tsx` consumes normalized carousel list and renders horizontal pages from complete list.
- Chat/post tile previews remain thumb-centric:
  - `MessageBubble.tsx` and `PostTile.tsx` prioritize legacy single-image fields.

Implication: backend can improve what these surfaces display, but backend cannot force these surfaces to become array-aware if they are coded as single-preview surfaces.

---

## Backend v2 Route Audit (Post/Post-Like Responses)

| Route/surface | Backend file(s) audited | Current media-shape path | Uses canonical `buildPostEnvelope` + `normalizePostAssets`? | Inconsistency risk |
|---|---|---|---|---|
| `/v2/feed/bootstrap` | `src/routes/v2/feed-bootstrap.routes.ts` | post card contracts | Yes | Low |
| `/v2/feed/page` | `src/routes/v2/feed-page.routes.ts` | post card contracts | Yes | Low |
| `/v2/feed/for-you/simple` | `src/routes/v2/feed-for-you-simple.routes.ts`, `src/services/surfaces/feed-for-you-simple.service.ts`, `src/repositories/surfaces/feed-for-you-simple.repository.ts` | compact DTO from candidate mapper | **Partial** (custom mapper, only first asset in repository normalization) | High |
| `/v2/feed/for-you` | `src/routes/v2/feed-for-you.routes.ts` + service/repo stack | compact DTO | Partial/custom | High |
| Legacy radius reels `/api/v1/product/reels/near-me` | `src/routes/compat/legacy-reels-near-me.routes.ts` | `mapLegacyReelsItem` manual mapping | **No** | High |
| `/v2/map/markers` | `src/routes/v2/map-markers.routes.ts` | compact marker DTO + `openPayload` | Marker compact: no; openPayload fallback: yes | Medium |
| `/v2/search/bootstrap` and `/v2/search/live` | `src/routes/v2/search-discovery.routes.ts` | `postToSearchRow` thin mapper | **No** | High |
| `/v2/search/results` | `src/routes/v2/search-results.routes.ts` + orchestrator/service | sectioned search results | Mostly canonical | Medium-Low |
| Search mixes routes | `src/routes/v2/search-mixes*.ts` + orchestrator | compact mix previews | Custom compact by design | Medium |
| Collections surfaces returning post cards | `src/routes/v2/collections-*.routes.ts` (plus services/orchestrators) | generally post card summaries | Mostly yes | Medium-Low |
| Chat surfaces returning shared post previews | `src/routes/v2/chats-*.routes.ts` | embedded post summary + legacy thumb compatibility | Mixed | Medium |

---

## Canonical Media Contract (Backend v2 Target)

Canonical source of truth already exists:

- `src/contracts/post-assets.contract.ts`
- `src/lib/posts/post-envelope.ts`

### Required canonical shape per post

- `assets[]`: all real assets, exactly once, stable order.
- `assetCount`, `hasMultipleAssets`, `rawFirestoreAssetCount`, `mediaCompleteness`, `requiresAssetHydration`.
- Backward-compatible aliases:
  - `thumbUrl`, `displayPhotoLink`, `photoLink`, `posterUrl`, `firstAssetUrl`, `media.posterUrl`.
- Video playback fields:
  - asset-level `variants` and resolved playback hints (`hls`, `main720*`, `main1080*`, `preview360*`, `poster`).

### Video selection/normalization rule set (backend)

- Never surface low-quality preview as final primary playback when a higher playable variant exists.
- Preferred order for usable playback URL:
  1. `hls`
  2. fast-start/main AVC (`main720Avc`, `main1080Avc`, startup faststart variants as appropriate)
  3. labeled HEVC mains
  4. preview-only fallback (`preview360*`) only when no better playable source exists.
- Preserve poster/thumbnail fallback fields separately from playback URL.

### Photo normalization rule set (backend)

- Preserve input order after sanitization.
- Deduplicate by stable asset identity/URL.
- Keep `assets[0]` aligned with legacy cover fields while preserving full `assets[]`.
- Never clone first asset into all indexes.

---

## Inconsistencies Found

1. **For You simple repository truncates assets to first item**
   - `src/repositories/surfaces/feed-for-you-simple.repository.ts` (`normalizeAssets`) currently caps to one asset.
2. **Legacy near-me route manually maps media**
   - `src/routes/compat/legacy-reels-near-me.routes.ts` uses custom `mapLegacyReelsItem` instead of canonical envelope/normalizer.
3. **Search discovery uses thin post mapper**
   - `src/routes/v2/search-discovery.routes.ts` `postToSearchRow` outputs thumb/title/activity only.
4. **Marker compact payload intentionally thin**
   - `src/routes/v2/map-markers.routes.ts` compact mode is marker/thumb-focused; only `openPayload` fallback goes through envelope.

---

## Backend-Only Immediate Plan (Safe During App Store Review)

1. Route unification (backend-only):
   - Ensure all post-returning routes pass through one shared post media normalizer path before response serialization.
2. Preserve compatibility:
   - Keep all legacy aliases (`thumbUrl`, `displayPhotoLink`, `photoLink`, etc.) for existing native consumers.
3. Video playback hardening:
   - Enforce canonical variant precedence globally.
4. Cross-surface parity checks:
   - Add test fixtures and a debug comparator for same `postId` across feed/profile/map/search/chat/collections.

---

## Native Changes Ideal Later (Not for immediate review build)

- Replace first-asset-only feed/list readers with array-aware rendering where multi-photo UX is expected.
- Reduce dependency on legacy thumb aliases and converge to canonical `assets[]` + `media` contract.
- Standardize preview components to avoid per-surface field preference drift.

---

## Final Answer to Main Question

Can current bugs be fixed purely by backend response normalization?

- **Partially yes** for:
  - duplicate/incorrect backend asset arrays,
  - cross-route contract inconsistency,
  - video quality/fast-start selection regressions.
- **No for complete bug class elimination** because some native surfaces are first-asset or thumb-only consumers today.

Therefore:

**Do not attempt backend-only fix because native app requires code changes.**

For the App Store-review build specifically:

- Backend redeploy is still recommended now for consistency/quality improvements and risk reduction.
- But set expectation that some “show all assets everywhere” behavior requires follow-up native release.
