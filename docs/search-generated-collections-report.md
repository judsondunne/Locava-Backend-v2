## Search generated collections report

### Goal

Provide lightweight “generated collection” suggestions in autofill without slowing typing, and ensure the tap path can materialize posts via the mix system.

### Implementation

- Backend autofill (`SearchAutofillService.suggest`) now prepends a **generated mix suggestion** when intent contains an activity (and optionally a location).
- The suggestion includes a `mixSpecV1` payload suitable for native’s existing “Mix collections” UI.
  - Also includes `v2MixId` as an additional field for forward compatibility with the v2 mix system.

### Test coverage

- `src/services/search-autofill/search-autofill.generated-mixes.test.ts` validates that a query like “best hiking in vermont” yields a mix suggestion.