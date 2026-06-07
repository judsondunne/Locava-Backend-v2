# Photo Search QA Harness

Read-only production QA for Locava's external image search pipeline (`POST /api/places/search-images`).

## What it tests

1. Images returned by the existing backend route
2. Thumbnail URL load success (HTTP 200, `image/*`, non-trivial bytes)
3. Place relevance (Gemini vision when configured, otherwise manual HTML review)
4. Source/backlink/copyright metadata on every result
5. Visual quality + Locava-style appeal scoring
6. Duplicate / near-duplicate detection
7. Latency (response ms, p50/p95 per batch)
8. Estimated provider call / credit usage (exact Serper/Bing credits usually unknown)
9. Hit rates (% places with ≥4 valid images, all-load rate, high-confidence match)
10. Failure reason taxonomy

## Commands

From `Locava Backendv2/`:

```bash
# One batch (5 Vermont places) against production
npm run photoqa -- --target=production --batchSize=5 --maxBatches=1 --maxCredits=50 --minImages=4

# Full seed set with resume + budget guard
npm run photoqa -- --target=production --batchSize=5 --runAll --maxCredits=250 --resume

# Local backend (must be running on :8080 with SERPER_API_KEY)
npm run photoqa -- --target=local --batchSize=5 --maxBatches=1
```

## CLI options

| Flag | Default | Description |
|------|---------|-------------|
| `--target` | `local` | `local` \| `staging` \| `production` |
| `--batchSize` | `5` | Places per batch (spec default: 5) |
| `--maxBatches` | `1` | Batches when `--runAll` is false |
| `--runAll` | false | Run until seeds exhausted or budget hit |
| `--resume` | false | Resume from `outDir/state.json` |
| `--maxCredits` | `50` | Hard stop on estimated provider credits |
| `--minImages` | `4` | Minimum valid images required per place |
| `--concurrency` | `1` | Place concurrency (keep at 1 for production) |
| `--outDir` | `scripts/photo-search-qa/runs/<timestamp>` | Report output directory |
| `--vision` | `auto` | `true` \| `false` \| `auto` |

## Environment variables

| Variable | Purpose |
|----------|---------|
| `PHOTOQA_BASE_URL` | Override backend base URL for any target |
| `PHOTOQA_PRODUCTION_BASE_URL` | Production Cloud Run URL |
| `PHOTOQA_STAGING_BASE_URL` | Staging URL |
| `GEMINI_API_KEY` / `GOOGLE_GEMINI_API_KEY` / `PHOTOQA_GEMINI_API_KEY` | Vision judging |
| `PHOTOQA_GEMINI_MODEL` | Default `gemini-2.5-flash` |

Backend image search (not used directly by harness, but required on the server):

| Variable | Purpose |
|----------|---------|
| `SERPER_API_KEY` | Primary image search provider |
| `BING_SEARCH_API_KEY` | Fallback provider |

## Outputs

Each run writes to `scripts/photo-search-qa/runs/<timestamp>/`:

- `state.json` — resumable progress (updated after every place)
- `report.json` — full structured report
- `summary.md` — markdown summary
- `report.html` — visual review grid with manual verdict buttons

Symlinks/copies:

- `scripts/photo-search-qa/latest-report.html`
- `scripts/photo-search-qa/latest-summary.md`

## Safety

- Read-only HTTP POSTs to `/api/places/search-images` only
- No Firestore writes, no post mutations
- Budget guard on `--maxCredits`
- Stops on catastrophic batch failure (>3 zero-image places, >3 metadata failures, avg response >6s)

## Unit tests

```bash
npm run test -- scripts/photo-search-qa/photoSearchQa.test.ts
```
