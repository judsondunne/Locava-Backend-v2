# Full post surface inventory (machine-generated)

Date: 2026-05-04

## Backend

- Total line hits: **2392**
- Unique files: **165**

### Classification counts

- needs_manual_review: 1063
- test_fixture: 620
- app_post_projection_correct: 382
- app_post_projection_partial: 99
- legacy_source_of_truth_risk: 85
- detail_hydration_required: 72
- legacy_compat_alias_only: 37
- cache_risk: 25
- cover_only_intentional: 8
- proxy_not_transformable: 1

### Pattern line counts

- `posterUrl`: 361
- `mediaType`: 278
- `thumbUrl`: 250
- `appPost`: 191
- `displayPhotoLink`: 170
- `assetCount`: 122
- `photoLink`: 115
- `assets[0]`: 103
- `media.assets`: 98
- `fallbackVideoUrl`: 80
- `notification`: 70
- `AppPostV2`: 51
- `hasMultipleAssets`: 45
- `photoLinks2`: 43
- `postContractVersion`: 42
- `normalizeMasterPostV2`: 42
- `photoLinks3`: 38
- `post.assets`: 37
- `buildPostEnvelope`: 34
- `mediaCompleteness`: 29
- `toAppPostV2FromAny`: 26
- `media.cover`: 26
- `media.assetCount`: 23
- `toFeedCardDTO`: 17
- `batchHydrateAppPostsOnRecords`: 16
- `sourceRawPost`: 16
- `details:batch`: 16
- `rawFirestore`: 15
- `toAppPostV2`: 13
- `post_card_cache`: 13
- `attachAppPostV2ToRecord`: 6
- `isCoverOnlyCard`: 2
- `postPreview`: 2
- `sharedPost`: 2

## Native

- Total line hits: **4240**
- Unique files: **683**

### Classification counts

- needs_manual_review: 2899
- legacy_source_of_truth_risk: 666
- test_fixture: 396
- app_post_consumer_correct: 140
- optimistic_cache_risk: 56
- carousel_asset_risk: 51
- dot_count_risk: 18
- legacy_fallback_helper_only: 14

### Pattern line counts (noisy broad terms at bottom)

- `thumbUrl`: 461
- `Map`: 395
- `share`: 284
- `comments`: 208
- `mediaType`: 203
- `displayPhotoLink`: 177
- `posterUrl`: 163
- `Profile`: 139
- `Search`: 132
- `appPostV2`: 131
- `carousel`: 131
- `FlatList`: 131
- `hls`: 128
- `photoLink`: 127
- `imageUrl`: 116
- `main720`: 107
- `assetCount`: 105
- `Home`: 102
- `appPost`: 91
- `report`: 78
- `post.assets`: 73
- `Notifications`: 69
- `main1080`: 64
- `Collection`: 60
- `assets[0]`: 51
- `preview360`: 51
- `fallbackVideoUrl`: 48
- `getHeroUri`: 41
- `PostTile`: 39
- `pagination`: 38
- `normalizeAppPostV2`: 37
- `getPostMediaAssets`: 34
- `LiftableViewerHost`: 25
- `postContractVersion`: 24
- `AssetCarouselOnly`: 21
- `Reels`: 21
- `deep link`: 21
- `dots`: 15
- `hasMultipleAssets`: 14
- `Feed`: 14
- `photoLinks2`: 11
- `getPostCover`: 9
- `photoLinks3`: 9
- `getPostActivities`: 8
- `MessageBubble`: 8
- `getPostPlaybackUrls`: 6
- `Mixes`: 6
- `UserDisplay`: 4
- `post detail`: 4
- `videoUrl`: 3
- `mediaItems`: 2
- `Pager`: 1
- `EnhancedMediaContent`: 0

## Outputs

- `docs/audits/full-post-surface-backend-inventory-2026-05-04.json`
- `docs/audits/full-post-surface-native-inventory-2026-05-04.json`
