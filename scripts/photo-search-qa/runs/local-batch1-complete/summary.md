# Locava Photo Search QA Summary

- Run ID: `local-batch1-complete`
- Target: `local` (`http://127.0.0.1:8080`)
- Vision: `off`
- Places completed: 5
- Estimated provider calls: 1
- Estimated credits: 1 (exact cost unknown)

## Hit rates
- Places with ≥4 valid images: **20%**
- Places with all images loading: **20%**
- High-confidence place match: **0%**

## Verdict: **NOT PRODUCTION READY**

## Batch 1
- Passed: 0
- Manual review: 1
- Failed: 4
- Valid images: 4/4
- Broken images: 0
- Missing metadata: 0
- Duplicate rate: 0.0%
- Avg response: 294ms | p95: 1469ms
- Top failures: api_error (4); no_results (4); insufficient_valid_images (4); vision_unavailable_manual_review (1)
- Worst: Moss Glen Falls (Granville), Moss Glen Falls (Stowe), Texas Falls (Hancock)
- Best: Bingham Falls (Stowe), Moss Glen Falls (Granville), Moss Glen Falls (Stowe)

### Bingham Falls (Stowe, VT) — manual_review
- Results: 4, valid: 4, broken: 0
- Avg place match: n/a
- Failures: vision_unavailable_manual_review

### Moss Glen Falls (Granville, VT) — fail
- Results: 0, valid: 0, broken: 0
- Avg place match: n/a
- Failures: api_error:fetch failed, no_results, insufficient_valid_images:0<4

### Moss Glen Falls (Stowe, VT) — fail
- Results: 0, valid: 0, broken: 0
- Avg place match: n/a
- Failures: api_error:fetch failed, no_results, insufficient_valid_images:0<4

### Texas Falls (Hancock, VT) — fail
- Results: 0, valid: 0, broken: 0
- Avg place match: n/a
- Failures: api_error:fetch failed, no_results, insufficient_valid_images:0<4

### Warren Falls (Warren, VT) — fail
- Results: 0, valid: 0, broken: 0
- Avg place match: n/a
- Failures: api_error:fetch failed, no_results, insufficient_valid_images:0<4
