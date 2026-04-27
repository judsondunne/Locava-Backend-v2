## Native search mix cache report (MMKV)

### What was added
- A **Search v2 mixes shelf cache** stored in MMKV, keyed by:
  - `viewerId`
  - `locationBucket` (0.1° lat/lng bucket)
  - `schemaVersion`
- Cache metadata includes:
  - `cachedAtMs`, `expiresAtMs`
  - `backendMixVersion`

### Behavior
- On committed search:
  - cached mixes are applied immediately (instant rails)
  - network fetch still runs; cache updates only if response is valid (non-empty mixes)
- The cache avoids bringing React Native dependencies into node tests by lazily requiring MMKV.

### System mixes bootstrap
- `systemMixBootstrap.cache.ts` TTL upgraded from ~14 minutes to **24 hours**.
- `viewerCollections.store.ts` now skips repeated network bootstraps when the cache is fresh (prevents remount storms).

