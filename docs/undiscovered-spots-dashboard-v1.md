# Undiscovered Spots — Dashboard V1

A review layer that turns raw discovery output into a repeatable candidate →
reviewed → approved → written workflow. First test region: **Vermont**.
First source: **OSM PBF v2**. Designed so additional channels
(Wikimedia / Reddit / Instagram / blogs / trail DBs) plug into the same queue.

## Why

Undiscovered spots have been a manual, one-off upload push. This adds a small,
channel-agnostic structure so any source can feed one review queue, be gated by
the existing PBF quality rules, and — once approved — be written to the same two
collections (`unexploredSpots` / `unexploredRoutes`). It never writes `/posts`.

## What this PR adds

| Area | File |
| --- | --- |
| Unified candidate contract + review state machine + categories + quality rules | `src/contracts/surfaces/undiscovered-candidate.contract.ts` |
| OSM PBF preview doc → candidate adapter | `src/lib/undiscovered/pbfPreviewToDiscoveryCandidate.ts` |
| In-memory review store (validated transitions) | `src/admin/undiscovered/discoveryCandidateStore.ts` |
| JSON API | `src/routes/admin/undiscovered-dashboard.routes.ts` |
| Dashboard page | `src/dashboard/undiscovered-dashboard-v1.ts` |
| Vermont demo sample | `src/lib/undiscovered/vermontSampleCandidates.ts` |
| Wiring | `src/routes/admin.routes.ts`, `src/app/createApp.ts` |
| Tests | `discoveryCandidateStore.test.ts`, `pbfPreviewToDiscoveryCandidate.test.ts` |

## The model

A `DiscoveryCandidate` is channel-agnostic:

- `sourceChannel`: `osm_pbf | wikimedia | reddit | instagram | web_blog | trail_db | outdoor_db | manual`
- `reviewStatus`: `candidate → reviewed → approved → written` (+ `rejected`), with
  a transition table (`DISCOVERY_STATUS_TRANSITIONS`) enforced by the store — e.g.
  `candidate → written` is rejected; only `approved` items are write-eligible.
- `qualityGate`: `{ passed, reasons[] }` — a `hidden` PBF map-readiness maps to a
  failed gate so reviewers see *why* something was filtered.
- 15 curated spot categories + a 14-rule quality catalog mirroring the PBF filter keys.

## Endpoints

Base: `/admin/undiscovered/api/dashboard-v1`

- `GET /health`
- `GET /categories` — category list + quality-rule catalog
- `GET /candidates?region=&status=&channel=&category=` — items + counts
- `POST /candidates/:id/status` — apply a review transition (409 on invalid)
- `POST /seed-sample` — load the Vermont sample (local/dev)
- `POST /seed-from-pbf` — map OSM PBF v2 preview docs into the queue

Page: `GET /admin/undiscovered/dashboard-v1`

## Scope notes

- The v1 store is **in-memory** so the dashboard is usable without Firebase creds;
  the interface is the seam a Firestore-backed store implements next. Production
  writes to `unexploredSpots` / `unexploredRoutes` stay behind the existing PBF
  write guards — this feature only manages the review queue.
- Next: per-channel adapters (Reddit / trail / blog) that emit the same
  `DiscoveryCandidate` — additive, no dashboard changes required.

## Multi-channel discovery (June 26–27)

Non-OSM sources implement one interface (`DiscoveryChannelAdapter`) and emit the
same `DiscoveryCandidate`, so they flow into the same queue / dashboard / quality
gate with no per-channel dashboard changes.

- Shared core — `src/lib/undiscovered/channels/placeCandidateExtractor.ts`: extracts
  named spots from free text (trailing feature-type decides category/route-vs-spot)
  and **region-gates** to Vermont (in-bbox coords, or a VT keyword) so out-of-state
  mentions are dropped — the guard against irrelevant locations.
- Adapters — `reddit` (app-only OAuth search), `web_blog` (live fetch + HTML→text),
  `trail_db` (structured name+coords), `instagram` (started: caption/geotag
  extraction, live fetch pending Graph API/provider).

### Reddit setup (app-only OAuth)
Reddit blocks anonymous datacenter requests (HTTP 403), so the live path needs a
registered app. Register a **script** app at <https://www.reddit.com/prefs/apps>,
then set in `.env`:
`REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT`. The adapter does
the `client_credentials` token exchange (no user account) and queries the OAuth
search endpoint. Without creds it falls back to public JSON / pasted `rawItems`.
`GET /channels` reports `needsCredentials: true` for Reddit until they're set.
- Registry + endpoints: `GET /channels`, `POST /seed-from-channel` (accepts a live
  query or pasted `rawItems`). Injectable fetchers keep adapters unit-testable.
- Dashboard: channel selector + "Seed from channel", a channel column, and a
  channel filter.

## Verification

- Unit tests: 25/25 pass (review store, OSM adapter, place extractor, channel adapters).
- Manual: seed Vermont → run a candidate through to `written` → invalid
  `candidate → written` returns HTTP 409; seed `web_blog` from pasted text →
  extracts Bristol/Bingham Falls (spots) + Huntington Gorge Trail (route).
