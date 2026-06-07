# Locava Photo Search QA Summary

- Run ID: `local-batch1-20260606T133514`
- Target: `local` (`http://127.0.0.1:8080`)
- Vision: `on` (gemini-2.5-flash)
- Places completed: 2
- Estimated provider calls: 2
- Estimated credits: 2 (exact cost unknown)

## Hit rates
- Places with ≥4 valid images: **100%**
- Places with all images loading: **100%**
- High-confidence place match: **0%**

## Verdict: **NOT PRODUCTION READY**

### Bingham Falls (Stowe, VT) — fail
- Results: 4, valid: 4, broken: 0
- Avg place match: 0.00
- Failures: low_place_match:0.00, low_visual_quality:0.00, low_coolness:0.00, wrong_place_high_risk:4

### Moss Glen Falls (Granville, VT) — fail
- Results: 4, valid: 4, broken: 0
- Avg place match: 0.00
- Failures: low_place_match:0.00, low_visual_quality:0.00, low_coolness:0.00, wrong_place_high_risk:4
