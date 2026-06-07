# Locava Photo Search QA Summary

- Run ID: `2026-06-06T17-35-04-286Z`
- Target: `production` (`https://locava-backend-v2-nboawyiasq-uc.a.run.app`)
- Vision: `on` (gemini-2.5-flash)
- Places completed: 5
- Estimated provider calls: 0
- Estimated credits: 0 (exact cost unknown)

## Hit rates
- Places with ≥4 valid images: **0%**
- Places with all images loading: **0%**
- High-confidence place match: **0%**

## Verdict: **NOT PRODUCTION READY**

## Batch 1
- Passed: 0
- Manual review: 0
- Failed: 5
- Valid images: 0/0
- Broken images: 0
- Missing metadata: 0
- Duplicate rate: 0.0%
- Avg response: 154ms | p95: 304ms
- Top failures: api_error (5); no_results (5); insufficient_valid_images (5)
- Worst: Bingham Falls (Stowe), Moss Glen Falls (Granville), Moss Glen Falls (Stowe)
- Best: Bingham Falls (Stowe), Moss Glen Falls (Granville), Moss Glen Falls (Stowe)

### Bingham Falls (Stowe, VT) — fail
- Results: 0, valid: 0, broken: 0
- Avg place match: n/a
- Failures: api_error:HTTP 404, no_results, insufficient_valid_images:0<4

### Moss Glen Falls (Granville, VT) — fail
- Results: 0, valid: 0, broken: 0
- Avg place match: n/a
- Failures: api_error:HTTP 404, no_results, insufficient_valid_images:0<4

### Moss Glen Falls (Stowe, VT) — fail
- Results: 0, valid: 0, broken: 0
- Avg place match: n/a
- Failures: api_error:HTTP 404, no_results, insufficient_valid_images:0<4

### Texas Falls (Hancock, VT) — fail
- Results: 0, valid: 0, broken: 0
- Avg place match: n/a
- Failures: api_error:HTTP 404, no_results, insufficient_valid_images:0<4

### Warren Falls (Warren, VT) — fail
- Results: 0, valid: 0, broken: 0
- Avg place match: n/a
- Failures: api_error:HTTP 404, no_results, insufficient_valid_images:0<4
