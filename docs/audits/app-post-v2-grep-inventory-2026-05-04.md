# App Post V2 — grep inventory (machine-generated)

Generated: 2026-05-04T18:35:55.199Z

## Summary

| Classification | Count |
|---|---:|
| migrated_appPostV2 | 156 |
| compatibility_alias_only | 39 |
| legacy_fallback_inside_helper | 8 |
| proxy_not_transformable | 0 |
| test_fixture | 471 |
| needs_migration | 1122 |
| unknown | 956 |

**Total hits:** 2752

## needs_migration (1122)

- `Locava Backendv2/src/orchestration/mutations/notifications-mark-all-read.orchestrator.ts:16` **notification** — `mutationType: "notification.markallread",`
- `Locava Backendv2/src/orchestration/mutations/notifications-mark-read.orchestrator.ts:16` **notification** — `mutationType: "notification.markread" as const,`
- `Locava Backendv2/src/orchestration/mutations/notifications-mark-read.orchestrator.ts:21` **notification** — `mutationType: "notification.markread",`
- `Locava Backendv2/src/orchestration/mutations/post-delete.orchestrator.ts:18` **profile grid** — `// Post delete must be strongly coherent for the acting viewer; otherwise the profile grid`
- `Locava Backendv2/src/orchestration/mutations/posting-finalize.orchestrator.ts:18` **posterUrl** — `posterUrl?: string;`
- `Locava Backendv2/src/orchestration/mutations/posting-finalize.orchestrator.ts:76` **posterUrl** — `posterUrl: result.mediaReadiness.posterUrl,`
- `Locava Backendv2/src/orchestration/mutations/posting-finalize.orchestrator.ts:80` **fallbackVideoUrl** — `fallbackVideoUrl: result.mediaReadiness.fallbackVideoUrl,`
- `Locava Backendv2/src/orchestration/searchMixes.orchestrator.ts:26` **assets[0]** — `Array.isArray(row.assets) && row.assets[0] && typeof row.assets[0] === "object"`
- `Locava Backendv2/src/orchestration/searchMixes.orchestrator.ts:27` **assets[0]** — `? (row.assets[0] as Record<string, unknown>)`
- `Locava Backendv2/src/orchestration/searchMixes.orchestrator.ts:31` **posterUrl** — `const posterUrl =`
- `Locava Backendv2/src/orchestration/searchMixes.orchestrator.ts:32` **thumbUrl** — `cleanString(row.thumbUrl) ??`
- `Locava Backendv2/src/orchestration/searchMixes.orchestrator.ts:33` **displayPhotoLink** — `cleanString(row.displayPhotoLink) ??`
- `Locava Backendv2/src/orchestration/searchMixes.orchestrator.ts:34` **posterUrl** — `cleanString(firstAsset?.posterUrl) ??`
- `Locava Backendv2/src/orchestration/searchMixes.orchestrator.ts:41` **posterUrl** — `cleanString(firstAsset?.posterUrl) ??`
- `Locava Backendv2/src/orchestration/searchMixes.orchestrator.ts:43` **displayPhotoLink** — `cleanString(row.displayPhotoLink) ??`
- `Locava Backendv2/src/orchestration/searchMixes.orchestrator.ts:44` **thumbUrl** — `cleanString(row.thumbUrl);`
- `Locava Backendv2/src/orchestration/searchMixes.orchestrator.ts:48` **displayPhotoLink** — `cleanString(row.displayPhotoLink) ??`
- `Locava Backendv2/src/orchestration/searchMixes.orchestrator.ts:60` **posterUrl** — `posterUrl,`
- `Locava Backendv2/src/orchestration/searchMixes.orchestrator.ts:172` **posterUrl** — `const posterUrl = cleanString(primary?.posterUrl) ?? compactAsset.posterUrl ?? "";`
- `Locava Backendv2/src/orchestration/searchMixes.orchestrator.ts:189` **posterUrl** — `posterUrl,`
- `Locava Backendv2/src/orchestration/searchMixes.orchestrator.ts:209` **posterUrl** — `posterUrl: compactAsset.posterUrl || null,`
- `Locava Backendv2/src/orchestration/searchMixes.orchestrator.ts:232` **posterUrl** — `(compactAsset.originalUrl ?? compactAsset.previewUrl ?? compactAsset.posterUrl ?? null),`
- `Locava Backendv2/src/orchestration/surfaces/feed-item-detail.orchestrator.ts:134` **thumbUrl** — `thumbUrl: post.thumbUrl,`
- `Locava Backendv2/src/orchestration/surfaces/feed-item-detail.orchestrator.ts:135` **post.assets** — `assets: post.assets,`
- `Locava Backendv2/src/orchestration/surfaces/feed-item-detail.orchestrator.ts:151` **thumbUrl** — `posterUrl: post.thumbUrl,`
- `Locava Backendv2/src/orchestration/surfaces/feed-item-detail.orchestrator.ts:151` **posterUrl** — `posterUrl: post.thumbUrl,`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:44` **fallbackVideoUrl** — `fallbackVideoUrlPresent: Boolean(mediaReadiness.fallbackVideoUrl),`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:63` **thumbUrl** — `thumbUrl: detail.thumbUrl || base.thumbUrl,`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:85` **thumbUrl** — `thumbUrl: detail.thumbUrl || base.thumbUrl,`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:102` **fallbackVideoUrl** — `fallbackVideoUrl?: string | null;`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:103` **posterUrl** — `posterUrl?: string | null;`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:140` **fallbackVideoUrl** — `...(typeof sx.fallbackVideoUrl === "string" ? { fallbackVideoUrl: sx.fallbackVideoUrl } : {}),`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:141` **posterUrl** — `...(typeof sx.posterUrl === "string" ? { posterUrl: sx.posterUrl } : {}),`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:149` **photoLink** — `...(typeof (summary as Record<string, unknown>).photoLink === "string"`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:150` **photoLink** — `? { photoLink: (summary as Record<string, unknown>).photoLink as string }`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:152` **displayPhotoLink** — `...(typeof (summary as Record<string, unknown>).displayPhotoLink === "string"`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:153` **displayPhotoLink** — `? { displayPhotoLink: (summary as Record<string, unknown>).displayPhotoLink as string }`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:171` **photoLink** — `"photoLink",`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:172` **displayPhotoLink** — `"displayPhotoLink",`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:241` **posterUrl** — `posterUrl: mediaReadiness.posterUrl,`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:245` **fallbackVideoUrl** — `fallbackVideoUrl: mediaReadiness.fallbackVideoUrl,`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:369` **fallbackVideoUrl** — `fallbackVideoUrlPresent: Boolean(mediaReadiness.fallbackVideoUrl),`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:409` **thumbUrl** — `thumbUrl: post.thumbUrl,`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:416` **posterUrl** — `posterUrl: mediaReadiness.posterUrl,`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:420` **fallbackVideoUrl** — `fallbackVideoUrl: mediaReadiness.fallbackVideoUrl,`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:429` **post.assets** — `assets: post.assets,`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:443` **thumbUrl** — `posterUrl: post.thumbUrl,`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:443` **posterUrl** — `posterUrl: post.thumbUrl,`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:555` **posterUrl** — `posterUrl: mediaReadiness.posterUrl,`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:559` **fallbackVideoUrl** — `fallbackVideoUrl: mediaReadiness.fallbackVideoUrl,`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:940` **posterUrl** — `posterUrl: mediaReadiness.posterUrl,`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:944` **fallbackVideoUrl** — `fallbackVideoUrl: mediaReadiness.fallbackVideoUrl,`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:1071` **thumbUrl** — `thumbUrl: cardSummary.media.posterUrl,`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:1071` **posterUrl** — `thumbUrl: cardSummary.media.posterUrl,`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:1099` **thumbUrl** — `thumbUrl: detail.thumbUrl ?? cardSummary.media.posterUrl,`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:1099` **posterUrl** — `thumbUrl: detail.thumbUrl ?? cardSummary.media.posterUrl,`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:1147` **post.assets** — `const hasAssets = detail.firstRender.post.assets.length > 0;`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:1160` **thumbUrl** — `const fallbackPoster = String(detail?.thumbUrl ?? summary?.media?.posterUrl ?? "");`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:1160` **posterUrl** — `const fallbackPoster = String(detail?.thumbUrl ?? summary?.media?.posterUrl ?? "");`
- `Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts:1172` **posterUrl** — `posterUrl: fallbackPoster,`
- `Locava Backendv2/src/orchestration/surfaces/profile-post-detail.orchestrator.ts:84` **thumbUrl** — `thumbUrl: detail.thumbUrl,`
- `Locava Backendv2/src/orchestration/surfaces/profile-post-detail.orchestrator.ts:91` **posterUrl** — `posterUrl: mediaReadiness.posterUrl,`
- `Locava Backendv2/src/orchestration/surfaces/profile-post-detail.orchestrator.ts:95` **fallbackVideoUrl** — `fallbackVideoUrl: mediaReadiness.fallbackVideoUrl,`
- `Locava Backendv2/src/orchestration/surfaces/profile-post-detail.orchestrator.ts:138` **thumbUrl** — `thumbUrl: detail.thumbUrl,`
- `Locava Backendv2/src/repositories/compat/posts-batch.repository.ts:44` **thumbUrl** — `"thumbUrl",`
- `Locava Backendv2/src/repositories/compat/posts-batch.repository.ts:45` **displayPhotoLink** — `"displayPhotoLink",`
- `Locava Backendv2/src/repositories/compat/posts-batch.repository.ts:46` **photoLink** — `"photoLink",`
- `Locava Backendv2/src/repositories/mixes.repository.ts:70` **thumbUrl** — `"thumbUrl",`
- `Locava Backendv2/src/repositories/mixes.repository.ts:71` **displayPhotoLink** — `"displayPhotoLink",`
- `Locava Backendv2/src/repositories/mixes.repository.ts:72` **photoLink** — `"photoLink",`
- `Locava Backendv2/src/repositories/mixPosts.repository.ts:17` **thumbUrl** — `thumbUrl?: string;`
- `Locava Backendv2/src/repositories/mixPosts.repository.ts:18` **displayPhotoLink** — `displayPhotoLink?: string;`
- `Locava Backendv2/src/repositories/mixPosts.repository.ts:33` **thumbUrl** — `"thumbUrl",`
- `Locava Backendv2/src/repositories/mixPosts.repository.ts:34` **displayPhotoLink** — `"displayPhotoLink",`
- `Locava Backendv2/src/repositories/mixPosts.repository.ts:35` **photoLink** — `"photoLink",`
- `Locava Backendv2/src/repositories/source-of-truth/feed-detail-firestore.adapter.ts:36` **thumbUrl** — `thumbUrl: string;`
- `Locava Backendv2/src/repositories/source-of-truth/feed-detail-firestore.adapter.ts:146` **thumbUrl** — `"thumbUrl",`
- `Locava Backendv2/src/repositories/source-of-truth/feed-detail-firestore.adapter.ts:147` **displayPhotoLink** — `"displayPhotoLink",`
- `Locava Backendv2/src/repositories/source-of-truth/feed-detail-firestore.adapter.ts:148` **photoLink** — `"photoLink",`
- `Locava Backendv2/src/repositories/source-of-truth/feed-detail-firestore.adapter.ts:286` **thumbUrl** — `thumbUrl?: string;`
- `Locava Backendv2/src/repositories/source-of-truth/feed-detail-firestore.adapter.ts:287` **displayPhotoLink** — `displayPhotoLink?: string;`
- `Locava Backendv2/src/repositories/source-of-truth/feed-detail-firestore.adapter.ts:288` **photoLink** — `photoLink?: string;`
- `Locava Backendv2/src/repositories/source-of-truth/feed-detail-firestore.adapter.ts:349` **thumbUrl** — `const thumbUrl = resolveThumbCandidate(input.postData);`
- `Locava Backendv2/src/repositories/source-of-truth/feed-detail-firestore.adapter.ts:350` **thumbUrl** — `if (!thumbUrl) {`
- `Locava Backendv2/src/repositories/source-of-truth/feed-detail-firestore.adapter.ts:400` **thumbUrl** — `thumbUrl: normalizeThumbUrl(input.postData, thumbUrl),`
- `Locava Backendv2/src/repositories/source-of-truth/feed-detail-firestore.adapter.ts:404` **thumbUrl** — `assets: normalizeAssets(input.responsePostId, mediaType, thumbUrl, input.postData),`
- `Locava Backendv2/src/repositories/source-of-truth/feed-detail-firestore.adapter.ts:502` **thumbUrl** — `const direct = normalizeNullable(data.thumbUrl);`
- `Locava Backendv2/src/repositories/source-of-truth/feed-detail-firestore.adapter.ts:504` **displayPhotoLink** — `const display = normalizeNullable(data.displayPhotoLink);`
- `Locava Backendv2/src/repositories/source-of-truth/feed-detail-firestore.adapter.ts:506` **photoLink** — `if (typeof data.photoLink === "string" && data.photoLink.includes(",")) {`
- `Locava Backendv2/src/repositories/source-of-truth/feed-detail-firestore.adapter.ts:507` **photoLink** — `const first = data.photoLink`
- `Locava Backendv2/src/repositories/source-of-truth/feed-detail-firestore.adapter.ts:513` **photoLink** — `if (typeof data.photoLink === "string" && data.photoLink.trim()) {`
- `Locava Backendv2/src/repositories/source-of-truth/feed-detail-firestore.adapter.ts:514` **photoLink** — `return data.photoLink.trim();`
- `Locava Backendv2/src/repositories/source-of-truth/feed-detail-firestore.adapter.ts:733` **displayPhotoLink** — `const candidate = normalizeNullable(data.thumbUrl) ?? normalizeNullable(data.displayPhotoLink);`
- `Locava Backendv2/src/repositories/source-of-truth/feed-detail-firestore.adapter.ts:733` **thumbUrl** — `const candidate = normalizeNullable(data.thumbUrl) ?? normalizeNullable(data.displayPhotoLink);`
- `Locava Backendv2/src/repositories/source-of-truth/feed-detail-firestore.adapter.ts:735` **photoLink** — `if (typeof data.photoLink === "string" && data.photoLink.includes(",")) {`
- `Locava Backendv2/src/repositories/source-of-truth/feed-detail-firestore.adapter.ts:736` **photoLink** — `const first = data.photoLink.split(",").map((v) => v.trim()).find(Boolean);`
- `Locava Backendv2/src/repositories/source-of-truth/feed-detail-firestore.adapter.ts:750` **thumbUrl** — `thumbUrl: string,`
- `Locava Backendv2/src/repositories/source-of-truth/feed-detail-firestore.adapter.ts:771` **thumbUrl** — `thumbUrl,`
- `Locava Backendv2/src/repositories/source-of-truth/feed-detail-firestore.adapter.ts:776` **thumbUrl** — `thumbUrl,`
- `Locava Backendv2/src/repositories/source-of-truth/feed-detail-firestore.adapter.ts:806` **thumbUrl** — `poster: thumbUrl,`
- `Locava Backendv2/src/repositories/source-of-truth/feed-detail-firestore.adapter.ts:807` **thumbUrl** — `thumbnail: thumbUrl`
- `Locava Backendv2/src/repositories/source-of-truth/feed-detail-firestore.adapter.ts:815` **thumbUrl** — `poster: thumbUrl,`
- `Locava Backendv2/src/repositories/source-of-truth/feed-detail-firestore.adapter.ts:816` **thumbUrl** — `thumbnail: thumbUrl`
- `Locava Backendv2/src/repositories/source-of-truth/feed-firestore.adapter.ts:16` **posterUrl** — `posterUrl: string;`
- `Locava Backendv2/src/repositories/source-of-truth/feed-firestore.adapter.ts:39` **posterUrl** — `posterUrl: string | null;`
- `Locava Backendv2/src/repositories/source-of-truth/feed-firestore.adapter.ts:89` **thumbUrl** — `"thumbUrl",`
- `Locava Backendv2/src/repositories/source-of-truth/feed-firestore.adapter.ts:90` **displayPhotoLink** — `"displayPhotoLink",`
- `Locava Backendv2/src/repositories/source-of-truth/feed-firestore.adapter.ts:91` **photoLink** — `"photoLink",`
- `Locava Backendv2/src/repositories/source-of-truth/feed-firestore.adapter.ts:92` **photoLinks2** — `"photoLinks2",`
- `Locava Backendv2/src/repositories/source-of-truth/feed-firestore.adapter.ts:93` **photoLinks3** — `"photoLinks3",`
- `Locava Backendv2/src/repositories/source-of-truth/feed-firestore.adapter.ts:254` **displayPhotoLink** — `typeof data.displayPhotoLink === "string" && data.displayPhotoLink.trim()`
- `Locava Backendv2/src/repositories/source-of-truth/feed-firestore.adapter.ts:255` **displayPhotoLink** — `? data.displayPhotoLink`
- `Locava Backendv2/src/repositories/source-of-truth/feed-firestore.adapter.ts:256` **thumbUrl** — `: typeof data.thumbUrl === "string" && data.thumbUrl.trim()`
- `Locava Backendv2/src/repositories/source-of-truth/feed-firestore.adapter.ts:257` **thumbUrl** — `? data.thumbUrl`
- `Locava Backendv2/src/repositories/source-of-truth/feed-firestore.adapter.ts:458` **displayPhotoLink** — `typeof data.displayPhotoLink === "string" && data.displayPhotoLink.trim()`
- `Locava Backendv2/src/repositories/source-of-truth/feed-firestore.adapter.ts:459` **displayPhotoLink** — `? data.displayPhotoLink`
- `Locava Backendv2/src/repositories/source-of-truth/feed-firestore.adapter.ts:460` **thumbUrl** — `: typeof data.thumbUrl === "string" && data.thumbUrl.trim()`
- `Locava Backendv2/src/repositories/source-of-truth/feed-firestore.adapter.ts:461` **thumbUrl** — `? data.thumbUrl`
- `Locava Backendv2/src/repositories/source-of-truth/feed-firestore.adapter.ts:498` **posterUrl** — `const posterUrl = readPosterUrl(data);`
- `Locava Backendv2/src/repositories/source-of-truth/feed-firestore.adapter.ts:533` **posterUrl** — `posterUrl,`
- `Locava Backendv2/src/repositories/source-of-truth/feed-firestore.adapter.ts:650` **assets[0]** — `const first = data.assets[0] as Record<string, unknown>;`
- `Locava Backendv2/src/repositories/source-of-truth/feed-firestore.adapter.ts:657` **displayPhotoLink** — `const direct = [data.displayPhotoLink, data.thumbUrl];`
- `Locava Backendv2/src/repositories/source-of-truth/feed-firestore.adapter.ts:657` **thumbUrl** — `const direct = [data.displayPhotoLink, data.thumbUrl];`
- `Locava Backendv2/src/repositories/source-of-truth/feed-firestore.adapter.ts:661` **assets[0]** — `if (Array.isArray(data.assets) && data.assets.length > 0 && typeof data.assets[0] === "object") {`
- `Locava Backendv2/src/repositories/source-of-truth/feed-firestore.adapter.ts:662` **assets[0]** — `const first = data.assets[0] as Record<string, unknown>;`
- `Locava Backendv2/src/repositories/source-of-truth/feed-firestore.adapter.ts:672` **assets[0]** — `if (!Array.isArray(data.assets) || data.assets.length === 0 || typeof data.assets[0] !== "object") {`
- `Locava Backendv2/src/repositories/source-of-truth/feed-firestore.adapter.ts:675` **assets[0]** — `const first = data.assets[0] as Record<string, unknown>;`
- `Locava Backendv2/src/repositories/source-of-truth/feed-firestore.adapter.ts:743` **posterUrl** — `posterUrl: normalizeText(thumb.webp) ?? normalizeText(sm.webp),`
- `Locava Backendv2/src/repositories/source-of-truth/firestore-client.ts:435` **notification** — `title: "Warmup notification",`
- `Locava Backendv2/src/repositories/source-of-truth/firestore-client.ts:436` **notification** — `body: "Warmup notification",`
- `Locava Backendv2/src/repositories/source-of-truth/map-markers-firestore.adapter.ts:194` **thumbUrl** — `"thumbUrl",`
- `Locava Backendv2/src/repositories/source-of-truth/map-markers-firestore.adapter.ts:195` **displayPhotoLink** — `"displayPhotoLink",`
- `Locava Backendv2/src/repositories/source-of-truth/map-markers-firestore.adapter.ts:196` **photoLink** — `"photoLink",`
- `Locava Backendv2/src/repositories/source-of-truth/map-markers-firestore.adapter.ts:197` **photoLinks2** — `"photoLinks2",`
- `Locava Backendv2/src/repositories/source-of-truth/map-markers-firestore.adapter.ts:198` **photoLinks3** — `"photoLinks3",`
- `Locava Backendv2/src/repositories/source-of-truth/map-markers-firestore.adapter.ts:253` **thumbUrl** — `"thumbUrl",`
- `Locava Backendv2/src/repositories/source-of-truth/map-markers-firestore.adapter.ts:254` **displayPhotoLink** — `"displayPhotoLink",`
- `Locava Backendv2/src/repositories/source-of-truth/map-markers-firestore.adapter.ts:255` **photoLink** — `"photoLink",`
- `Locava Backendv2/src/repositories/source-of-truth/map-markers-firestore.adapter.ts:256` **photoLinks2** — `"photoLinks2",`
- `Locava Backendv2/src/repositories/source-of-truth/map-markers-firestore.adapter.ts:257` **photoLinks3** — `"photoLinks3",`
- `Locava Backendv2/src/repositories/source-of-truth/map-markers-firestore.adapter.ts:350` **photoLink** — `const thumbnailUrl = normalizeText(data.displayPhotoLink) ?? normalizeText(data.photoLink) ?? normalizeText(data.thumbUrl);`
- `Locava Backendv2/src/repositories/source-of-truth/map-markers-firestore.adapter.ts:350` **displayPhotoLink** — `const thumbnailUrl = normalizeText(data.displayPhotoLink) ?? normalizeText(data.photoLink) ?? normalizeText(data.thumbUrl);`
- `Locava Backendv2/src/repositories/source-of-truth/map-markers-firestore.adapter.ts:350` **thumbUrl** — `const thumbnailUrl = normalizeText(data.displayPhotoLink) ?? normalizeText(data.photoLink) ?? normalizeText(data.thumbUrl);`
- `Locava Backendv2/src/repositories/source-of-truth/map-markers-firestore.adapter.ts:375` **thumbUrl** — `thumbUrl: thumbnailUrl,`
- `Locava Backendv2/src/repositories/source-of-truth/map-markers-firestore.adapter.ts:376` **displayPhotoLink** — `displayPhotoLink: thumbnailUrl,`
- `Locava Backendv2/src/repositories/source-of-truth/map-markers-firestore.adapter.ts:473` **photoLink** — `const hasPhoto = Boolean(normalizeText(data.displayPhotoLink) ?? normalizeText(data.photoLink) ?? normalizeText(data.thumbUrl));`
- `Locava Backendv2/src/repositories/source-of-truth/map-markers-firestore.adapter.ts:473` **displayPhotoLink** — `const hasPhoto = Boolean(normalizeText(data.displayPhotoLink) ?? normalizeText(data.photoLink) ?? normalizeText(data.thumbUrl));`
- `Locava Backendv2/src/repositories/source-of-truth/map-markers-firestore.adapter.ts:473` **thumbUrl** — `const hasPhoto = Boolean(normalizeText(data.displayPhotoLink) ?? normalizeText(data.photoLink) ?? normalizeText(data.thumbUrl));`
- `Locava Backendv2/src/repositories/source-of-truth/post-firestore-projection.ts:6` **displayPhotoLink** — `* (see sampled production: 'time', 'displayPhotoLink', 'likesCount', etc.).`
- `Locava Backendv2/src/repositories/source-of-truth/post-firestore-projection.ts:46` **photoLink** — `const direct = data.displayPhotoLink ?? data.photoLink ?? data.thumbUrl;`
- `Locava Backendv2/src/repositories/source-of-truth/post-firestore-projection.ts:46` **displayPhotoLink** — `const direct = data.displayPhotoLink ?? data.photoLink ?? data.thumbUrl;`
- `Locava Backendv2/src/repositories/source-of-truth/post-firestore-projection.ts:46` **thumbUrl** — `const direct = data.displayPhotoLink ?? data.photoLink ?? data.thumbUrl;`
- `Locava Backendv2/src/repositories/source-of-truth/post-firestore-projection.ts:49` **assets[0]** — `if (Array.isArray(assets) && assets[0] && typeof assets[0] === "object") {`
- `Locava Backendv2/src/repositories/source-of-truth/post-firestore-projection.ts:50` **assets[0]** — `const a0 = assets[0] as { downloadURL?: string; url?: string; poster?: string };`
- `Locava Backendv2/src/repositories/source-of-truth/post-firestore-projection.ts:62` **assets[0]** — `if (Array.isArray(assets) && assets[0] && typeof assets[0] === "object") {`
- `Locava Backendv2/src/repositories/source-of-truth/post-firestore-projection.ts:63` **assets[0]** — `const t = (assets[0] as { type?: string }).type;`
- `Locava Backendv2/src/repositories/source-of-truth/post-firestore-projection.ts:103` **thumbUrl** — `thumbUrl: string;`
- `Locava Backendv2/src/repositories/source-of-truth/post-firestore-projection.ts:134` **thumbUrl** — `thumbUrl: readPostThumbUrl(data, doc.id),`
- `Locava Backendv2/src/repositories/source-of-truth/profile-firestore.adapter.ts:40` **thumbUrl** — `thumbUrl: string;`
- `Locava Backendv2/src/repositories/source-of-truth/profile-firestore.adapter.ts:87` **profile grid** — `/** Cursor modes for profile grid: stable paging avoids offset scans on deep pages. */`
- `Locava Backendv2/src/repositories/source-of-truth/profile-firestore.adapter.ts:704` **displayPhotoLink** — `"displayPhotoLink",`
- `Locava Backendv2/src/repositories/source-of-truth/profile-firestore.adapter.ts:705` **photoLink** — `"photoLink",`
- `Locava Backendv2/src/repositories/source-of-truth/profile-firestore.adapter.ts:706` **thumbUrl** — `"thumbUrl",`
- `Locava Backendv2/src/repositories/source-of-truth/profile-firestore.adapter.ts:766` **displayPhotoLink** — `"displayPhotoLink",`
- `Locava Backendv2/src/repositories/source-of-truth/profile-firestore.adapter.ts:767` **photoLink** — `"photoLink",`
- `Locava Backendv2/src/repositories/source-of-truth/profile-firestore.adapter.ts:768` **thumbUrl** — `"thumbUrl",`
- `Locava Backendv2/src/repositories/source-of-truth/profile-post-detail-firestore.adapter.ts:38` **thumbUrl** — `thumbUrl: string;`
- `Locava Backendv2/src/repositories/source-of-truth/profile-post-detail-firestore.adapter.ts:170` **thumbUrl** — `thumbUrl?: string;`
- `Locava Backendv2/src/repositories/source-of-truth/profile-post-detail-firestore.adapter.ts:240` **thumbUrl** — `thumbUrl: readPostThumbUrl(raw, input.postDoc.id),`
- `Locava Backendv2/src/repositories/source-of-truth/profile-post-detail-firestore.adapter.ts:496` **thumbUrl** — `const thumbUrl = readPostThumbUrl(raw, postId);`
- `Locava Backendv2/src/repositories/source-of-truth/profile-post-detail-firestore.adapter.ts:516` **thumbUrl** — `thumbUrl,`
- `Locava Backendv2/src/repositories/source-of-truth/profile-post-detail-firestore.adapter.ts:521` **thumbUrl** — `thumbUrl,`
- `Locava Backendv2/src/repositories/source-of-truth/search-results-firestore.adapter.ts:21` **thumbUrl** — `thumbUrl: string;`
- `Locava Backendv2/src/repositories/source-of-truth/search-results-firestore.adapter.ts:22` **displayPhotoLink** — `displayPhotoLink: string;`
- `Locava Backendv2/src/repositories/source-of-truth/search-results-firestore.adapter.ts:57` **thumbUrl** — `thumbUrl: string;`
- `Locava Backendv2/src/repositories/source-of-truth/search-results-firestore.adapter.ts:58` **displayPhotoLink** — `displayPhotoLink: string;`
- `Locava Backendv2/src/repositories/source-of-truth/search-results-firestore.adapter.ts:93` **thumbUrl** — `"thumbUrl",`
- `Locava Backendv2/src/repositories/source-of-truth/search-results-firestore.adapter.ts:94` **displayPhotoLink** — `"displayPhotoLink",`
- `Locava Backendv2/src/repositories/source-of-truth/search-results-firestore.adapter.ts:95` **photoLink** — `"photoLink",`
- `Locava Backendv2/src/repositories/source-of-truth/search-results-firestore.adapter.ts:436` **thumbUrl** — `thumbUrl: resolveBestCoverUrl(post),`
- `Locava Backendv2/src/repositories/source-of-truth/search-results-firestore.adapter.ts:437` **displayPhotoLink** — `displayPhotoLink: resolveBestCoverUrl(post),`
- `Locava Backendv2/src/repositories/source-of-truth/search-results-firestore.adapter.ts:444` **post.assets** — `assets: post.assets,`
- `Locava Backendv2/src/repositories/source-of-truth/search-results-firestore.adapter.ts:519` **displayPhotoLink** — `const direct = String(post.thumbUrl ?? post.displayPhotoLink ?? "").trim();`
- `Locava Backendv2/src/repositories/source-of-truth/search-results-firestore.adapter.ts:519` **thumbUrl** — `const direct = String(post.thumbUrl ?? post.displayPhotoLink ?? "").trim();`
- `Locava Backendv2/src/repositories/source-of-truth/search-results-firestore.adapter.ts:521` **post.assets** — `const assets = post.assets;`
- `Locava Backendv2/src/repositories/source-of-truth/search-results-firestore.adapter.ts:522` **assets[0]** — `if (Array.isArray(assets) && assets[0] && typeof assets[0] === "object") {`
- `Locava Backendv2/src/repositories/source-of-truth/search-results-firestore.adapter.ts:523` **assets[0]** — `const a0 = assets[0] as { poster?: unknown; thumbnail?: unknown; original?: unknown; url?: unknown; downloadURL?: unknown };`
- `Locava Backendv2/src/repositories/source-of-truth/search-results-firestore.adapter.ts:562` **photoLink** — `thumbUrl: String(data.thumbUrl ?? data.displayPhotoLink ?? data.photoLink ?? "").trim(),`
- `Locava Backendv2/src/repositories/source-of-truth/search-results-firestore.adapter.ts:562` **displayPhotoLink** — `thumbUrl: String(data.thumbUrl ?? data.displayPhotoLink ?? data.photoLink ?? "").trim(),`
- `Locava Backendv2/src/repositories/source-of-truth/search-results-firestore.adapter.ts:562` **thumbUrl** — `thumbUrl: String(data.thumbUrl ?? data.displayPhotoLink ?? data.photoLink ?? "").trim(),`
- `Locava Backendv2/src/repositories/source-of-truth/search-results-firestore.adapter.ts:563` **photoLink** — `displayPhotoLink: String(data.displayPhotoLink ?? data.thumbUrl ?? data.photoLink ?? "").trim(),`
- `Locava Backendv2/src/repositories/source-of-truth/search-results-firestore.adapter.ts:563` **displayPhotoLink** — `displayPhotoLink: String(data.displayPhotoLink ?? data.thumbUrl ?? data.photoLink ?? "").trim(),`
- `Locava Backendv2/src/repositories/source-of-truth/search-results-firestore.adapter.ts:563` **thumbUrl** — `displayPhotoLink: String(data.displayPhotoLink ?? data.thumbUrl ?? data.photoLink ?? "").trim(),`
- `Locava Backendv2/src/repositories/surfaces/achievements.repository.ts:391` **imageUrl** — `imageUrl: firstNonEmptyString(raw.imageUrl),`
- `Locava Backendv2/src/repositories/surfaces/achievements.repository.ts:2054` **imageUrl** — `leagueIconUrl: league.imageUrl ?? null,`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you-simple.repository.ts:22` **posterUrl** — `posterUrl: string;`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you-simple.repository.ts:43` **posterUrl** — `posterUrl: string | null;`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you-simple.repository.ts:109` **thumbUrl** — `"thumbUrl",`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you-simple.repository.ts:110` **displayPhotoLink** — `"displayPhotoLink",`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you-simple.repository.ts:547` **thumbUrl** — `thumbUrl: item.posterUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you-simple.repository.ts:547` **posterUrl** — `thumbUrl: item.posterUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you-simple.repository.ts:548` **displayPhotoLink** — `displayPhotoLink: item.posterUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you-simple.repository.ts:548` **posterUrl** — `displayPhotoLink: item.posterUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you-simple.repository.ts:618` **posterUrl** — `const posterUrl = pickString(`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you-simple.repository.ts:619` **displayPhotoLink** — `data.displayPhotoLink,`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you-simple.repository.ts:620` **thumbUrl** — `data.thumbUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you-simple.repository.ts:621` **posterUrl** — `assets[0]?.posterUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you-simple.repository.ts:621` **assets[0]** — `assets[0]?.posterUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you-simple.repository.ts:622` **assets[0]** — `assets[0]?.previewUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you-simple.repository.ts:623` **assets[0]** — `assets[0]?.originalUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you-simple.repository.ts:624` **assets[0]** — `assets[0]?.mp4Url,`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you-simple.repository.ts:625` **assets[0]** — `assets[0]?.streamUrl`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you-simple.repository.ts:627` **posterUrl** — `if (!posterUrl) return { reject: "no_media" };`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you-simple.repository.ts:651` **posterUrl** — `posterUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you-simple.repository.ts:652` **posterUrl** — `firstAssetUrl: assets[0]?.originalUrl ?? assets[0]?.previewUrl ?? posterUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you-simple.repository.ts:652` **assets[0]** — `firstAssetUrl: assets[0]?.originalUrl ?? assets[0]?.previewUrl ?? posterUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you-simple.repository.ts:836` **posterUrl** — `posterUrl: pickString(raw.posterUrl, raw.poster, variants.poster, thumb.webp, raw.thumbnail, raw.original, raw.downloadURL, raw.url),`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you.repository.ts:35` **posterUrl** — `posterUrl: string;`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you.repository.ts:56` **posterUrl** — `posterUrl: string | null;`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you.repository.ts:96` **thumbUrl** — `"thumbUrl",`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you.repository.ts:97` **displayPhotoLink** — `"displayPhotoLink",`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you.repository.ts:320` **displayPhotoLink** — `const posterUrl = pickString(data.displayPhotoLink, data.thumbUrl) ?? "";`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you.repository.ts:320` **thumbUrl** — `const posterUrl = pickString(data.displayPhotoLink, data.thumbUrl) ?? "";`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you.repository.ts:320` **posterUrl** — `const posterUrl = pickString(data.displayPhotoLink, data.thumbUrl) ?? "";`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you.repository.ts:321` **posterUrl** — `if (!posterUrl) return null;`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you.repository.ts:338` **posterUrl** — `posterUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you.repository.ts:339` **posterUrl** — `firstAssetUrl: assets[0]?.originalUrl ?? assets[0]?.previewUrl ?? posterUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you.repository.ts:339` **assets[0]** — `firstAssetUrl: assets[0]?.originalUrl ?? assets[0]?.previewUrl ?? posterUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed-for-you.repository.ts:467` **posterUrl** — `posterUrl: pickString(raw.posterUrl, raw.poster, variants.poster, thumb.webp, raw.thumbnail),`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:51` **posterUrl** — `posterUrl: string | null;`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:72` **posterUrl** — `posterUrl: string;`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:99` **photoLink** — `photoLink?: string | null;`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:100` **displayPhotoLink** — `displayPhotoLink?: string | null;`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:140` **thumbUrl** — `thumbUrl: string;`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:204` **posterUrl** — `posterUrl: string;`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:228` **posterUrl** — `posterUrl: string | null;`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:276` **posterUrl** — `posterUrl: candidate.posterUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:317` **posterUrl** — `const posterUrl = 'https://cdn.locava.test/posts/${encodeURIComponent(postId)}/poster.jpg';`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:324` **posterUrl** — `posterUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:325` **posterUrl** — `firstAssetUrl: posterUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:340` **posterUrl** — `previewUrl: posterUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:341` **posterUrl** — `posterUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:342` **posterUrl** — `originalUrl: posterUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:363` **thumbUrl** — `const posterUrl = bundle.post.thumbUrl;`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:363` **posterUrl** — `const posterUrl = bundle.post.thumbUrl;`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:364` **assets[0]** — `const firstAsset = bundle.post.assets[0];`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:364` **post.assets** — `const firstAsset = bundle.post.assets[0];`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:393` **post.assets** — `assets: bundle.post.assets.map((asset) => ({`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:405` **posterUrl** — `posterUrl: asset.poster,`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:448` **posterUrl** — `posterUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:468` **assets[0]** — `const firstAsset = bundle.post.assets[0];`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:468` **post.assets** — `const firstAsset = bundle.post.assets[0];`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:482` **thumbUrl** — `bundle.post.thumbUrl;`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:496` **post.assets** — `assets: bundle.post.assets.map((asset) => ({`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:508` **posterUrl** — `posterUrl: asset.poster,`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:536` **thumbUrl** — `posterUrl: bundle.post.thumbUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:536` **posterUrl** — `posterUrl: bundle.post.thumbUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:686` **thumbUrl** — `posterUrl: bundle.post.thumbUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:686` **posterUrl** — `posterUrl: bundle.post.thumbUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:687` **thumbUrl** — `firstAssetUrl: bundle.post.assets[0]?.thumbnail ?? bundle.post.thumbUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:687` **assets[0]** — `firstAssetUrl: bundle.post.assets[0]?.thumbnail ?? bundle.post.thumbUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:687` **post.assets** — `firstAssetUrl: bundle.post.assets[0]?.thumbnail ?? bundle.post.thumbUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:698` **post.assets** — `assets: bundle.post.assets.map((a) => ({`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:702` **posterUrl** — `posterUrl: a.poster,`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:823` **thumbUrl** — `thumbUrl: fromSource.post.thumbUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:827` **post.assets** — `assets: fromSource.post.assets,`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:1055` **thumbUrl** — `thumbUrl: profileById.data.thumbUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:1060` **thumbUrl** — `poster: asset.poster ?? asset.thumbnail ?? profileById.data.thumbUrl,`
- `Locava Backendv2/src/repositories/surfaces/feed.repository.ts:1061` **thumbUrl** — `thumbnail: asset.thumbnail ?? asset.poster ?? profileById.data.thumbUrl,`
- `Locava Backendv2/src/repositories/surfaces/map.repository.ts:52` **thumbUrl** — `thumbUrl: marker.thumbnailUrl ?? null,`
- `Locava Backendv2/src/repositories/surfaces/map.repository.ts:65` **thumbUrl** — `thumbUrl: marker.thumbnailUrl ?? null,`
- `Locava Backendv2/src/repositories/surfaces/map.repository.ts:66` **displayPhotoLink** — `displayPhotoLink: marker.thumbnailUrl ?? null,`
- `Locava Backendv2/src/repositories/surfaces/notifications.repository.ts:2` **notification** — `import type { NotificationSummary } from "../../contracts/entities/notification-entities.contract.js";`
- `Locava Backendv2/src/repositories/surfaces/notifications.repository.ts:285` **notification** — `return 'notification:${viewerId}:${notificationId}:read-state';`
- `Locava Backendv2/src/repositories/surfaces/notifications.repository.ts:346` **thumbUrl** — `thumbUrl: typeof metadata.postThumbUrl === "string" ? metadata.postThumbUrl : null`
- `Locava Backendv2/src/repositories/surfaces/notifications.repository.ts:714` **displayPhotoLink** — `asTrimmedString(postData.displayPhotoLink) ??`
- `Locava Backendv2/src/repositories/surfaces/notifications.repository.ts:715` **photoLink** — `asTrimmedString(postData.photoLink) ??`
- `Locava Backendv2/src/repositories/surfaces/notifications.repository.ts:1185` **thumbUrl** — `thumbUrl: typeof metadata.postThumbUrl === "string" ? metadata.postThumbUrl : null`
- `Locava Backendv2/src/repositories/surfaces/profile-post-detail.repository.ts:25` **thumbUrl** — `thumbUrl: string;`
- `Locava Backendv2/src/repositories/surfaces/profile-post-detail.repository.ts:106` **thumbUrl** — `const thumbUrl = 'https://picsum.photos/seed/${encodeURIComponent('${userId}-${safeIndex}')}/500/888';`
- `Locava Backendv2/src/repositories/surfaces/profile-post-detail.repository.ts:114` **thumbUrl** — `poster: thumbUrl,`
- `Locava Backendv2/src/repositories/surfaces/profile-post-detail.repository.ts:115` **thumbUrl** — `thumbnail: thumbUrl,`
- `Locava Backendv2/src/repositories/surfaces/profile-post-detail.repository.ts:127` **thumbUrl** — `poster: thumbUrl,`
- `Locava Backendv2/src/repositories/surfaces/profile-post-detail.repository.ts:128` **thumbUrl** — `thumbnail: thumbUrl`
- `Locava Backendv2/src/repositories/surfaces/profile-post-detail.repository.ts:141` **thumbUrl** — `thumbUrl,`
- `Locava Backendv2/src/repositories/surfaces/profile-post-detail.repository.ts:162` **thumbUrl** — `thumbUrl,`
- `Locava Backendv2/src/repositories/surfaces/profile-post-detail.repository.ts:163` **displayPhotoLink** — `displayPhotoLink: thumbUrl,`
- `Locava Backendv2/src/repositories/surfaces/profile-post-detail.repository.ts:163` **thumbUrl** — `displayPhotoLink: thumbUrl,`
- `Locava Backendv2/src/repositories/surfaces/profile.repository.ts:48` **thumbUrl** — `thumbUrl: string;`
- `Locava Backendv2/src/repositories/surfaces/search.repository.ts:15` **thumbUrl** — `thumbUrl: string;`
- `Locava Backendv2/src/repositories/surfaces/search.repository.ts:16` **displayPhotoLink** — `displayPhotoLink: string;`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:22` **notification** — `import { mapV2NotificationListToLegacyItems } from "./map-v2-notification-to-legacy-product.js";`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:69` **thumbUrl** — `rows: Array<{ userId: string; postId: string; thumbUrl: string }>;`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:83` **thumbUrl** — `async function loadRecentPostsForStoryUsers(): Promise<Array<{ userId: string; postId: string; thumbUrl: string }>> {`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:89` **thumbUrl** — `const rows: Array<{ userId: string; postId: string; thumbUrl: string }> = [];`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:96` **photoLink** — `const thumbUrl = String(data.thumbUrl ?? data.displayPhotoLink ?? data.photoLink ?? "").trim();`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:96` **displayPhotoLink** — `const thumbUrl = String(data.thumbUrl ?? data.displayPhotoLink ?? data.photoLink ?? "").trim();`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:96` **thumbUrl** — `const thumbUrl = String(data.thumbUrl ?? data.displayPhotoLink ?? data.photoLink ?? "").trim();`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:97` **thumbUrl** — `rows.push({ userId, postId, thumbUrl });`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:213` **photoLink** — `thumbUrl: String(data.thumbUrl ?? data.displayPhotoLink ?? data.photoLink ?? ""),`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:213` **displayPhotoLink** — `thumbUrl: String(data.thumbUrl ?? data.displayPhotoLink ?? data.photoLink ?? ""),`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:213` **thumbUrl** — `thumbUrl: String(data.thumbUrl ?? data.displayPhotoLink ?? data.photoLink ?? ""),`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:214` **photoLink** — `displayPhotoLink: String(data.displayPhotoLink ?? data.thumbUrl ?? data.photoLink ?? "")`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:214` **displayPhotoLink** — `displayPhotoLink: String(data.displayPhotoLink ?? data.thumbUrl ?? data.photoLink ?? "")`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:214` **thumbUrl** — `displayPhotoLink: String(data.displayPhotoLink ?? data.thumbUrl ?? data.photoLink ?? "")`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:667` **thumbUrl** — `const latestByUser = new Map<string, { postId: string; thumbUrl: string }>();`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:672` **thumbUrl** — `latestByUser.set(userId, { postId: row.postId, thumbUrl: row.thumbUrl });`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:695` **thumbUrl** — `thumbUrl: post.thumbUrl,`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:1450` **displayPhotoLink** — `thumbUrl: String(post.thumbUrl ?? post.displayPhotoLink ?? ""),`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:1450` **thumbUrl** — `thumbUrl: String(post.thumbUrl ?? post.displayPhotoLink ?? ""),`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:1451` **displayPhotoLink** — `displayPhotoLink: String(post.displayPhotoLink ?? post.thumbUrl ?? ""),`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:1451` **thumbUrl** — `displayPhotoLink: String(post.displayPhotoLink ?? post.thumbUrl ?? ""),`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:1911` **imageUrl** — `return reply.send({ success: true, displayPhotoUrl: uploaded.url, imageUrl: uploaded.url });`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:1914` **imageUrl** — `const imageUrl =`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:1915` **imageUrl** — `typeof raw.imageUrl === "string"`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:1916` **imageUrl** — `? raw.imageUrl`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:1922` **imageUrl** — `return reply.send({ success: true, imageUrl });`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:1943` **imageUrl** — `: typeof raw.imageUrl === "string"`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:1944` **imageUrl** — `? raw.imageUrl`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:2000` **imageUrl** — `return reply.send({ success: true, displayPhotoUrl: uploaded.url, imageUrl: uploaded.url });`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:2014` **imageUrl** — `: typeof raw.imageUrl === "string"`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:2015` **imageUrl** — `? raw.imageUrl`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:2126` **displayPhotoLink** — `const thumb = String(post.thumbUrl ?? post.displayPhotoLink ?? "").trim();`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:2126` **thumbUrl** — `const thumb = String(post.thumbUrl ?? post.displayPhotoLink ?? "").trim();`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:2154` **displayPhotoLink** — `.map((post) => String(post.thumbUrl ?? post.displayPhotoLink ?? "").trim())`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:2154` **thumbUrl** — `.map((post) => String(post.thumbUrl ?? post.displayPhotoLink ?? "").trim())`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:2290` **imageUrl** — `: typeof raw.imageUrl === "string"`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:2291` **imageUrl** — `? raw.imageUrl`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:2772` **thumbUrl** — `thumbUrl: String(m.thumbUrl ?? ""),`
- `Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts:2999` **imageUrl** — `coverUrl: typeof raw.imageUrl === "string" ? raw.imageUrl : typeof raw.coverUrl === "string" ? raw.coverUrl : undefined`
- `Locava Backendv2/src/routes/compat/legacy-monolith-notifications-proxy.routes.ts:16` **notification** — `"Legacy notification mutation/push routes are monolith-backed. Set LEGACY_MONOLITH_PROXY_BASE_URL to enable /api/notifications parity."`
- `Locava Backendv2/src/routes/compat/legacy-product-bootstrap.ts:39` **thumbUrl** — `thumbUrl: string;`
- `Locava Backendv2/src/routes/compat/legacy-product-bootstrap.ts:65` **thumbUrl** — `thumbUrl: it.thumbUrl,`
- `Locava Backendv2/src/routes/compat/legacy-reels-near-me.routes.ts:193` **post.assets** — `const assets = post.assets;`
- `Locava Backendv2/src/routes/compat/legacy-reels-near-me.routes.ts:195` **assets[0]** — `const first = assets[0] as Record<string, unknown> | undefined;`
- `Locava Backendv2/src/routes/compat/legacy-reels-near-me.routes.ts:322` **post.assets** — `const assets = Array.isArray(post.assets) ? (post.assets as Array<Record<string, unknown>>) : [];`
- `Locava Backendv2/src/routes/compat/legacy-reels-near-me.routes.ts:323` **assets[0]** — `const firstAsset = assets[0];`
- `Locava Backendv2/src/routes/compat/legacy-reels-near-me.routes.ts:328` **posterUrl** — `const posterUrl =`
- `Locava Backendv2/src/routes/compat/legacy-reels-near-me.routes.ts:333` **displayPhotoLink** — `normalizeUrl(post.displayPhotoLink) ??`
- `Locava Backendv2/src/routes/compat/legacy-reels-near-me.routes.ts:392` **posterUrl** — `posterUrl,`
- `Locava Backendv2/src/routes/compat/map-v2-notification-to-legacy-product.ts:2` **notification** — `* Maps Backendv2 notification list payload ('data' envelope) to legacy`
- `Locava Backendv2/src/routes/compat/map-v2-notification-to-legacy-product.ts:24` **thumbUrl** — `const u = preview && typeof preview.thumbUrl === "string" ? preview.thumbUrl.trim() : "";`
- `Locava Backendv2/src/routes/compat/map-v2-notification-to-legacy-product.ts:34` **notification** — `/** One notification row for legacy product JSON ('NotificationItem'-compatible). */`
- `Locava Backendv2/src/routes/compat/map-v2-notification-to-legacy-product.ts:63` **notification** — `message: previewText(n) || 'Notification ${index + 1}',`
- `Locava Backendv2/src/routes/contracts.ts:128` **profile grid** — `{ method: "GET", path: "/v2/profiles/:userId/grid", description: "V2 profile grid pagination surface", tags: ["v2", "profile"], querySchema: { cursor: "string optional", limit: "number (6-24) optional`
- `Locava Backendv2/src/routes/contracts.ts:589` **map marker** — `description: "V2 map marker-index bootstrap read surface",`
- `Locava Backendv2/src/routes/debug/local-debug.routes.ts:11` **notification** — `import { legacyNotificationPushPublisher } from "../../services/notifications/legacy-notification-push.publisher.js";`
- `Locava Backendv2/src/routes/debug/local-debug.routes.ts:36` **notification** — `commentText: z.string().min(1).default("Testing Backend v2 comment notification deep link"),`
- `Locava Backendv2/src/routes/debug/local-debug.routes.ts:40` **notification** — `messageText: z.string().min(1).default("Testing Backend v2 realtime chat notification"),`
- `Locava Backendv2/src/routes/debug/post-rebuilder.routes.ts:46` **media.assets** — `const c=d.canonicalPreview||{};const media=(c.media||{});const assets=(media.assets||[]).map(a=>a.type==='video'?{id:a.id,type:a.type,default:a.video?.playback?.defaultUrl,primary:a.video?.playback?.p`
- `Locava Backendv2/src/routes/debug/post-rebuilder.routes.ts:47` **media.assets** — `el("media").textContent=json({cover:media.cover,assetCount:media.assetCount,assetsReady:media.assetsReady,instantPlaybackReady:media.instantPlaybackReady,rawAssetCount:media.rawAssetCount,hasMultipleA`
- `Locava Backendv2/src/routes/debug/post-rebuilder.routes.ts:136` **fallbackVideoUrl** — `Boolean(normalized.canonical.compatibility.photoLinks2 ?? normalized.canonical.compatibility.fallbackVideoUrl),`
- `Locava Backendv2/src/routes/debug/post-rebuilder.routes.ts:137` **media.assets** — `hasMp4ImageAssets: normalized.canonical.media.assets.some(`
- `Locava Backendv2/src/routes/public/expo-push.routes.ts:45` **imageUrl** — `const imageUrl = asTrimmedString(rawBody.imageUrl);`
- `Locava Backendv2/src/routes/public/expo-push.routes.ts:58` **notification** — `return reply.status(400).send(failure("validation_error", "Missing 'body' (notification message text)"));`
- `Locava Backendv2/src/routes/public/expo-push.routes.ts:73` **imageUrl** — `if (imageUrl && /^https?:\/\//i.test(imageUrl)) {`
- `Locava Backendv2/src/routes/public/expo-push.routes.ts:75` **imageUrl** — `expoMessage.richContent = { image: imageUrl };`
- `Locava Backendv2/src/routes/public/expo-push.routes.ts:76` **imageUrl** — `data.imageUrl = imageUrl;`
- `Locava Backendv2/src/routes/public/expo-push.routes.ts:77` **imageUrl** — `data._richContent = JSON.stringify({ image: imageUrl });`
- `Locava Backendv2/src/routes/v2/collections-v2.routes.ts:59` **imageUrl** — `imageUrl: HttpsCoverUrlSchema.optional()`
- `Locava Backendv2/src/routes/v2/collections-v2.routes.ts:106` **thumbUrl** — `thumbUrl: string;`
- `Locava Backendv2/src/routes/v2/collections-v2.routes.ts:107` **displayPhotoLink** — `displayPhotoLink: string;`
- `Locava Backendv2/src/routes/v2/collections-v2.routes.ts:117` **displayPhotoLink** — `const posterUrl = String(row.thumbUrl || row.displayPhotoLink || "").trim();`
- `Locava Backendv2/src/routes/v2/collections-v2.routes.ts:117` **thumbUrl** — `const posterUrl = String(row.thumbUrl || row.displayPhotoLink || "").trim();`
- `Locava Backendv2/src/routes/v2/collections-v2.routes.ts:117` **posterUrl** — `const posterUrl = String(row.thumbUrl || row.displayPhotoLink || "").trim();`
- `Locava Backendv2/src/routes/v2/collections-v2.routes.ts:133` **posterUrl** — `firstAssetUrl: /^https?:\/\//i.test(posterUrl) ? posterUrl : null,`
- `Locava Backendv2/src/routes/v2/collections-v2.routes.ts:136` **posterUrl** — `posterUrl,`
- `Locava Backendv2/src/routes/v2/collections-v2.routes.ts:220` **posterUrl** — `card.posterUrl,`
- `Locava Backendv2/src/routes/v2/collections-v2.routes.ts:221` **thumbUrl** — `card.thumbUrl,`
- `Locava Backendv2/src/routes/v2/collections-v2.routes.ts:222` **displayPhotoLink** — `card.displayPhotoLink,`
- `Locava Backendv2/src/routes/v2/collections-v2.routes.ts:223` **posterUrl** — `media?.posterUrl,`
- `Locava Backendv2/src/routes/v2/collections-v2.routes.ts:224` **posterUrl** — `normalizedMedia?.posterUrl,`
- `Locava Backendv2/src/routes/v2/collections-v2.routes.ts:234` **posterUrl** — `return [asset.originalUrl, asset.previewUrl, asset.posterUrl, asset.mp4Url, asset.streamUrl].some(`
- `Locava Backendv2/src/routes/v2/collections-v2.routes.ts:289` **posterUrl** — `posterUrl: row.posterUrl,`
- `Locava Backendv2/src/routes/v2/collections-v2.routes.ts:290` **assets[0]** — `aspectRatio: row.assets[0]?.aspectRatio ?? 9 / 16,`
- `Locava Backendv2/src/routes/v2/collections-v2.routes.ts:546` **posterUrl** — `const posterUrl = String(item.media?.posterUrl ?? "").trim();`
- `Locava Backendv2/src/routes/v2/collections-v2.routes.ts:547` **posterUrl** — `if (!/^https?:\/\//i.test(posterUrl)) continue;`
- `Locava Backendv2/src/routes/v2/collections-v2.routes.ts:667` **displayPhotoLink** — `const u = first ? String(first.thumbUrl ?? first.displayPhotoLink ?? "").trim() : "";`
- `Locava Backendv2/src/routes/v2/collections-v2.routes.ts:667` **thumbUrl** — `const u = first ? String(first.thumbUrl ?? first.displayPhotoLink ?? "").trim() : "";`
- `Locava Backendv2/src/routes/v2/collections-v2.routes.ts:880` **posterUrl** — `.filter((row) => /^https?:\/\//i.test(String(row.media?.posterUrl ?? "")));`
- `Locava Backendv2/src/routes/v2/collections-v2.routes.ts:977` **imageUrl** — `coverUri = String(raw.coverUri ?? raw.url ?? raw.imageUrl ?? "").trim();`
- `Locava Backendv2/src/routes/v2/collections-v2.routes.ts:1081` **collection post** — `// invalidation: delete invalidates viewer collection list, collection detail, and collection post pages.`
- `Locava Backendv2/src/routes/v2/map-markers.routes.ts:28` **posterUrl** — `posterUrl: String(marker.thumbnailUrl ?? "").trim(),`
- `Locava Backendv2/src/routes/v2/map-markers.routes.ts:47` **thumbUrl** — `thumbUrl: marker.thumbnailUrl ?? null,`
- `Locava Backendv2/src/routes/v2/map-markers.routes.ts:48` **displayPhotoLink** — `displayPhotoLink: marker.thumbnailUrl ?? null,`
- `Locava Backendv2/src/routes/v2/posting-staging-presign.routes.ts:73` **posterUrl** — `posterUrl?: string;`
- `Locava Backendv2/src/routes/v2/posting-staging-presign.routes.ts:186` **posterUrl** — `posterUrl?: string;`
- `Locava Backendv2/src/routes/v2/search-discovery.routes.ts:306` **displayPhotoLink** — `thumbUrl: String(post.thumbUrl ?? post.displayPhotoLink ?? ""),`
- `Locava Backendv2/src/routes/v2/search-discovery.routes.ts:306` **thumbUrl** — `thumbUrl: String(post.thumbUrl ?? post.displayPhotoLink ?? ""),`
- `Locava Backendv2/src/routes/v2/search-discovery.routes.ts:307` **displayPhotoLink** — `displayPhotoLink: String(post.displayPhotoLink ?? post.thumbUrl ?? ""),`
- `Locava Backendv2/src/routes/v2/search-discovery.routes.ts:307` **thumbUrl** — `displayPhotoLink: String(post.displayPhotoLink ?? post.thumbUrl ?? ""),`
- `Locava Backendv2/src/routes/v2/search-discovery.routes.ts:330` **thumbUrl** — `const coverUri = String(item.coverPhotoUrl ?? item.coverUri ?? item.thumbUrl ?? "");`
- `Locava Backendv2/src/routes/v2/search-discovery.routes.ts:511` **displayPhotoLink** — `.map((p) => String((p as any)?.thumbUrl ?? (p as any)?.displayPhotoLink ?? "").trim())`
- `Locava Backendv2/src/routes/v2/search-discovery.routes.ts:511` **thumbUrl** — `.map((p) => String((p as any)?.thumbUrl ?? (p as any)?.displayPhotoLink ?? "").trim())`
- `Locava-Native/src/features/achievements/achievementModals.store.ts:87` **displayPhotoLink** — `/** Post thumbnail for globe marker (first image or displayPhotoLink). */`
- `Locava-Native/src/features/achievements/achievements.store.ts:1977` **displayPhotoLink** — `displayPhotoLink: imageUrl ?? (target as { displayPhotoLink?: string }).displayPhotoLink,`
- `Locava-Native/src/features/achievements/achievements.store.ts:1978` **photoLink** — `photoLink: imageUrl ?? (target as { photoLink?: string }).photoLink,`
- `Locava-Native/src/features/achievements/achievements.types.ts:45` **photoLink** — `/** Image URL for the capture (post thumb). Backend may send displayPhotoLink/photoLink (from post) or imageUrl/thumbUrl. */`
- `Locava-Native/src/features/achievements/achievements.types.ts:45` **displayPhotoLink** — `/** Image URL for the capture (post thumb). Backend may send displayPhotoLink/photoLink (from post) or imageUrl/thumbUrl. */`
- `Locava-Native/src/features/achievements/achievements.types.ts:45` **thumbUrl** — `/** Image URL for the capture (post thumb). Backend may send displayPhotoLink/photoLink (from post) or imageUrl/thumbUrl. */`
- `Locava-Native/src/features/achievements/achievements.types.ts:47` **thumbUrl** — `thumbUrl?: string;`
- `Locava-Native/src/features/achievements/achievements.types.ts:49` **displayPhotoLink** — `displayPhotoLink?: string;`
- `Locava-Native/src/features/achievements/achievements.types.ts:50` **photoLink** — `photoLink?: string;`
- `Locava-Native/src/features/achievements/achievements.types.ts:391` **thumbUrl** — `thumbUrl?: string;`
- `Locava-Native/src/features/achievements/achievements.utils.ts:3` **photoLink** — `* (matches old app: displayPhotoLink || imageUrl || photoLink || thumbUrl).`
- `Locava-Native/src/features/achievements/achievements.utils.ts:3` **displayPhotoLink** — `* (matches old app: displayPhotoLink || imageUrl || photoLink || thumbUrl).`
- `Locava-Native/src/features/achievements/achievements.utils.ts:3` **thumbUrl** — `* (matches old app: displayPhotoLink || imageUrl || photoLink || thumbUrl).`
- `Locava-Native/src/features/achievements/achievements.utils.ts:86` **displayPhotoLink** — `(c as { displayPhotoLink?: string }).displayPhotoLink ??`
- `Locava-Native/src/features/achievements/achievements.utils.ts:88` **photoLink** — `(c as { photoLink?: string }).photoLink ??`
- `Locava-Native/src/features/achievements/achievements.utils.ts:89` **thumbUrl** — `c.thumbUrl ??`
- `Locava-Native/src/features/achievements/competitive/CompetitiveBadgeDetailModal.tsx:96` **thumbUrl** — `thumbUrl={first.thumbUrl ?? null}`
- `Locava-Native/src/features/achievements/competitive/CompetitiveBadgeDetailModal.tsx:100` **thumbUrl** — `thumbUrl: post.thumbUrl ?? null,`
- `Locava-Native/src/features/achievements/heavy/sections/DebugSection.tsx:122` **thumbUrl** — `thumbUrl: markerUri,`
- `Locava-Native/src/features/achievements/heavy/sections/OverviewSection.tsx:222` **displayPhotoLink** — `displayPhotoLink: heroUri ?? undefined,`
- `Locava-Native/src/features/achievements/heavy/WeeklyCaptures.tsx:339` **displayPhotoLink** — `displayPhotoLink: heroUri ?? undefined,`
- `Locava-Native/src/features/achievements/heavy/WeeklyCaptures.tsx:592` **thumbUrl** — `const thumbUrl = getCaptureImageUrl(c);`
- `Locava-Native/src/features/achievements/heavy/WeeklyCaptures.tsx:618` **thumbUrl** — `{thumbUrl && thumbUrl.trim().length > 0 ? (`
- `Locava-Native/src/features/achievements/heavy/WeeklyCaptures.tsx:620` **thumbUrl** — `source={{ uri: thumbUrl }}`
- `Locava-Native/src/features/achievements/modals/PostResultFlow.heavy.tsx:987` **thumbUrl** — `<MapMarkerPin thumbUrl={oldImageUri} />`
- `Locava-Native/src/features/achievements/modals/PostResultFlow.heavy.tsx:990` **thumbUrl** — `<MapMarkerPin thumbUrl={newImageUri} />`
- `Locava-Native/src/features/achievements/monthlyOverview/MonthlyOverviewModal.heavy.tsx:230` **post.assets** — `const assets = (post.assets as unknown[] | undefined) ?? [];`
- `Locava-Native/src/features/achievements/monthlyOverview/MonthlyOverviewModal.heavy.tsx:233` **displayPhotoLink** — `(post.displayPhotoLink as string | undefined) ??`
- `Locava-Native/src/features/achievements/monthlyOverview/MonthlyOverviewModal.heavy.tsx:234` **photoLink** — `(post.photoLink as string | undefined) ??`
- `Locava-Native/src/features/achievements/monthlyOverview/MonthlyOverviewModal.heavy.tsx:235` **thumbUrl** — `(post.thumbUrl as string | undefined);`
- `Locava-Native/src/features/achievements/monthlyOverview/MonthlyOverviewModal.heavy.tsx:237` **photoLink** — `(post.legacy as { photoLink?: string } | undefined)?.photoLink ??`
- `Locava-Native/src/features/achievements/monthlyOverview/MonthlyOverviewModal.heavy.tsx:238` **photoLink** — `(post.photoLink as string | undefined);`
- `Locava-Native/src/features/achievements/monthlyOverview/MonthlyOverviewModal.heavy.tsx:330` **displayPhotoLink** — `displayPhotoLink: post.heroUri,`
- `Locava-Native/src/features/achievements/monthlyOverview/MonthlyOverviewModal.heavy.tsx:331` **thumbUrl** — `thumbUrl: post.heroUri,`
- `Locava-Native/src/features/achievements/monthlyOverview/MonthlyOverviewModal.heavy.tsx:396` **thumbUrl** — `thumbUrl: post.heroUri,`
- `Locava-Native/src/features/achievements/monthlyOverview/MonthlyOverviewModal.heavy.tsx:998` **thumbUrl** — `<MapMarkerPin thumbUrl={post.heroUri ?? null} />`
- `Locava-Native/src/features/achievements/monthlyOverview/MonthlyOverviewModal.heavy.tsx:1128` **thumbUrl** — `thumbUrl: post.heroUri ?? null,`
- `Locava-Native/src/features/achievements/monthlyOverview/MonthlyOverviewModal.heavy.tsx:1677` **thumbUrl** — `<MapMarkerPin thumbUrl={post.heroUri ?? null} />`
- `Locava-Native/src/features/achievements/monthlyOverview/monthlyRecap.load.ts:276` **photoLink** — `heroUri = getHeroUri(source) ?? raw.displayPhotoLink ?? raw.photoLink ?? undefined;`
- `Locava-Native/src/features/achievements/monthlyOverview/monthlyRecap.load.ts:276` **displayPhotoLink** — `heroUri = getHeroUri(source) ?? raw.displayPhotoLink ?? raw.photoLink ?? undefined;`
- `Locava-Native/src/features/achievements/monthlyOverview/monthlyRecap.load.ts:278` **displayPhotoLink** — `const d = raw.displayPhotoLink;`
- `Locava-Native/src/features/achievements/monthlyOverview/monthlyRecap.load.ts:279` **photoLink** — `const p = raw.photoLink;`
- `Locava-Native/src/features/achievements/weeklyCapturesShowcase/WeeklyCapturesMapFullScreen.heavy.tsx:148` **thumbUrl** — `<MapMarkerPin thumbUrl={getCaptureImageUrl(capture) ?? null} />`
- `Locava-Native/src/features/achievements/weeklyCapturesShowcase/WeeklyCapturesMapFullScreen.heavy.tsx:424` **displayPhotoLink** — `displayPhotoLink: heroUri ?? undefined,`
- `Locava-Native/src/features/achievements/weeklyCapturesShowcase/WeeklyCapturesMapFullScreen.heavy.tsx:538` **thumbUrl** — `thumbUrl={getCaptureImageUrl(capture) ?? null}`
- `Locava-Native/src/features/achievements/weeklyCapturesShowcase/WeeklyCapturesRevealView.heavy.tsx:87` **thumbUrl** — `const thumbUrl = getCaptureImageUrl(capture);`
- `Locava-Native/src/features/achievements/weeklyCapturesShowcase/WeeklyCapturesRevealView.heavy.tsx:109` **thumbUrl** — `{thumbUrl ? (`
- `Locava-Native/src/features/achievements/weeklyCapturesShowcase/WeeklyCapturesRevealView.heavy.tsx:110` **thumbUrl** — `<Image source={{ uri: thumbUrl }} style={styles.pinImage} contentFit="cover" />`
- `Locava-Native/src/features/chats/components/CreateGroupChatScreen.tsx:102` **assets[0]** — `setImageUri(result.assets[0].uri);`
- `Locava-Native/src/features/chats/components/EditGroupScreen.tsx:100` **assets[0]** — `setImageUri(result.assets[0].uri);`
- `Locava-Native/src/features/chatThread/components/MessageBubble.tsx:423` **photoLink** — `if (post && (post.displayPhotoLink ?? post.thumbUrl ?? post.photoLink)) {`
- `Locava-Native/src/features/chatThread/components/MessageBubble.tsx:423` **displayPhotoLink** — `if (post && (post.displayPhotoLink ?? post.thumbUrl ?? post.photoLink)) {`
- `Locava-Native/src/features/chatThread/components/MessageBubble.tsx:423` **thumbUrl** — `if (post && (post.displayPhotoLink ?? post.thumbUrl ?? post.photoLink)) {`
- `Locava-Native/src/features/chatThread/components/MessageBubble.tsx:427` **photoLink** — `thumbUrl: (post.displayPhotoLink ?? post.thumbUrl ?? post.photoLink) as string | undefined,`
- `Locava-Native/src/features/chatThread/components/MessageBubble.tsx:427` **displayPhotoLink** — `thumbUrl: (post.displayPhotoLink ?? post.thumbUrl ?? post.photoLink) as string | undefined,`
- `Locava-Native/src/features/chatThread/components/MessageBubble.tsx:427` **thumbUrl** — `thumbUrl: (post.displayPhotoLink ?? post.thumbUrl ?? post.photoLink) as string | undefined,`
- `Locava-Native/src/features/chatThread/components/MessageBubble.tsx:428` **displayPhotoLink** — `displayPhotoLink: post.displayPhotoLink as string | undefined,`
- `Locava-Native/src/features/collections/CreateBlendSheetContent.tsx:91` **assets[0]** — `setImageUri(result.assets[0].uri);`
- `Locava-Native/src/features/collections/CreateCollectionModalContent.tsx:127` **assets[0]** — `setImageUri(result.assets[0].uri);`
- `Locava-Native/src/features/collections/CreateCollectionSheet.heavy.tsx:66` **assets[0]** — `setImageUri(result.assets[0].uri);`
- `Locava-Native/src/features/collections/CreateMixSheetContent.tsx:103` **assets[0]** — `setImageUri(result.assets[0].uri);`
- `Locava-Native/src/features/collections/EditCollectionModalContent.tsx:134` **assets[0]** — `setImageUri(result.assets[0].uri);`
- `Locava-Native/src/features/commonsReview/CommonsReviewScreen.heavy.tsx:221` **assets[0]** — `const thumb = assets[0]?.thumbnailUrl ?? assets[0]?.fileUrl ?? null;`
- `Locava-Native/src/features/continuity/mergePostPreserveRichFields.ts:70` **displayPhotoLink** — `"displayPhotoLink",`
- `Locava-Native/src/features/continuity/mergePostPreserveRichFields.ts:71` **photoLink** — `"photoLink",`
- `Locava-Native/src/features/continuity/mergePostPreserveRichFields.ts:72` **thumbUrl** — `"thumbUrl",`
- `Locava-Native/src/features/continuity/postEntity.store.ts:270` **thumbUrl** — `thumbUrl:`
- `Locava-Native/src/features/continuity/postEntity.store.ts:271` **thumbUrl** — `pickNonEmptyString((withAuth as Record<string, unknown> | null)?.thumbUrl) ??`
- `Locava-Native/src/features/continuity/postEntity.store.ts:272` **thumbUrl** — `pickNonEmptyString(fallbackLayer?.thumbUrl) ??`
- `Locava-Native/src/features/continuity/postEntity.store.ts:273` **thumbUrl** — `(withAuth as Record<string, unknown> | null)?.thumbUrl,`
- `Locava-Native/src/features/continuity/postEntity.store.ts:274` **displayPhotoLink** — `displayPhotoLink:`
- `Locava-Native/src/features/continuity/postEntity.store.ts:275` **displayPhotoLink** — `pickNonEmptyString((withAuth as Record<string, unknown> | null)?.displayPhotoLink) ??`
- `Locava-Native/src/features/continuity/postEntity.store.ts:276` **displayPhotoLink** — `pickNonEmptyString(fallbackLayer?.displayPhotoLink) ??`
- `Locava-Native/src/features/continuity/postEntity.store.ts:277` **displayPhotoLink** — `(withAuth as Record<string, unknown> | null)?.displayPhotoLink,`
- `Locava-Native/src/features/continuity/postWarmQueue.ts:142` **thumbUrl** — `thumbUrl: typeof thin?.thumbUrl === "string" ? thin.thumbUrl : undefined,`
- `Locava-Native/src/features/continuity/postWarmQueue.ts:157` **thumbUrl** — `const thumbUrl =`
- `Locava-Native/src/features/continuity/postWarmQueue.ts:158` **displayPhotoLink** — `(withIds.displayPhotoLink as string | undefined) ??`
- `Locava-Native/src/features/continuity/postWarmQueue.ts:159` **thumbUrl** — `(withIds.thumbUrl as string | undefined) ??`
- `Locava-Native/src/features/continuity/postWarmQueue.ts:160` **photoLink** — `(withIds.photoLink as string | undefined);`
- `Locava-Native/src/features/continuity/postWarmQueue.ts:161` **thumbUrl** — `return { postId: pid, post: withIds, thumbUrl };`
- `Locava-Native/src/features/continuity/postWarmQueue.ts:211` **post.assets** — `const assets = post.assets as VideoAssetLike[] | undefined;`
- `Locava-Native/src/features/continuity/postWarmQueue.ts:217` **assets[0]** — `const first = assets[0];`
- `Locava-Native/src/features/continuity/postWarmQueue.ts:418` **post.assets** — `const assets = row.post.assets as VideoAssetLike[] | undefined;`
- `Locava-Native/src/features/continuity/postWarmQueue.ts:491` **post.assets** — `return count + (Array.isArray(post.assets) && post.assets.length > 0 ? 1 : 0);`
- `Locava-Native/src/features/continuity/postWarmQueue.ts:629` **assets[0]** — `const v0 = assets[0];`
- `Locava-Native/src/features/downloads/downloads.postTransform.ts:25` **photoLink** — `for (const raw of [post.displayPhotoLink, post.thumbUrl, post.photoLink]) {`
- `Locava-Native/src/features/downloads/downloads.postTransform.ts:25` **displayPhotoLink** — `for (const raw of [post.displayPhotoLink, post.thumbUrl, post.photoLink]) {`
- `Locava-Native/src/features/downloads/downloads.postTransform.ts:25` **thumbUrl** — `for (const raw of [post.displayPhotoLink, post.thumbUrl, post.photoLink]) {`
- `Locava-Native/src/features/downloads/downloads.postTransform.ts:57` **photoLink** — `const existingLocalHero = [nextPost.displayPhotoLink, nextPost.thumbUrl, nextPost.photoLink].find(`
- `Locava-Native/src/features/downloads/downloads.postTransform.ts:57` **displayPhotoLink** — `const existingLocalHero = [nextPost.displayPhotoLink, nextPost.thumbUrl, nextPost.photoLink].find(`
- `Locava-Native/src/features/downloads/downloads.postTransform.ts:57` **thumbUrl** — `const existingLocalHero = [nextPost.displayPhotoLink, nextPost.thumbUrl, nextPost.photoLink].find(`
- `Locava-Native/src/features/downloads/downloads.postTransform.ts:84` **displayPhotoLink** — `nextPost.displayPhotoLink = resolvedHeroUri;`
- `Locava-Native/src/features/downloads/downloads.postTransform.ts:85` **thumbUrl** — `nextPost.thumbUrl = resolvedHeroUri;`
- `Locava-Native/src/features/downloads/downloads.postTransform.ts:86` **photoLink** — `nextPost.photoLink = resolvedHeroUri;`
- `Locava-Native/src/features/downloads/downloads.store.ts:67` **post.assets** — `if (Array.isArray(post.assets) && post.assets.length > 0) return true;`
- `Locava-Native/src/features/downloads/downloads.store.ts:70` **displayPhotoLink** — `(post.displayPhotoLink as string | undefined) ??`
- `Locava-Native/src/features/downloads/downloads.store.ts:71` **thumbUrl** — `(post.thumbUrl as string | undefined) ??`
- `Locava-Native/src/features/downloads/downloads.store.ts:72` **photoLink** — `(post.photoLink as string | undefined)`
- `Locava-Native/src/features/downloads/downloads.store.ts:348` **post.assets** — `const assets = Array.isArray(post.assets) ? [...(post.assets as Record<string, unknown>[])] : [];`
- `Locava-Native/src/features/downloads/downloads.store.ts:536` **displayPhotoLink** — `const heroUri = getHeroUri(post) ?? (post.displayPhotoLink as string | undefined) ?? '';`
- `Locava-Native/src/features/editProfile/EditProfile.heavy.tsx:166` **assets[0]** — `const uri = result.assets[0].uri;`
- `Locava-Native/src/features/findFriends/findFriends.postMedia.ts:9` **thumbUrl** — `if (typeof post.thumbUrl === 'string' && post.thumbUrl.trim()) return post.thumbUrl;`
- `Locava-Native/src/features/findFriends/findFriends.postMedia.ts:10` **displayPhotoLink** — `if (typeof post.displayPhotoLink === 'string' && post.displayPhotoLink.trim()) return post.displayPhotoLink;`
- `Locava-Native/src/features/findFriends/findFriends.postMedia.ts:11` **photoLink** — `if (typeof post.photoLink === 'string' && post.photoLink.trim()) return post.photoLink;`
- `Locava-Native/src/features/findFriends/findFriends.postMedia.ts:12` **post.assets** — `const assets = Array.isArray(post.assets) ? post.assets : [];`
- `Locava-Native/src/features/findFriends/FindFriendsHeroMap.tsx:41` **thumbUrl** — `thumbUrl: p.thumbUrl,`

… 622 more …

## unknown (956)

- `Locava Backendv2/scripts/audit-native-action-coverage.mts:17` **notification** — unknown
- `Locava Backendv2/scripts/audit-native-action-coverage.mts:300` **profile grid** — unknown
- `Locava Backendv2/scripts/audit-native-action-coverage.mts:303` **profile grid** — unknown
- `Locava Backendv2/scripts/audit-native-action-coverage.mts:572` **notification** — unknown
- `Locava Backendv2/scripts/audit-native-action-coverage.mts:598` **notification** — unknown
- `Locava Backendv2/scripts/audit-native-action-coverage.mts:600` **notification** — unknown
- `Locava Backendv2/scripts/audit-native-action-coverage.mts:700` **profile grid** — unknown
- `Locava Backendv2/scripts/audit-native-action-coverage.mts:775` **notification** — unknown
- `Locava Backendv2/scripts/audit-native-action-coverage.mts:1139` **notification** — unknown
- `Locava Backendv2/scripts/audit-native-action-coverage.mts:1589` **notification** — unknown
- `Locava Backendv2/scripts/debug-backendv2-feed-native-only.mts:50` **posterUrl** — unknown
- `Locava Backendv2/scripts/debug-backendv2-feed-native-only.mts:68` **posterUrl** — unknown
- `Locava Backendv2/scripts/debug-feed-for-you-simple.mts:58` **thumbUrl** — unknown
- `Locava Backendv2/scripts/debug-feed-for-you-simple.mts:59` **displayPhotoLink** — unknown
- `Locava Backendv2/scripts/debug-firestore-access-probe.mts:93` **photoLink** — unknown
- `Locava Backendv2/scripts/debug-firestore-access-probe.mts:93` **displayPhotoLink** — unknown
- `Locava Backendv2/scripts/debug-firestore-access-probe.mts:93` **thumbUrl** — unknown
- `Locava Backendv2/scripts/debug-full-app-v2-audit.mts:139` **displayPhotoLink** — unknown
- `Locava Backendv2/scripts/debug-full-app-v2-audit.mts:140` **thumbUrl** — unknown
- `Locava Backendv2/scripts/debug-full-app-v2-audit.mts:141` **photoLink** — unknown
- `Locava Backendv2/scripts/debug-full-app-v2-audit.mts:649` **profile grid** — unknown
- `Locava Backendv2/scripts/debug-logged-in-user-tabs.mts:52` **posterUrl** — unknown
- `Locava Backendv2/scripts/debug-logged-in-user-tabs.mts:53` **videoUrl** — unknown
- `Locava Backendv2/scripts/debug-post-assets.mts:58` **displayPhotoLink** — unknown
- `Locava Backendv2/scripts/debug-post-assets.mts:66` **displayPhotoLink** — unknown
- `Locava Backendv2/scripts/debug-post-assets.mts:99` **displayPhotoLink** — unknown
- `Locava Backendv2/scripts/debug-post-detail-hydration.mts:48` **thumbUrl** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:58` **posterUrl** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:59` **videoUrl** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:142` **posterUrl** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:143` **videoUrl** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:319` **notification** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:487` **posterUrl** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:718` **map marker** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:723` **map marker** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:727` **map marker** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:730` **map marker** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:735` **map marker** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:796` **profile grid** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:799` **profile grid** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:832` **profile grid** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:835` **profile grid** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:845` **profile grid** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:850` **profile grid** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:1334` **notification** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:1338` **notification** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:1342` **notification** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:1349` **notification** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:1354` **notification** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:1368` **notification** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:1373` **notification** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:1377` **notification** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:1432` **notification** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:1447` **notification** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:1652` **posterUrl** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:1654` **posterUrl** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:1655` **posterUrl** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:1719` **posterUrl** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:1760` **posterUrl** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:1761` **videoUrl** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:1762` **posterUrl** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:1786` **profile grid** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:1919` **notification** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:1922` **notification** — unknown
- `Locava Backendv2/scripts/debug-real-user-v2-semantics.mts:1923` **notification** — unknown
- `Locava Backendv2/scripts/debug-reels-feed-parity.mts:65` **posterUrl** — unknown
- `Locava Backendv2/scripts/debug-reels-feed-parity.mts:66` **posterUrl** — unknown
- `Locava Backendv2/scripts/debug-reels-feed-parity.mts:67` **posterUrl** — unknown
- `Locava Backendv2/scripts/debug-reels-feed-parity.mts:86` **posterUrl** — unknown
- `Locava Backendv2/scripts/debug-video-variant-selection.mts:56` **post.assets** — unknown
- `Locava Backendv2/scripts/debug-video-variant-selection.mts:58` **fallbackVideoUrl** — unknown
- `Locava Backendv2/scripts/health-native-session-sim.mts:522` **post.assets** — unknown
- `Locava Backendv2/scripts/notifications-parity-validation.mts:2` **notification** — unknown
- `Locava Backendv2/scripts/notifications-push-test.mts:2` **notification** — unknown
- `Locava Backendv2/scripts/notifications-push-test.mts:84` **notification** — unknown
- `Locava Backendv2/scripts/notifications-push-test.mts:144` **imageUrl** — unknown
- `Locava Backendv2/scripts/parity-validation.mts:50` **notification** — unknown
- `Locava Backendv2/scripts/parity-validation.mts:51` **notification** — unknown
- `Locava Backendv2/scripts/parity-validation.mts:125` **thumbUrl** — unknown
- `Locava Backendv2/scripts/parity-validation.mts:215` **posterUrl** — unknown
- `Locava Backendv2/scripts/repair-video-playback-faststart.mts:25` **post.assets** — unknown
- `Locava Backendv2/scripts/repair-video-playback-faststart.mts:72` **post.assets** — unknown
- `Locava Backendv2/scripts/seed-inbox-notifications.mts:3` **notification** — unknown
- `Locava Backendv2/scripts/seed-inbox-notifications.mts:155` **notification** — unknown
- `Locava Backendv2/scripts/verify-post-schema-parity.mts:122` **post.assets** — unknown
- `Locava Backendv2/scripts/verify-post-schema-parity.mts:152` **photoLink** — unknown
- `Locava Backendv2/scripts/verify-post-schema-parity.mts:152` **photoLinks2** — unknown
- `Locava Backendv2/scripts/verify-post-schema-parity.mts:152` **photoLinks3** — unknown
- `Locava Backendv2/src/cache/entity-invalidation.ts:75` **notification** — unknown
- `Locava Backendv2/src/cache/entity-invalidation.ts:79` **notification** — unknown
- `Locava Backendv2/src/cache/entity-invalidation.ts:83` **notification** — unknown
- `Locava Backendv2/src/cache/entity-invalidation.ts:352` **notification** — unknown
- `Locava Backendv2/src/cache/entity-invalidation.ts:353` **notification** — unknown
- `Locava Backendv2/src/cache/entity-invalidation.ts:354` **notification** — unknown
- `Locava Backendv2/src/contracts/master-post-v2.types.ts:29` **posterUrl** — unknown
- `Locava Backendv2/src/contracts/master-post-v2.types.ts:65` **media.assets** — unknown
- `Locava Backendv2/src/contracts/master-post-v2.types.ts:154` **thumbUrl** — unknown
- `Locava Backendv2/src/contracts/master-post-v2.types.ts:155` **posterUrl** — unknown
- `Locava Backendv2/src/contracts/master-post-v2.types.ts:176` **photoLink** — unknown
- `Locava Backendv2/src/contracts/master-post-v2.types.ts:177` **photoLinks2** — unknown
- `Locava Backendv2/src/contracts/master-post-v2.types.ts:178` **photoLinks3** — unknown
- `Locava Backendv2/src/contracts/master-post-v2.types.ts:179` **displayPhotoLink** — unknown
- `Locava Backendv2/src/contracts/master-post-v2.types.ts:180` **thumbUrl** — unknown
- `Locava Backendv2/src/contracts/master-post-v2.types.ts:181` **posterUrl** — unknown
- `Locava Backendv2/src/contracts/master-post-v2.types.ts:182` **fallbackVideoUrl** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:41` **posterUrl** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:55` **displayPhotoLink** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:56` **photoLink** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:138` **photoLink** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:139` **photoLink** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:140` **photoLinks2** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:141` **photoLinks2** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:142` **photoLinks3** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:143` **photoLinks3** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:235` **posterUrl** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:255` **posterUrl** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:329` **posterUrl** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:332` **posterUrl** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:334` **displayPhotoLink** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:335` **thumbUrl** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:359` **posterUrl** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:389` **posterUrl** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:428` **photoLink** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:428` **displayPhotoLink** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:428` **thumbUrl** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:431` **photoLink** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:431` **displayPhotoLink** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:431` **thumbUrl** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:440` **posterUrl** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:442` **displayPhotoLink** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:443` **thumbUrl** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:459` **posterUrl** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:487` **photoLink** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:487` **displayPhotoLink** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:487` **thumbUrl** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:489` **displayPhotoLink** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:489` **thumbUrl** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:492` **photoLink** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:496` **displayPhotoLink** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:496` **posterUrl** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:497` **photoLink** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:497` **displayPhotoLink** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:518` **displayPhotoLink** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:519` **photoLink** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:556` **posterUrl** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:563` **posterUrl** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:564` **posterUrl** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:565` **posterUrl** — unknown
- `Locava Backendv2/src/contracts/post-assets.contract.ts:576` **posterUrl** — unknown
- `Locava Backendv2/src/contracts/surfaces/achievements-leaderboard-ack.contract.ts:17` **notification** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/diffMasterPostPreview.ts:20` **media.assets** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:459` **fallbackVideoUrl** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:565` **media.assets** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:569` **media.assets** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:593` **posterUrl** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:598` **posterUrl** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:601` **displayPhotoLink** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:676` **photoLink** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:677` **photoLinks2** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:678` **photoLinks3** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:680` **fallbackVideoUrl** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:681` **posterUrl** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:683` **thumbUrl** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:684` **displayPhotoLink** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:685` **photoLink** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:686` **photoLinks2** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:687` **photoLinks3** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:692` **photoLinks2** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:693` **photoLinks3** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:694` **photoLinks2** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:695` **photoLinks3** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:713` **posterUrl** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:798` **displayPhotoLink** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:798` **posterUrl** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:865` **posterUrl** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:866` **posterUrl** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:867` **posterUrl** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:1050` **thumbUrl** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:1051` **posterUrl** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:1078` **photoLink** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:1079` **photoLinks2** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:1080` **photoLinks3** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:1081` **displayPhotoLink** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:1082` **thumbUrl** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:1083` **posterUrl** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:1084` **fallbackVideoUrl** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:1091` **photoLink** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:1092` **photoLinks2** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:1093` **photoLinks3** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:1094` **displayPhotoLink** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:1095` **fallbackVideoUrl** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:1161` **media.assets** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:1166` **media.assets** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts:1168` **media.assets** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/validateMasterPostV2.ts:144` **media.assets** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/validateMasterPostV2.ts:147` **media.assets** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/validateMasterPostV2.ts:155` **media.assets** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/validateMasterPostV2.ts:160` **media.assets** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/validateMasterPostV2.ts:175` **media.assets** — unknown
- `Locava Backendv2/src/lib/posts/master-post-v2/validateMasterPostV2.ts:185` **media.assets** — unknown

… 756 more …

## Full hit listing


### Locava Backendv2/scripts/audit-native-action-coverage.mts

| L17 | notification | unknown | `\| "notification"` |
| L300 | profile grid | unknown | `screen: "Profile grid",` |
| L303 | profile grid | unknown | `visualBehavior: "Page the profile grid without stale or duplicated posts.",` |
| L572 | notification | unknown | `screen: "Mark notification read",` |
| L598 | notification | unknown | `screen: "Notification tap / deeplink",` |
| L600 | notification | unknown | `userAction: "Tap a notification target",` |
| L700 | profile grid | unknown | `visualBehavior: "Show the new post in the profile grid without manual refresh hacks.",` |
| L775 | notification | unknown | `userAction: "Open an invalid post or notification deeplink",` |
| L1139 | notification | unknown | `if (/notification/i.test(fileText)) triggers.add("notification");` |
| L1589 | notification | unknown | `inventoryLines.push("- Exhaustive static scan of Native-side backend-triggering actions, handler entrypoints, refresh/pagination paths, and deep-link/notification-adjacent data fetches.");` |

### Locava Backendv2/scripts/audits/app-post-v2-grep-inventory.mts

| L18 | photoLink | migrated_appPostV2 | `{ label: "photoLink", re: /\bphotoLink\b/g },` |
| L19 | photoLinks2 | migrated_appPostV2 | `{ label: "photoLinks2", re: /\bphotoLinks2\b/g },` |
| L20 | photoLinks3 | migrated_appPostV2 | `{ label: "photoLinks3", re: /\bphotoLinks3\b/g },` |
| L21 | displayPhotoLink | migrated_appPostV2 | `{ label: "displayPhotoLink", re: /\bdisplayPhotoLink\b/g },` |
| L22 | fallbackVideoUrl | migrated_appPostV2 | `{ label: "fallbackVideoUrl", re: /\bfallbackVideoUrl\b/g },` |
| L23 | thumbUrl | migrated_appPostV2 | `{ label: "thumbUrl", re: /\bthumbUrl\b/g },` |
| L24 | posterUrl | migrated_appPostV2 | `{ label: "posterUrl", re: /\bposterUrl\b/g },` |
| L25 | assets[0] | migrated_appPostV2 | `{ label: "assets[0]", re: /assets\s*\[\s*0\s*\]/g },` |
| L26 | post.assets | migrated_appPostV2 | `{ label: "post.assets", re: /\bpost\.assets\b/g },` |
| L27 | media.assets | migrated_appPostV2 | `{ label: "media.assets", re: /\bmedia\.assets\b/g },` |
| L28 | imageUrl | migrated_appPostV2 | `{ label: "imageUrl", re: /\bimageUrl\b/g },` |
| L29 | videoUrl | migrated_appPostV2 | `{ label: "videoUrl", re: /\bvideoUrl\b/g },` |
| L30 | mediaItems | migrated_appPostV2 | `{ label: "mediaItems", re: /\bmediaItems\b/g },` |
| L31 | sharedPost | migrated_appPostV2 | `{ label: "sharedPost", re: /\bsharedPost\b/g },` |
| L32 | postPreview | migrated_appPostV2 | `{ label: "postPreview", re: /\bpostPreview\b/g },` |
| L33 | notification | migrated_appPostV2 | `{ label: "notification", re: /\bnotification\b/gi },` |
| L34 | MessageBubble | migrated_appPostV2 | `{ label: "MessageBubble", re: /\bMessageBubble\b/g },` |
| L35 | LiftableViewerHost | migrated_appPostV2 | `{ label: "LiftableViewerHost", re: /\bLiftableViewerHost\b/g },` |
| L36 | AssetCarouselOnly | migrated_appPostV2 | `{ label: "AssetCarouselOnly", re: /\bAssetCarouselOnly\b/g },` |
| L37 | PostTile | migrated_appPostV2 | `{ label: "PostTile", re: /\bPostTile\b/g },` |
| L38 | EnhancedMediaContent | migrated_appPostV2 | `{ label: "EnhancedMediaContent", re: /\bEnhancedMediaContent\b/g },` |
| L39 | map marker | migrated_appPostV2 | `{ label: "map marker", re: /\bmap\s+marker\b/gi },` |
| L40 | profile grid | migrated_appPostV2 | `{ label: "profile grid", re: /\bprofile\s+grid\b/gi },` |
| L41 | collection post | migrated_appPostV2 | `{ label: "collection post", re: /\bcollection\s+post\b/gi },` |
| L42 | search result | migrated_appPostV2 | `{ label: "search result", re: /\bsearch\s+result\b/gi }` |
| L102 | photoLink | compatibility_alias_only | `if (l.includes("compatibility") \|\| l.includes("photoLink") && l.includes("z.")) return "compatibility_alias_only";` |
| L112 | displayPhotoLink | compatibility_alias_only | `if (l.includes("compatibility.") && (term.startsWith("photo") \|\| term === "displayPhotoLink")) return "compatibility_alias_only";` |
| L115 | notification | compatibility_alias_only | `if (term === "notification" && l.includes("routeName")) return "compatibility_alias_only";` |
| L126 | thumbUrl | migrated_appPostV2 | `if (term === "thumbUrl" && l.includes("preview")) return "needs_migration";` |
| L132 | photoLink | migrated_appPostV2 | `if (["photoLink", "displayPhotoLink", "assets[0]", "post.assets", "thumbUrl", "videoUrl"].includes(term)) return "needs_migration";` |
| L132 | displayPhotoLink | migrated_appPostV2 | `if (["photoLink", "displayPhotoLink", "assets[0]", "post.assets", "thumbUrl", "videoUrl"].includes(term)) return "needs_migration";` |
| L132 | thumbUrl | migrated_appPostV2 | `if (["photoLink", "displayPhotoLink", "assets[0]", "post.assets", "thumbUrl", "videoUrl"].includes(term)) return "needs_migration";` |
| L132 | assets[0] | migrated_appPostV2 | `if (["photoLink", "displayPhotoLink", "assets[0]", "post.assets", "thumbUrl", "videoUrl"].includes(term)) return "needs_migration";` |
| L132 | post.assets | migrated_appPostV2 | `if (["photoLink", "displayPhotoLink", "assets[0]", "post.assets", "thumbUrl", "videoUrl"].includes(term)) return "needs_migration";` |
| L132 | videoUrl | migrated_appPostV2 | `if (["photoLink", "displayPhotoLink", "assets[0]", "post.assets", "thumbUrl", "videoUrl"].includes(term)) return "needs_migration";` |

### Locava Backendv2/scripts/debug-backendv2-feed-native-only.mts

| L50 | posterUrl | unknown | `if (!postId \|\| !String(author.userId ?? "") \|\| !String(media.posterUrl ?? "")) {` |
| L68 | posterUrl | unknown | `firstMediaUrl: ((b.items[0]?.media as Record<string, unknown> \| undefined)?.posterUrl ?? null),` |

### Locava Backendv2/scripts/debug-feed-for-you-simple.mts

| L58 | thumbUrl | unknown | `thumbUrl: 'https://cdn.locava.test/posts/${postId}/thumb.jpg',` |
| L59 | displayPhotoLink | unknown | `displayPhotoLink: 'https://cdn.locava.test/posts/${postId}/display.jpg',` |

### Locava Backendv2/scripts/debug-firestore-access-probe.mts

| L93 | photoLink | unknown | `.select("time", "displayPhotoLink", "photoLink", "thumbUrl", "assets", "mediaType")` |
| L93 | displayPhotoLink | unknown | `.select("time", "displayPhotoLink", "photoLink", "thumbUrl", "assets", "mediaType")` |
| L93 | thumbUrl | unknown | `.select("time", "displayPhotoLink", "photoLink", "thumbUrl", "assets", "mediaType")` |

### Locava Backendv2/scripts/debug-full-app-v2-audit.mts

| L139 | displayPhotoLink | unknown | `displayPhotoLink: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=1200&q=80&auto=format&fit=crop",` |
| L140 | thumbUrl | unknown | `thumbUrl: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=400&q=80&auto=format&fit=crop",` |
| L141 | photoLink | unknown | `photoLink: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=1200&q=80&auto=format&fit=crop",` |
| L649 | profile grid | unknown | `nativeSurface: "Profile grid",` |

### Locava Backendv2/scripts/debug-logged-in-user-tabs.mts

| L52 | posterUrl | unknown | `posterUrl: string \| null;` |
| L53 | videoUrl | unknown | `videoUrl: string \| null;` |

### Locava Backendv2/scripts/debug-post-assets.mts

| L58 | displayPhotoLink | unknown | `displayPhotoLink: null,` |
| L66 | displayPhotoLink | unknown | `displayPhotoLink: "https://cdn.example/cover.webp",` |
| L99 | displayPhotoLink | unknown | `'displayPhotoLink(canonical)=${norm.displayPhotoLink}',` |

### Locava Backendv2/scripts/debug-post-detail-hydration.mts

| L48 | thumbUrl | unknown | `const required = ["postId", "userId", "caption", "createdAtMs", "thumbUrl", "assets"];` |

### Locava Backendv2/scripts/debug-real-user-v2-semantics.mts

| L58 | posterUrl | unknown | `posterUrl: string \| null;` |
| L59 | videoUrl | unknown | `videoUrl: string \| null;` |
| L142 | posterUrl | unknown | `posterUrl: null,` |
| L143 | videoUrl | unknown | `videoUrl: null,` |
| L319 | notification | unknown | `message: "Audit notification fixture",` |
| L487 | posterUrl | unknown | `if (!str(media.posterUrl) && !str(item.firstAssetUrl)) {` |
| L718 | map marker | unknown | `markerMismatches.push('map marker missing post ${postId ?? "<missing>"}');` |
| L723 | map marker | unknown | `if (lat == null \|\| lng == null) markerMismatches.push('map marker ${postId} missing lat/lng');` |
| L727 | map marker | unknown | `markerMismatches.push('map marker ${postId} lat does not match source post');` |
| L730 | map marker | unknown | `markerMismatches.push('map marker ${postId} lng does not match source post');` |
| L735 | map marker | unknown | `markerMismatches.push('map marker ${postId} activity ${markerActivity} does not match source activities ${sourceActivities.join(", ")}');` |
| L796 | profile grid | unknown | `mismatches.push('profile grid preview returned missing post ${postId ?? "<missing>"}');` |
| L799 | profile grid | unknown | `if (str(postDoc.userId) !== viewerId) mismatches.push('profile grid preview post ${postId} is owned by ${String(postDoc.userId ?? "")}');` |
| L832 | profile grid | unknown | `gridMismatches.push('profile grid returned missing post ${postId ?? "<missing>"}');` |
| L835 | profile grid | unknown | `if (str(postDoc.userId) !== viewerId) gridMismatches.push('profile grid returned foreign post ${postId}');` |
| L845 | profile grid | unknown | `if (overlap.length > 0) gridMismatches.push('profile grid next page duplicated ids ${overlap.join(", ")}');` |
| L850 | profile grid | unknown | `scenario: "PROFILE grid cursor works and only returns profile-owned posts",` |
| L1334 | notification | unknown | `return { ok: Boolean(actorId), docs, details: actorId ? [] : ["follow/contact notification missing actorId"] };` |
| L1338 | notification | unknown | `return { ok: Boolean(targetId), docs, details: targetId ? [] : ['notification ${type} missing post target'] };` |
| L1342 | notification | unknown | `if (!targetId \|\| !commentId) return { ok: false, docs, details: ["comment notification missing target post or commentId"] };` |
| L1349 | notification | unknown | `return { ok: Boolean(targetId), docs, details: targetId ? [] : ["collection notification missing collection target"] };` |
| L1354 | notification | unknown | `return { ok: Boolean(chatId), docs, details: chatId ? [] : ["chat notification missing chat target"] };` |
| L1368 | notification | unknown | `if (!doc) mismatches.push('notification ${notificationId} missing in Firestore');` |
| L1373 | notification | unknown | `if (!doc) mismatches.push('notification actor missing user ${actorId}');` |
| L1377 | notification | unknown | `mismatches.push('notification ${notificationId ?? "<unknown>"} returned placeholder avatar ${pic}');` |
| L1432 | notification | unknown | `: ['notification ${state.sampleUnreadNotificationId} is still unread in Firestore after mark-read'],` |
| L1447 | notification | unknown | `mismatchDetails: ["viewer did not have an unread notification to mark read"],` |
| L1652 | posterUrl | unknown | `const posterUrl = str(videoAsset?.poster) ?? str(obj(videoAsset?.variants).poster);` |
| L1654 | posterUrl | unknown | `const posterKey = urlToObjectKey(posterUrl);` |
| L1655 | posterUrl | unknown | `if (!originalUrl \|\| !posterUrl \|\| !originalKey \|\| !posterKey) {` |
| L1719 | posterUrl | unknown | `posterUrl,` |
| L1760 | posterUrl | unknown | `state.postingProbe.posterUrl = posterUrl;` |
| L1761 | videoUrl | unknown | `state.postingProbe.videoUrl = originalUrl;` |
| L1762 | posterUrl | unknown | `state.postingProbe.publicPosterImage = await probePublicUrl(posterUrl);` |
| L1786 | profile grid | unknown | `state.postingProbe.details.push('new post ${postId} was not visible in profile grid after finalize');` |
| L1919 | notification | unknown | `const resolution = route ? resolveNotificationExpectation(route) : { ok: false, docs: [], details: ["notification target doc missing"] };` |
| L1922 | notification | unknown | `nativeSurface: "Deep link: notification target",` |
| L1923 | notification | unknown | `scenario: "DEEP LINK notification target has enough data for Native route resolution",` |

### Locava Backendv2/scripts/debug-reels-feed-parity.mts

| L65 | posterUrl | unknown | `const posterUrl = String(media.posterUrl ?? "").trim();` |
| L66 | posterUrl | unknown | `if (!postId \|\| !userId \|\| !posterUrl) {` |
| L67 | posterUrl | unknown | `throw new Error('${label}:missing_required_fields postId=${postId} userId=${userId} poster=${posterUrl}');` |
| L86 | posterUrl | unknown | `firstMediaUrl: (first.media as Record<string, unknown> \| undefined)?.posterUrl ?? null,` |

### Locava Backendv2/scripts/debug-video-variant-selection.mts

| L56 | post.assets | unknown | `collectUrlsFromValue(post.assets, urls);` |
| L58 | fallbackVideoUrl | unknown | `if (typeof post.fallbackVideoUrl === "string") urls.add(post.fallbackVideoUrl);` |

### Locava Backendv2/scripts/health-native-session-sim.mts

| L522 | post.assets | unknown | `const assets = Array.isArray(post.assets) ? (post.assets as Array<Record<string, unknown>>) : [];` |

### Locava Backendv2/scripts/notifications-parity-validation.mts

| L2 | notification | unknown | `* Notification lifecycle + legacy compat checks against a running Backendv2 server.` |

### Locava Backendv2/scripts/notifications-push-test.mts

| L2 | notification | unknown | `* Sends test Expo push notifications for all known legacy notification types.` |
| L84 | notification | unknown | `{ type: "system", title: "Locava", body: "System notification test", data: { route: "/map" } },` |
| L144 | imageUrl | unknown | `(message.data as Record<string, string>).imageUrl = input.image;` |

### Locava Backendv2/scripts/parity-validation.mts

| L50 | notification | unknown | `assert(actor && typeof actor.userId === "string" && actor.userId.length > 0, "v2 notification actor.userId missing", notes);` |
| L51 | notification | unknown | `assert(typeof actor.handle === "string", "v2 notification actor.handle missing", notes);` |
| L125 | thumbUrl | unknown | `assert(typeof firstBootstrap.thumbUrl === "string", "search/bootstrap thumbUrl missing", notes);` |
| L215 | posterUrl | unknown | `assert(typeof media.posterUrl === "string", "v2 feed media.posterUrl missing", notes);` |

### Locava Backendv2/scripts/repair-video-playback-faststart.mts

| L25 | post.assets | unknown | `const assets = Array.isArray(post.assets) ? (post.assets as Record<string, unknown>[]) : [];` |
| L72 | post.assets | unknown | `const assets = Array.isArray(post.assets) ? (post.assets as Record<string, unknown>[]) : [];` |

### Locava Backendv2/scripts/seed-inbox-notifications.mts

| L3 | notification | unknown | `* Creates real notification rows + Expo pushes (same pipeline as production mutations)` |
| L155 | notification | unknown | `commentText: "[seed] Test comment notification — not a real comment.",` |

### Locava Backendv2/scripts/verify-post-schema-parity.mts

| L122 | post.assets | unknown | `const assets = Array.isArray(post.assets) ? (post.assets as Array<Record<string, unknown>>) : [];` |
| L152 | photoLink | unknown | `hasLegacyPhotoFields: Boolean(post.photoLink && post.photoLinks2 && post.photoLinks3)` |
| L152 | photoLinks2 | unknown | `hasLegacyPhotoFields: Boolean(post.photoLink && post.photoLinks2 && post.photoLinks3)` |
| L152 | photoLinks3 | unknown | `hasLegacyPhotoFields: Boolean(post.photoLink && post.photoLinks2 && post.photoLinks3)` |

### Locava Backendv2/src/cache/entity-invalidation.ts

| L75 | notification | unknown | `mutationType: "notification.create";` |
| L79 | notification | unknown | `mutationType: "notification.markread";` |
| L83 | notification | unknown | `mutationType: "notification.markallread";` |
| L352 | notification | unknown | `input.mutationType === "notification.create" \|\|` |
| L353 | notification | unknown | `input.mutationType === "notification.markread" \|\|` |
| L354 | notification | unknown | `input.mutationType === "notification.markallread"` |

### Locava Backendv2/src/contracts/app-post-v2.contract.ts

| L74 | posterUrl | migrated_appPostV2 | `posterUrl: string \| null;` |
| L115 | thumbUrl | migrated_appPostV2 | `thumbUrl: string \| null;` |
| L116 | posterUrl | migrated_appPostV2 | `posterUrl: string \| null;` |
| L238 | photoLink | migrated_appPostV2 | `photoLink: string \| null;` |
| L239 | photoLinks2 | migrated_appPostV2 | `photoLinks2: string \| null;` |
| L240 | photoLinks3 | migrated_appPostV2 | `photoLinks3: string \| null;` |
| L241 | displayPhotoLink | migrated_appPostV2 | `displayPhotoLink: string \| null;` |
| L242 | thumbUrl | migrated_appPostV2 | `thumbUrl: string \| null;` |
| L243 | posterUrl | migrated_appPostV2 | `posterUrl: string \| null;` |
| L244 | fallbackVideoUrl | migrated_appPostV2 | `fallbackVideoUrl: string \| null;` |

### Locava Backendv2/src/contracts/entities/achievement-entities.contract.ts

| L237 | imageUrl | compatibility_alias_only | `imageUrl: z.string().optional()` |
| L337 | imageUrl | compatibility_alias_only | `imageUrl: z.string().nullable().optional(),` |

### Locava Backendv2/src/contracts/entities/map-entities.contract.ts

| L8 | thumbUrl | compatibility_alias_only | `thumbUrl: z.string().url().nullable(),` |

### Locava Backendv2/src/contracts/entities/notification-entities.contract.ts

| L28 | thumbUrl | compatibility_alias_only | `thumbUrl: z.string().url().nullable()` |

### Locava Backendv2/src/contracts/entities/post-entities.contract.test.ts

| L13 | posterUrl | test_fixture | `media: { type: "image", posterUrl: "https://example.com/p.webp", aspectRatio: 0.75, startupHint: "poster_only" },` |
| L32 | thumbUrl | test_fixture | `thumbUrl: "https://example.com/p.webp",` |

### Locava Backendv2/src/contracts/entities/post-entities.contract.ts

| L37 | posterUrl | compatibility_alias_only | `posterUrl: z.string().url(),` |
| L52 | posterUrl | compatibility_alias_only | `posterUrl: z.string().nullable().optional(),` |
| L128 | posterUrl | compatibility_alias_only | `posterUrl: z.string().url().nullable(),` |
| L179 | posterUrl | compatibility_alias_only | `posterUrl: z.string().url().optional(),` |
| L183 | fallbackVideoUrl | compatibility_alias_only | `fallbackVideoUrl: z.string().url().optional(),` |
| L223 | thumbUrl | compatibility_alias_only | `thumbUrl: z.string().url(),` |
| L245 | posterUrl | compatibility_alias_only | `posterUrl: z.string().url().optional(),` |
| L249 | fallbackVideoUrl | compatibility_alias_only | `fallbackVideoUrl: z.string().url().optional(),` |

### Locava Backendv2/src/contracts/master-post-v2.types.ts

| L29 | posterUrl | unknown | `posterUrl: string \| null;` |
| L65 | media.assets | unknown | `kind: "assets" \| "media.assets" \| "legacy";` |
| L154 | thumbUrl | unknown | `thumbUrl: string \| null;` |
| L155 | posterUrl | unknown | `posterUrl: string \| null;` |
| L176 | photoLink | unknown | `photoLink: string \| null;` |
| L177 | photoLinks2 | unknown | `photoLinks2: string \| null;` |
| L178 | photoLinks3 | unknown | `photoLinks3: string \| null;` |
| L179 | displayPhotoLink | unknown | `displayPhotoLink: string \| null;` |
| L180 | thumbUrl | unknown | `thumbUrl: string \| null;` |
| L181 | posterUrl | unknown | `posterUrl: string \| null;` |
| L182 | fallbackVideoUrl | unknown | `fallbackVideoUrl: string \| null;` |

### Locava Backendv2/src/contracts/post-assets.contract.test.ts

| L52 | displayPhotoLink | test_fixture | `expect(r.displayPhotoLink?.length).toBeGreaterThan(0);` |
| L53 | photoLink | test_fixture | `expect(r.photoLink).toContain("webp");` |
| L60 | displayPhotoLink | test_fixture | `displayPhotoLink: "https://cdn.example/poster.jpg",` |
| L77 | assets[0] | test_fixture | `const asset0 = r.assets[0];` |
| L86 | photoLinks2 | test_fixture | `it("legacy photoLinks2/photoLinks3 comma lists merge and dedupe", () => {` |
| L86 | photoLinks3 | test_fixture | `it("legacy photoLinks2/photoLinks3 comma lists merge and dedupe", () => {` |
| L90 | photoLinks2 | test_fixture | `photoLinks2: "https://a.jpg,https://b.jpg",` |
| L91 | photoLinks3 | test_fixture | `photoLinks3: "https://a.jpg,,https://c.jpg",` |
| L102 | photoLink | test_fixture | `it("legacy single photoLink with empty photoLinks2/3 yields one asset", () => {` |
| L102 | photoLinks2 | test_fixture | `it("legacy single photoLink with empty photoLinks2/3 yields one asset", () => {` |
| L105 | photoLink | test_fixture | `photoLink: "https://one.jpg",` |
| L106 | photoLinks2 | test_fixture | `photoLinks2: "",` |
| L107 | photoLinks3 | test_fixture | `photoLinks3: "",` |
| L108 | photoLinks2 | test_fixture | `legacy: { photoLinks2: "", photoLinks3: "" },` |
| L108 | photoLinks3 | test_fixture | `legacy: { photoLinks2: "", photoLinks3: "" },` |
| L131 | displayPhotoLink | test_fixture | `displayPhotoLink: "https://cover.jpg",` |

### Locava Backendv2/src/contracts/post-assets.contract.ts

| L41 | posterUrl | unknown | `posterUrl?: string;` |
| L55 | displayPhotoLink | unknown | `displayPhotoLink: string \| null;` |
| L56 | photoLink | unknown | `photoLink: string \| null;` |
| L138 | photoLink | unknown | `...commaSplitUrls(source.photoLink),` |
| L139 | photoLink | unknown | `...commaSplitUrls(legacy.photoLink),` |
| L140 | photoLinks2 | unknown | `...commaSplitUrls(source.photoLinks2),` |
| L141 | photoLinks2 | unknown | `...commaSplitUrls(legacy.photoLinks2),` |
| L142 | photoLinks3 | unknown | `...commaSplitUrls(source.photoLinks3),` |
| L143 | photoLinks3 | unknown | `...commaSplitUrls(legacy.photoLinks3),` |
| L235 | posterUrl | unknown | `asset.posterUrl,` |
| L255 | posterUrl | unknown | `? pickString(a.posterUri, a.posterUrl, a.playback?.poster) ?? ""` |
| L329 | posterUrl | unknown | `asset.posterUrl,` |
| L332 | posterUrl | unknown | `index === 0 ? source.posterUrl : undefined,` |
| L334 | displayPhotoLink | unknown | `index === 0 ? source.displayPhotoLink : undefined,` |
| L335 | thumbUrl | unknown | `index === 0 ? source.thumbUrl : undefined,` |
| L359 | posterUrl | unknown | `posterUrl: posterFallback ?? undefined,` |
| L389 | posterUrl | unknown | `posterUrl: posterUri,` |
| L428 | photoLink | unknown | `} else if (urls.length === 1 \|\| pickString(source.displayPhotoLink, source.thumbUrl, source.photoLink)) {` |
| L428 | displayPhotoLink | unknown | `} else if (urls.length === 1 \|\| pickString(source.displayPhotoLink, source.thumbUrl, source.photoLink)) {` |
| L428 | thumbUrl | unknown | `} else if (urls.length === 1 \|\| pickString(source.displayPhotoLink, source.thumbUrl, source.photoLink)) {` |
| L431 | photoLink | unknown | `pickString(source.displayPhotoLink, source.photoLink, source.thumbUrl) ??` |
| L431 | displayPhotoLink | unknown | `pickString(source.displayPhotoLink, source.photoLink, source.thumbUrl) ??` |
| L431 | thumbUrl | unknown | `pickString(source.displayPhotoLink, source.photoLink, source.thumbUrl) ??` |
| L440 | posterUrl | unknown | `source.posterUrl,` |
| L442 | displayPhotoLink | unknown | `source.displayPhotoLink,` |
| L443 | thumbUrl | unknown | `source.thumbUrl,` |
| L459 | posterUrl | unknown | `posterUrl: posterUri,` |
| L487 | photoLink | unknown | `: pickString(source.displayPhotoLink, source.thumbUrl, source.photoLink) ?? "";` |
| L487 | displayPhotoLink | unknown | `: pickString(source.displayPhotoLink, source.thumbUrl, source.photoLink) ?? "";` |
| L487 | thumbUrl | unknown | `: pickString(source.displayPhotoLink, source.thumbUrl, source.photoLink) ?? "";` |
| L489 | displayPhotoLink | unknown | `const displayPhotoLink = pickString(source.displayPhotoLink, coverImage, source.thumbUrl) ?? coverImage ?? null;` |
| L489 | thumbUrl | unknown | `const displayPhotoLink = pickString(source.displayPhotoLink, coverImage, source.thumbUrl) ?? coverImage ?? null;` |
| L492 | photoLink | unknown | `let photoLink: string \| null =` |
| L496 | displayPhotoLink | unknown | `? head.posterUri ?? head.posterUrl ?? displayPhotoLink` |
| L496 | posterUrl | unknown | `? head.posterUri ?? head.posterUrl ?? displayPhotoLink` |
| L497 | photoLink | unknown | `: pickString(source.photoLink, displayPhotoLink) ?? displayPhotoLink;` |
| L497 | displayPhotoLink | unknown | `: pickString(source.photoLink, displayPhotoLink) ?? displayPhotoLink;` |
| L518 | displayPhotoLink | unknown | `displayPhotoLink: displayPhotoLink ? displayPhotoLink : null,` |
| L519 | photoLink | unknown | `photoLink,` |
| L556 | posterUrl | unknown | `posterUri: a.posterUri ?? a.posterUrl ?? null,` |
| L563 | posterUrl | unknown | `posterUrl: a.posterUri ?? a.posterUrl ?? playback?.poster ?? null,` |
| L564 | posterUrl | unknown | `poster: a.posterUri ?? a.posterUrl ?? playback?.poster ?? null,` |
| L565 | posterUrl | unknown | `thumbnail: a.posterUri ?? a.posterUrl ?? playback?.poster ?? null,` |
| L576 | posterUrl | unknown | `posterUrl: a.posterUri ?? a.displayUri ?? null,` |

### Locava Backendv2/src/contracts/surfaces/achievements-leaderboard-ack.contract.ts

| L17 | notification | unknown | `// invalidation: leaderboard ack updates viewer-specific notification/read state for achievements surfaces.` |

### Locava Backendv2/src/contracts/surfaces/notifications-list.contract.ts

| L3 | notification | compatibility_alias_only | `import { NotificationSummarySchema } from "../entities/notification-entities.contract.js";` |

### Locava Backendv2/src/contracts/surfaces/posting-finalize.contract.ts

| L26 | posterUrl | compatibility_alias_only | `posterUrl: z.string().url().optional()` |
| L67 | posterUrl | compatibility_alias_only | `posterUrl: z.string().url().optional(),` |
| L71 | fallbackVideoUrl | compatibility_alias_only | `fallbackVideoUrl: z.string().url().optional(),` |

### Locava Backendv2/src/contracts/surfaces/posting-staging-presign.contract.ts

| L32 | posterUrl | compatibility_alias_only | `posterUrl: z.string().url().optional(),` |

### Locava Backendv2/src/contracts/surfaces/posts-media-sign-upload.contract.ts

| L31 | posterUrl | compatibility_alias_only | `posterUrl: z.string().url().optional()` |

### Locava Backendv2/src/contracts/surfaces/profile-bootstrap.contract.ts

| L15 | thumbUrl | compatibility_alias_only | `thumbUrl: z.string().url(),` |

### Locava Backendv2/src/contracts/surfaces/profile-post-detail.contract.ts

| L52 | thumbUrl | compatibility_alias_only | `thumbUrl: z.string().url(),` |
| L61 | posterUrl | compatibility_alias_only | `posterUrl: z.string().url().optional(),` |
| L65 | fallbackVideoUrl | compatibility_alias_only | `fallbackVideoUrl: z.string().url().optional(),` |
| L90 | posterUrl | compatibility_alias_only | `posterUrl: z.string().url().optional(),` |
| L94 | fallbackVideoUrl | compatibility_alias_only | `fallbackVideoUrl: z.string().url().optional(),` |

### Locava Backendv2/src/contracts/surfaces/search-bootstrap.contract.ts

| L8 | thumbUrl | compatibility_alias_only | `thumbUrl: z.string(),` |
| L9 | displayPhotoLink | compatibility_alias_only | `displayPhotoLink: z.string(),` |

### Locava Backendv2/src/contracts/v2/mixes.contract.ts

| L46 | posterUrl | compatibility_alias_only | `posterUrl: z.string(),` |
| L57 | posterUrl | compatibility_alias_only | `posterUrl: z.string().nullable().optional(),` |
| L73 | fallbackVideoUrl | compatibility_alias_only | `fallbackVideoUrl: z.string().nullable().optional(),` |
| L74 | posterUrl | compatibility_alias_only | `posterUrl: z.string().nullable().optional(),` |

### Locava Backendv2/src/debug/search-firestore-truth-seeded.test.ts

| L27 | photoLink | test_fixture | `const direct = String(doc.thumbUrl ?? doc.displayPhotoLink ?? doc.photoLink ?? "").trim();` |
| L27 | displayPhotoLink | test_fixture | `const direct = String(doc.thumbUrl ?? doc.displayPhotoLink ?? doc.photoLink ?? "").trim();` |
| L27 | thumbUrl | test_fixture | `const direct = String(doc.thumbUrl ?? doc.displayPhotoLink ?? doc.photoLink ?? "").trim();` |
| L30 | assets[0] | test_fixture | `if (!Array.isArray(assets) \|\| assets.length === 0 \|\| typeof assets[0] !== "object" \|\| !assets[0]) return false;` |
| L31 | assets[0] | test_fixture | `const a0 = assets[0] as Record<string, unknown>;` |

### Locava Backendv2/src/debug/search-truth-harness.test.ts

| L20 | photoLink | test_fixture | `const direct = String(row.thumbUrl ?? row.displayPhotoLink ?? row.photoLink ?? "").trim();` |
| L20 | displayPhotoLink | test_fixture | `const direct = String(row.thumbUrl ?? row.displayPhotoLink ?? row.photoLink ?? "").trim();` |
| L20 | thumbUrl | test_fixture | `const direct = String(row.thumbUrl ?? row.displayPhotoLink ?? row.photoLink ?? "").trim();` |
| L23 | assets[0] | test_fixture | `if (Array.isArray(assets) && assets[0] && typeof assets[0] === "object") {` |
| L24 | assets[0] | test_fixture | `const a0 = assets[0] as Record<string, unknown>;` |

### Locava Backendv2/src/dto/compact-surface-dto.test.ts

| L39 | posterUrl | test_fixture | `posterUrl: "https://cdn.locava.test/post-1/poster.jpg",` |
| L57 | posterUrl | test_fixture | `posterUrl: "https://cdn.locava.test/post-1/poster.jpg",` |
| L91 | posterUrl | test_fixture | `"posterUrl": "https://cdn.locava.test/post-1/poster.jpg",` |
| L105 | posterUrl | test_fixture | `"posterUrl": null,` |
| L135 | posterUrl | test_fixture | `"posterUrl": "https://cdn.locava.test/post-1/poster.jpg",` |
| L180 | posterUrl | test_fixture | `posterUrl: null,` |
| L188 | posterUrl | test_fixture | `posterUrl: null,` |
| L196 | posterUrl | test_fixture | `posterUrl: null,` |
| L204 | posterUrl | test_fixture | `posterUrl: "https://cdn.test/a_md.webp",` |
| L291 | posterUrl | test_fixture | `"posterUrl": "https://cdn.locava.test/post-1/poster.jpg",` |
| L305 | posterUrl | test_fixture | `"posterUrl": null,` |
| L335 | posterUrl | test_fixture | `"posterUrl": "https://cdn.locava.test/post-1/poster.jpg",` |
| L357 | thumbUrl | test_fixture | `"thumbUrl": "https://cdn.locava.test/post-1/poster.jpg",` |
| L444 | posterUrl | test_fixture | `posterUrl: "https://cdn/1.jpg",` |
| L455 | posterUrl | test_fixture | `media: { type: "image", posterUrl: "https://cdn/1.jpg", aspectRatio: 1, startupHint: "poster_only" },` |

### Locava Backendv2/src/dto/compact-surface-dto.ts

| L10 | posterUrl | migrated_appPostV2 | `posterUrl?: string \| null;` |
| L62 | posterUrl | migrated_appPostV2 | `posterUrl: string;` |
| L82 | fallbackVideoUrl | migrated_appPostV2 | `fallbackVideoUrl?: string \| null;` |
| L83 | posterUrl | migrated_appPostV2 | `posterUrl?: string \| null;` |
| L96 | photoLink | migrated_appPostV2 | `photoLink?: string \| null;` |
| L97 | displayPhotoLink | migrated_appPostV2 | `displayPhotoLink?: string \| null;` |
| L136 | posterUrl | migrated_appPostV2 | `posterUrl: string \| null;` |
| L152 | posterUrl | migrated_appPostV2 | `posterUrl: string;` |
| L172 | fallbackVideoUrl | migrated_appPostV2 | `fallbackVideoUrl?: string \| null;` |
| L173 | posterUrl | migrated_appPostV2 | `posterUrl?: string \| null;` |
| L186 | photoLink | migrated_appPostV2 | `photoLink?: string \| null;` |
| L187 | displayPhotoLink | migrated_appPostV2 | `displayPhotoLink?: string \| null;` |
| L208 | thumbUrl | migrated_appPostV2 | `thumbUrl: string;` |
| L216 | photoLink | migrated_appPostV2 | `photoLink?: string \| null;` |
| L217 | displayPhotoLink | migrated_appPostV2 | `displayPhotoLink?: string \| null;` |
| L344 | posterUrl | migrated_appPostV2 | `posterUrl: cleanString(asset.posterUrl),` |
| L414 | posterUrl | migrated_appPostV2 | `posterUrl: poster,` |
| L473 | posterUrl | migrated_appPostV2 | `poster: a.posterUrl,` |
| L493 | thumbUrl | migrated_appPostV2 | `thumbUrl: seed.media.posterUrl,` |
| L493 | posterUrl | migrated_appPostV2 | `thumbUrl: seed.media.posterUrl,` |
| L494 | displayPhotoLink | migrated_appPostV2 | `displayPhotoLink: seed.media.posterUrl,` |
| L494 | posterUrl | migrated_appPostV2 | `displayPhotoLink: seed.media.posterUrl,` |
| L495 | photoLink | migrated_appPostV2 | `photoLink: seed.photoLink ?? seed.displayPhotoLink,` |
| L495 | displayPhotoLink | migrated_appPostV2 | `photoLink: seed.photoLink ?? seed.displayPhotoLink,` |
| L496 | photoLinks2 | migrated_appPostV2 | `photoLinks2: seed.playbackUrl ?? seed.fallbackVideoUrl,` |
| L496 | fallbackVideoUrl | migrated_appPostV2 | `photoLinks2: seed.playbackUrl ?? seed.fallbackVideoUrl,` |
| L497 | fallbackVideoUrl | migrated_appPostV2 | `fallbackVideoUrl: seed.fallbackVideoUrl,` |
| L544 | assets[0] | migrated_appPostV2 | `const firstAsset = assets[0];` |
| L545 | posterUrl | migrated_appPostV2 | `const posterUrl = cleanString(seed.media.posterUrl) ?? firstAsset?.posterUrl ?? "";` |
| L588 | posterUrl | migrated_appPostV2 | `firstAssetUrl: cleanString(seed.firstAssetUrl) ?? firstAsset?.originalUrl ?? firstAsset?.previewUrl ?? posterUrl,` |
| L591 | posterUrl | migrated_appPostV2 | `posterUrl,` |
| L608 | fallbackVideoUrl | migrated_appPostV2 | `...(typeof seed.fallbackVideoUrl === "string" ? { fallbackVideoUrl: seed.fallbackVideoUrl } : {}),` |
| L609 | posterUrl | migrated_appPostV2 | `...(typeof seed.posterUrl === "string" ? { posterUrl: seed.posterUrl } : {}),` |
| L618 | photoLink | migrated_appPostV2 | `...(cleanString(seed.photoLink) != null ? { photoLink: cleanString(seed.photoLink) } : {}),` |
| L619 | displayPhotoLink | migrated_appPostV2 | `...(cleanString(seed.displayPhotoLink) != null ? { displayPhotoLink: cleanString(seed.displayPhotoLink) } : {}),` |
| L640 | posterUrl | migrated_appPostV2 | `const posterUrl = seed.card.media.posterUrl \|\| firstAsset?.posterUrl \|\| "";` |
| L646 | posterUrl | migrated_appPostV2 | `const thumb = asset.posterUrl \|\| posterUrl \|\| "";` |
| L657 | posterUrl | migrated_appPostV2 | `poster: asset.posterUrl \|\| thumb \|\| null,` |
| L658 | posterUrl | migrated_appPostV2 | `thumbnail: asset.posterUrl \|\| thumb \|\| null,` |
| L689 | posterUrl | migrated_appPostV2 | `poster: posterUrl \|\| null,` |
| L690 | posterUrl | migrated_appPostV2 | `thumbnail: posterUrl \|\| null,` |
| L721 | thumbUrl | migrated_appPostV2 | `thumbUrl: posterUrl,` |
| L721 | posterUrl | migrated_appPostV2 | `thumbUrl: posterUrl,` |
| L737 | photoLink | migrated_appPostV2 | `...(cleanString(seed.card.photoLink) != null ? { photoLink: cleanString(seed.card.photoLink) } : {}),` |
| L738 | displayPhotoLink | migrated_appPostV2 | `...(cleanString(seed.card.displayPhotoLink) != null ? { displayPhotoLink: cleanString(seed.card.displayPhotoLink) } : {}),` |

### Locava Backendv2/src/lib/posts/app-post-v2/enrichAppPostV2Response.ts

| L94 | thumbUrl | migrated_appPostV2 | `thumbUrl: string;` |
| L95 | displayPhotoLink | migrated_appPostV2 | `displayPhotoLink: string;` |

### Locava Backendv2/src/lib/posts/app-post-v2/toAppPostV2.test.ts

| L71 | photoLinks2 | test_fixture | `photoLinks2:` |
| L73 | photoLinks3 | test_fixture | `photoLinks3:` |
| L76 | fallbackVideoUrl | test_fixture | `fallbackVideoUrl:` |
| L78 | photoLink | test_fixture | `photoLink: "https://img/poster.jpg",` |
| L79 | displayPhotoLink | test_fixture | `displayPhotoLink: "https://img/poster.jpg",` |
| L80 | thumbUrl | test_fixture | `thumbUrl: "https://img/poster-thumb.jpg"` |
| L84 | media.assets | test_fixture | `it("produces locava.appPost v2 with media.assets[], cover, compatibility aliases, and HQ primary playback", () => {` |
| L88 | media.assets | test_fixture | `expect(app.media.assets.length).toBe(1);` |
| L89 | posterUrl | test_fixture | `expect(app.media.cover.url ?? app.media.cover.posterUrl).toBeTruthy();` |
| L90 | assets[0] | test_fixture | `const v = app.media.assets[0];` |
| L90 | media.assets | test_fixture | `const v = app.media.assets[0];` |
| L98 | photoLink | test_fixture | `expect(app.compatibility.photoLink).toBeTruthy();` |
| L99 | displayPhotoLink | test_fixture | `expect(app.compatibility.displayPhotoLink).toBeTruthy();` |
| L127 | media.assets | test_fixture | `expect(app.media.assets.map((x) => x.id)).toEqual(["a1", "a2"]);` |
| L128 | media.assets | test_fixture | `const ids = app.media.assets.map((x) => x.id);` |
| L192 | media.assets | test_fixture | `expect(master.media.assets.length).toBe(app.media.assets.length);` |
| L203 | media.assets | test_fixture | `expect(row.mediaAssetCount).toBe(app.media.assets.length);` |
| L204 | media.assets | test_fixture | `expect(row.assetIds).toEqual(app.media.assets.map((a) => a.id));` |

### Locava Backendv2/src/lib/posts/app-post-v2/toAppPostV2.ts

| L137 | posterUrl | migrated_appPostV2 | `const poster = pickStr(video.posterUrl);` |
| L145 | posterUrl | migrated_appPostV2 | `posterUrl: poster,` |
| L219 | media.assets | migrated_appPostV2 | `assets: media.assets.map(mapAsset)` |
| L569 | photoLink | migrated_appPostV2 | `"photoLink" \| "displayPhotoLink" \| "thumbUrl" \| "posterUrl" \| "mediaType" \| "fallbackVideoUrl"` |
| L569 | displayPhotoLink | migrated_appPostV2 | `"photoLink" \| "displayPhotoLink" \| "thumbUrl" \| "posterUrl" \| "mediaType" \| "fallbackVideoUrl"` |
| L569 | fallbackVideoUrl | migrated_appPostV2 | `"photoLink" \| "displayPhotoLink" \| "thumbUrl" \| "posterUrl" \| "mediaType" \| "fallbackVideoUrl"` |
| L569 | thumbUrl | migrated_appPostV2 | `"photoLink" \| "displayPhotoLink" \| "thumbUrl" \| "posterUrl" \| "mediaType" \| "fallbackVideoUrl"` |
| L569 | posterUrl | migrated_appPostV2 | `"photoLink" \| "displayPhotoLink" \| "thumbUrl" \| "posterUrl" \| "mediaType" \| "fallbackVideoUrl"` |
| L594 | media.assets | migrated_appPostV2 | `if (!appPost.media.assets.length) warn.push("missing_media_assets");` |
| L595 | media.assets | migrated_appPostV2 | `const ids = appPost.media.assets.map((a) => a.id);` |
| L598 | media.assets | migrated_appPostV2 | `const firstVideo = appPost.media.assets.find((a): a is AppPostVideoAssetV2 => a.type === "video");` |
| L605 | thumbUrl | migrated_appPostV2 | `const coverUrl = media?.cover?.url ?? media?.cover?.thumbUrl ?? null;` |
| L615 | photoLink | migrated_appPostV2 | `photoLink: compat.photoLink,` |
| L616 | displayPhotoLink | migrated_appPostV2 | `displayPhotoLink: compat.displayPhotoLink,` |
| L617 | thumbUrl | migrated_appPostV2 | `thumbUrl: compat.thumbUrl,` |
| L618 | posterUrl | migrated_appPostV2 | `posterUrl: compat.posterUrl,` |
| L620 | fallbackVideoUrl | migrated_appPostV2 | `fallbackVideoUrl: compat.fallbackVideoUrl` |

### Locava Backendv2/src/lib/posts/master-post-v2/diffMasterPostPreview.test.ts

| L12 | photoLink | test_fixture | `photoLink: "https://legacy/x.jpg"` |
| L27 | photoLink | test_fixture | `expect(diff.compatibilityFieldsGenerated).toContain("photoLink");` |

### Locava Backendv2/src/lib/posts/master-post-v2/diffMasterPostPreview.ts

| L20 | media.assets | unknown | `const videoAssets = input.canonical.media.assets.filter((a) => a.type === "video");` |

### Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.test.ts

| L40 | photoLinks2 | test_fixture | `photoLinks2: "https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/preview360_avc.mp4",` |
| L41 | photoLinks3 | test_fixture | `photoLinks3: "https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/main720_avc.mp4"` |
| L43 | fallbackVideoUrl | test_fixture | `fallbackVideoUrl: "https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/original.mp4",` |
| L44 | photoLink | test_fixture | `photoLink: "https://img/poster.jpg",` |
| L45 | displayPhotoLink | test_fixture | `displayPhotoLink: "https://img/poster.jpg",` |
| L46 | thumbUrl | test_fixture | `thumbUrl: "https://img/poster-thumb.jpg"` |
| L63 | media.assets | test_fixture | `expect(result.canonical.media.assets.length).toBe(1);` |
| L65 | assets[0] | test_fixture | `expect(result.canonical.media.assets[0]?.type).toBe("video");` |
| L65 | media.assets | test_fixture | `expect(result.canonical.media.assets[0]?.type).toBe("video");` |
| L68 | assets[0] | test_fixture | `expect(result.canonical.media.assets[0]?.video?.playback.primaryUrl).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/upgrade1080_faststart_avc.` |
| L68 | media.assets | test_fixture | `expect(result.canonical.media.assets[0]?.video?.playback.primaryUrl).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/upgrade1080_faststart_avc.` |
| L69 | assets[0] | test_fixture | `expect(result.canonical.media.assets[0]?.video?.playback.defaultUrl).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/upgrade1080_faststart_avc.` |
| L69 | media.assets | test_fixture | `expect(result.canonical.media.assets[0]?.video?.playback.defaultUrl).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/upgrade1080_faststart_avc.` |
| L70 | assets[0] | test_fixture | `expect(result.canonical.media.assets[0]?.video?.playback.highQualityUrl).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/upgrade1080_faststart_` |
| L70 | media.assets | test_fixture | `expect(result.canonical.media.assets[0]?.video?.playback.highQualityUrl).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/upgrade1080_faststart_` |
| L71 | assets[0] | test_fixture | `expect(result.canonical.media.assets[0]?.video?.playback.startupUrl).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/startup720_faststart_avc.m` |
| L71 | media.assets | test_fixture | `expect(result.canonical.media.assets[0]?.video?.playback.startupUrl).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/startup720_faststart_avc.m` |
| L72 | assets[0] | test_fixture | `expect(result.canonical.media.assets[0]?.video?.playback.upgradeUrl).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/upgrade1080_faststart_avc.` |
| L72 | media.assets | test_fixture | `expect(result.canonical.media.assets[0]?.video?.playback.upgradeUrl).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/upgrade1080_faststart_avc.` |
| L73 | assets[0] | test_fixture | `expect(result.canonical.media.assets[0]?.video?.playback.previewUrl).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/preview360_avc.mp4");` |
| L73 | media.assets | test_fixture | `expect(result.canonical.media.assets[0]?.video?.playback.previewUrl).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/preview360_avc.mp4");` |
| L74 | assets[0] | test_fixture | `expect(result.canonical.media.assets[0]?.video?.playback.fallbackUrl).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/original.mp4");` |
| L74 | media.assets | test_fixture | `expect(result.canonical.media.assets[0]?.video?.playback.fallbackUrl).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/original.mp4");` |
| L75 | assets[0] | test_fixture | `expect(result.canonical.media.assets[0]?.video?.variants.preview360Avc).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/preview360_avc.mp4");` |
| L75 | media.assets | test_fixture | `expect(result.canonical.media.assets[0]?.video?.variants.preview360Avc).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/preview360_avc.mp4");` |
| L76 | assets[0] | test_fixture | `expect(result.canonical.media.assets[0]?.video?.variants.main720Avc).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/main720_avc.mp4");` |
| L76 | media.assets | test_fixture | `expect(result.canonical.media.assets[0]?.video?.variants.main720Avc).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/main720_avc.mp4");` |
| L77 | assets[0] | test_fixture | `expect(result.canonical.media.assets[0]?.video?.variants.upgrade1080Faststart).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/upgrade1080_fast` |
| L77 | media.assets | test_fixture | `expect(result.canonical.media.assets[0]?.video?.variants.upgrade1080Faststart).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/upgrade1080_fast` |
| L78 | assets[0] | test_fixture | `expect(result.canonical.media.assets[0]?.video?.variants.upgrade1080FaststartAvc).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/upgrade1080_f` |
| L78 | media.assets | test_fixture | `expect(result.canonical.media.assets[0]?.video?.variants.upgrade1080FaststartAvc).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/upgrade1080_f` |
| L79 | assets[0] | test_fixture | `expect(result.canonical.media.assets[0]?.video?.variants.main1080).toBeNull();` |
| L79 | media.assets | test_fixture | `expect(result.canonical.media.assets[0]?.video?.variants.main1080).toBeNull();` |
| L80 | assets[0] | test_fixture | `expect(result.canonical.media.assets[0]?.video?.variants.main1080Avc).toBeNull();` |
| L80 | media.assets | test_fixture | `expect(result.canonical.media.assets[0]?.video?.variants.main1080Avc).toBeNull();` |
| L81 | assets[0] | test_fixture | `expect(result.canonical.media.assets[0]?.video?.variants.hls).toBeNull();` |
| L81 | media.assets | test_fixture | `expect(result.canonical.media.assets[0]?.video?.variants.hls).toBeNull();` |
| L82 | assets[0] | test_fixture | `expect(result.canonical.media.assets[0]?.video?.variants.hlsAvcMaster).toBeNull();` |
| L82 | media.assets | test_fixture | `expect(result.canonical.media.assets[0]?.video?.variants.hlsAvcMaster).toBeNull();` |
| L83 | assets[0] | test_fixture | `expect(result.canonical.media.assets[0]?.source.kind).toBe("assets");` |
| L83 | media.assets | test_fixture | `expect(result.canonical.media.assets[0]?.source.kind).toBe("assets");` |
| L84 | assets[0] | test_fixture | `expect(result.canonical.media.assets[0]?.source.primarySources).toEqual(expect.arrayContaining(["assets", "playbackLab"]));` |
| L84 | media.assets | test_fixture | `expect(result.canonical.media.assets[0]?.source.primarySources).toEqual(expect.arrayContaining(["assets", "playbackLab"]));` |
| L85 | assets[0] | test_fixture | `expect(result.canonical.media.assets[0]?.source.legacySourcesConsidered).toEqual(` |
| L85 | media.assets | test_fixture | `expect(result.canonical.media.assets[0]?.source.legacySourcesConsidered).toEqual(` |
| L86 | photoLinks2 | test_fixture | `expect.arrayContaining(["photoLinks2", "photoLinks3", "legacy.photoLinks2", "legacy.photoLinks3"])` |
| L86 | photoLinks3 | test_fixture | `expect.arrayContaining(["photoLinks2", "photoLinks3", "legacy.photoLinks2", "legacy.photoLinks3"])` |
| L88 | assets[0] | test_fixture | `expect(result.canonical.media.assets[0]?.video?.variants.diagnosticsJson).toBeUndefined();` |
| L88 | media.assets | test_fixture | `expect(result.canonical.media.assets[0]?.video?.variants.diagnosticsJson).toBeUndefined();` |
| L89 | photoLinks2 | test_fixture | `expect(result.canonical.media.assets[0]?.video?.variants.photoLinks2).toBeUndefined();` |
| L89 | assets[0] | test_fixture | `expect(result.canonical.media.assets[0]?.video?.variants.photoLinks2).toBeUndefined();` |
| L89 | media.assets | test_fixture | `expect(result.canonical.media.assets[0]?.video?.variants.photoLinks2).toBeUndefined();` |
| L90 | photoLinks2 | test_fixture | `expect(result.canonical.media.assets[0]?.video?.variants["legacy.photoLinks2"]).toBeUndefined();` |
| L90 | assets[0] | test_fixture | `expect(result.canonical.media.assets[0]?.video?.variants["legacy.photoLinks2"]).toBeUndefined();` |
| L90 | media.assets | test_fixture | `expect(result.canonical.media.assets[0]?.video?.variants["legacy.photoLinks2"]).toBeUndefined();` |
| L91 | assets[0] | test_fixture | `expect(Object.keys(result.canonical.media.assets[0]?.video?.variants ?? {}).sort()).toEqual(` |
| L91 | media.assets | test_fixture | `expect(Object.keys(result.canonical.media.assets[0]?.video?.variants ?? {}).sort()).toEqual(` |
| L113 | assets[0] | test_fixture | `expect(result.canonical.media.assets[0]?.video?.readiness.faststartVerified).toBe(true);` |
| L113 | media.assets | test_fixture | `expect(result.canonical.media.assets[0]?.video?.readiness.faststartVerified).toBe(true);` |
| L114 | assets[0] | test_fixture | `expect(result.canonical.media.assets[0]?.video?.technical.sourceCodec).toBe("h264");` |
| L114 | media.assets | test_fixture | `expect(result.canonical.media.assets[0]?.video?.technical.sourceCodec).toBe("h264");` |
| L124 | media.assets | test_fixture | `expect(result.canonical.media.assets.some((asset) => asset.type === "image" && /\.mp4(\?\|$)/i.test(asset.image?.displayUrl ?? ""))).toBe(` |
| L127 | media.assets | test_fixture | `const fallbackMatches = result.canonical.media.assets.filter(` |
| L139 | photoLink | test_fixture | `expect(result.canonical.compatibility.photoLink).toBeTruthy();` |
| L140 | displayPhotoLink | test_fixture | `expect(result.canonical.compatibility.displayPhotoLink).toBeTruthy();` |
| L141 | photoLinks2 | test_fixture | `expect(result.canonical.compatibility.photoLinks2).toBeTruthy();` |
| L142 | photoLinks3 | test_fixture | `expect(result.canonical.compatibility.photoLinks3).toBeTruthy();` |
| L143 | fallbackVideoUrl | test_fixture | `expect(result.canonical.compatibility.fallbackVideoUrl).toBeTruthy();` |
| L160 | photoLinks2 | test_fixture | `legacy: { photoLinks2: "https://v/1-360.mp4", photoLinks3: "https://v/1-720.mp4" }` |
| L160 | photoLinks3 | test_fixture | `legacy: { photoLinks2: "https://v/1-360.mp4", photoLinks3: "https://v/1-720.mp4" }` |
| L162 | media.assets | test_fixture | `expect(mixed.canonical.media.assets.length).toBe(2);` |
| L164 | assets[0] | test_fixture | `expect(mixed.canonical.media.assets[0]?.type).toBe("image");` |
| L164 | media.assets | test_fixture | `expect(mixed.canonical.media.assets[0]?.type).toBe("image");` |
| L165 | media.assets | test_fixture | `expect(mixed.canonical.media.assets[1]?.type).toBe("video");` |
| L182 | media.assets | test_fixture | `multiImage.canonical.media.assets.filter(` |
| L396 | media.assets | test_fixture | `expect(canonical.media.assets.map((a) => a.id)).toEqual(["img_0", "img_1", "img_2", "img_3"]);` |
| L397 | assets[0] | test_fixture | `expect(canonical.media.assets[0]?.image?.height).toBe(1280);` |
| L397 | media.assets | test_fixture | `expect(canonical.media.assets[0]?.image?.height).toBe(1280);` |

### Locava Backendv2/src/lib/posts/master-post-v2/normalizeMasterPostV2.ts

| L459 | fallbackVideoUrl | unknown | `const fallbackVideo = toTrimmed(rawPost.fallbackVideoUrl);` |
| L565 | media.assets | unknown | `kind: rawAssets.length > 0 ? "assets" : "media.assets",` |
| L569 | media.assets | unknown | `rawAssets.length > 0 ? "assets" : "media.assets",` |
| L593 | posterUrl | unknown | `posterUrl:` |
| L598 | posterUrl | unknown | `row.posterUrl,` |
| L601 | displayPhotoLink | unknown | `rawPost.displayPhotoLink` |
| L676 | photoLink | unknown | `{ url: toTrimmed(rawPost.photoLink), source: "photoLink" },` |
| L677 | photoLinks2 | unknown | `{ url: toTrimmed(rawPost.photoLinks2), source: "photoLinks2" },` |
| L678 | photoLinks3 | unknown | `{ url: toTrimmed(rawPost.photoLinks3), source: "photoLinks3" },` |
| L680 | fallbackVideoUrl | unknown | `{ url: toTrimmed(rawPost.fallbackVideoUrl), source: "fallbackVideoUrl" },` |
| L681 | posterUrl | unknown | `{ url: toTrimmed(rawPost.posterUrl), source: "posterUrl" },` |
| L683 | thumbUrl | unknown | `{ url: toTrimmed(rawPost.thumbUrl), source: "thumbUrl" },` |
| L684 | displayPhotoLink | unknown | `{ url: toTrimmed(rawPost.displayPhotoLink), source: "displayPhotoLink" },` |
| L685 | photoLink | unknown | `{ url: toTrimmed(legacy.photoLink), source: "legacy.photoLink" },` |
| L686 | photoLinks2 | unknown | `{ url: toTrimmed(legacy.photoLinks2), source: "legacy.photoLinks2" },` |
| L687 | photoLinks3 | unknown | `{ url: toTrimmed(legacy.photoLinks3), source: "legacy.photoLinks3" }` |
| L692 | photoLinks2 | unknown | `"photoLinks2",` |
| L693 | photoLinks3 | unknown | `"photoLinks3",` |
| L694 | photoLinks2 | unknown | `"legacy.photoLinks2",` |
| L695 | photoLinks3 | unknown | `"legacy.photoLinks3"` |
| L713 | posterUrl | unknown | `asset.video?.posterUrl,` |
| L798 | displayPhotoLink | unknown | `posterUrl: toTrimmed(rawPost.displayPhotoLink),` |
| L798 | posterUrl | unknown | `posterUrl: toTrimmed(rawPost.displayPhotoLink),` |
| L865 | posterUrl | unknown | `const coverUrl = (coverAsset?.type === "image" ? coverAsset.image?.displayUrl : coverAsset?.video?.posterUrl) ?? null;` |
| L866 | posterUrl | unknown | `const coverThumb = (coverAsset?.type === "image" ? coverAsset.image?.thumbnailUrl : coverAsset?.video?.posterUrl) ?? null;` |
| L867 | posterUrl | unknown | `const coverPoster = (coverAsset?.type === "video" ? coverAsset.video?.posterUrl : null) ?? null;` |
| L1050 | thumbUrl | unknown | `thumbUrl: coverThumb,` |
| L1051 | posterUrl | unknown | `posterUrl: coverPoster,` |
| L1078 | photoLink | unknown | `photoLink: coverUrl ?? null,` |
| L1079 | photoLinks2 | unknown | `photoLinks2: firstVideo?.video?.playback.primaryUrl ?? toTrimmed(rawPost.photoLinks2) ?? null,` |
| L1080 | photoLinks3 | unknown | `photoLinks3: firstVideo?.video?.playback.upgradeUrl ?? toTrimmed(rawPost.photoLinks3) ?? null,` |
| L1081 | displayPhotoLink | unknown | `displayPhotoLink: coverUrl ?? null,` |
| L1082 | thumbUrl | unknown | `thumbUrl: coverThumb ?? null,` |
| L1083 | posterUrl | unknown | `posterUrl: coverPoster ?? null,` |
| L1084 | fallbackVideoUrl | unknown | `fallbackVideoUrl: firstVideo?.video?.playback.fallbackUrl ?? toTrimmed(rawPost.fallbackVideoUrl) ?? null,` |
| L1091 | photoLink | unknown | `photoLink: rawPost.photoLink ?? null,` |
| L1092 | photoLinks2 | unknown | `photoLinks2: rawPost.photoLinks2 ?? null,` |
| L1093 | photoLinks3 | unknown | `photoLinks3: rawPost.photoLinks3 ?? null,` |
| L1094 | displayPhotoLink | unknown | `displayPhotoLink: rawPost.displayPhotoLink ?? null,` |
| L1095 | fallbackVideoUrl | unknown | `fallbackVideoUrl: rawPost.fallbackVideoUrl ?? null,` |
| L1161 | media.assets | unknown | `if (canonical.media.assetCount === 0) pushWarning(warnings, "missing_media_assets", "No media assets were recovered", "media.assets");` |
| L1166 | media.assets | unknown | `pushError(errors, "strict_missing_assets", "Strict mode requires at least one media asset", true, "media.assets");` |
| L1168 | media.assets | unknown | `if (dedupe.dedupedCount > 0) pushWarning(warnings, "deduped_assets", 'Deduped ${dedupe.dedupedCount} assets', "media.assets");` |

### Locava Backendv2/src/lib/posts/master-post-v2/validateMasterPostV2.test.ts

| L32 | assets[0] | test_fixture | `normalized.canonical.media.assets[0]!.id = "dup";` |
| L32 | media.assets | test_fixture | `normalized.canonical.media.assets[0]!.id = "dup";` |
| L33 | assets[0] | test_fixture | `if (normalized.canonical.media.assets[0]?.type === "video") {` |
| L33 | media.assets | test_fixture | `if (normalized.canonical.media.assets[0]?.type === "video") {` |
| L34 | assets[0] | test_fixture | `normalized.canonical.media.assets[0].video!.variants.diagnosticsJson = { noisy: true };` |
| L34 | media.assets | test_fixture | `normalized.canonical.media.assets[0].video!.variants.diagnosticsJson = { noisy: true };` |
| L36 | assets[0] | test_fixture | `normalized.canonical.media.assets.push({ ...normalized.canonical.media.assets[0]!, index: 1 });` |
| L36 | media.assets | test_fixture | `normalized.canonical.media.assets.push({ ...normalized.canonical.media.assets[0]!, index: 1 });` |

### Locava Backendv2/src/lib/posts/master-post-v2/validateMasterPostV2.ts

| L144 | media.assets | unknown | `if (post.media.assetCount !== post.media.assets.length) {` |
| L147 | media.assets | unknown | `message: "media.assetCount must equal media.assets.length",` |
| L155 | media.assets | unknown | `for (const asset of post.media.assets) {` |
| L160 | media.assets | unknown | `path: "media.assets",` |
| L175 | media.assets | unknown | `path: "media.assets.source",` |
| L185 | media.assets | unknown | `path: "media.assets.image.displayUrl",` |
| L194 | media.assets | unknown | `path: "media.assets.image.displayUrl",` |
| L204 | media.assets | unknown | `path: "media.assets.video.playback.primaryUrl",` |
| L215 | media.assets | unknown | `path: "media.assets.video.playback.primaryUrl",` |
| L223 | media.assets | unknown | `path: "media.assets.video.playback.primaryUrl"` |
| L230 | media.assets | unknown | `path: "media.assets.video.playback.previewUrl"` |
| L239 | media.assets | unknown | `path: "media.assets.video.playback.primaryUrl"` |
| L292 | media.assets | unknown | `const imageCount = post.media.assets.filter((asset) => asset.type === "image").length;` |
| L293 | media.assets | unknown | `const videoCount = post.media.assets.filter((asset) => asset.type === "video").length;` |
| L324 | media.assets | unknown | `for (const asset of post.media.assets.filter((asset) => asset.type === "video")) {` |
| L326 | photoLinks2 | unknown | `["diagnosticsJson", "photoLinks2", "photoLinks3"].includes(key) \|\| key.startsWith("legacy.")` |
| L326 | photoLinks3 | unknown | `["diagnosticsJson", "photoLinks2", "photoLinks3"].includes(key) \|\| key.startsWith("legacy.")` |
| L332 | media.assets | unknown | `path: "media.assets.video.variants",` |
| L342 | media.assets | unknown | `path: "media.assets.video.variants",` |
| L352 | media.assets | unknown | `path: "media.assets.video.variants",` |
| L376 | media.assets | unknown | `path: "media.assets.video.variants"` |
| L386 | media.assets | unknown | `path: "media.assets.video.playback.fallbackUrl"` |
| L427 | posterUrl | unknown | `if (post.media.cover.url && post.media.cover.posterUrl && (post.media.cover.width == null \|\| post.media.cover.height == null \|\| post.media.cover.aspectRatio == null)) {` |

### Locava Backendv2/src/lib/posts/media-readiness.ts

| L13 | posterUrl | unknown | `posterUrl?: string;` |
| L17 | fallbackVideoUrl | unknown | `fallbackVideoUrl?: string;` |
| L147 | post.assets | unknown | `const assets = Array.isArray(post.assets) ? (post.assets as PostRecord[]) : [];` |
| L150 | posterUrl | unknown | `const posterUrl = pickString(firstVideo?.poster, firstVideo?.thumbnail, asRecord(firstVideo?.variants)?.poster);` |
| L157 | posterUrl | unknown | `posterReady: Boolean(posterUrl),` |
| L158 | posterUrl | unknown | `posterPresent: Boolean(posterUrl),` |
| L159 | posterUrl | unknown | `...(posterUrl ? { posterUrl } : {}),` |
| L164 | assets[0] | unknown | `aspectRatio: pickNumber(assets[0]?.aspectRatio) ?? null,` |
| L165 | assets[0] | unknown | `width: pickNumber(assets[0]?.width) ?? null,` |
| L166 | assets[0] | unknown | `height: pickNumber(assets[0]?.height) ?? null,` |
| L189 | fallbackVideoUrl | unknown | `const fallbackVideoUrl = selection.fallbackVideoUrl;` |
| L219 | posterUrl | unknown | `posterReady: Boolean(selection.posterUrl ?? posterUrl),` |
| L220 | posterUrl | unknown | `posterPresent: Boolean(selection.posterUrl ?? posterUrl),` |
| L221 | posterUrl | unknown | `...((selection.posterUrl ?? posterUrl) ? { posterUrl: selection.posterUrl ?? posterUrl } : {}),` |
| L225 | fallbackVideoUrl | unknown | `...(fallbackVideoUrl ? { fallbackVideoUrl } : {}),` |
| L228 | assets[0] | unknown | `aspectRatio: pickNumber(firstVideo?.aspectRatio, assets[0]?.aspectRatio) ?? null,` |
| L229 | assets[0] | unknown | `width: pickNumber(firstVideo?.width, assets[0]?.width) ?? null,` |
| L230 | assets[0] | unknown | `height: pickNumber(firstVideo?.height, assets[0]?.height) ?? null,` |

### Locava Backendv2/src/lib/posts/post-envelope.test.ts

| L16 | posterUrl | test_fixture | `posterUrl: "https://cdn.example.com/poster.jpg",` |
| L32 | displayPhotoLink | test_fixture | `displayPhotoLink: "https://cdn.example.com/poster.jpg",` |
| L68 | posterUrl | test_fixture | `expect(first?.posterUrl).toBe("https://cdn.example.com/poster.jpg");` |
| L69 | posterUrl | test_fixture | `expect(first?.streamUrl).not.toBe(first?.posterUrl);` |
| L91 | posterUrl | test_fixture | `posterUrl: "https://cdn.example.com/poster.jpg",` |
| L104 | displayPhotoLink | test_fixture | `displayPhotoLink: "https://cdn.example.com/poster.jpg",` |
| L154 | posterUrl | test_fixture | `posterUrl: "https://cdn.example.com/lg.jpg",` |
| L209 | photoLink | test_fixture | `it("hydrates legacy photoLink-only posts into openable assets", () => {` |
| L219 | posterUrl | test_fixture | `posterUrl: "https://cdn.example.com/legacy.jpg",` |
| L230 | photoLink | test_fixture | `photoLink: "https://cdn.example.com/legacy.jpg",` |
| L237 | posterUrl | test_fixture | `expect(first?.posterUrl).toBe("https://cdn.example.com/legacy.jpg");` |
| L251 | posterUrl | test_fixture | `posterUrl: "https://cdn.example.com/i0.webp",` |
| L262 | displayPhotoLink | test_fixture | `displayPhotoLink: "https://cdn.example.com/i0.webp",` |
| L264 | thumbUrl | test_fixture | `thumbUrl: "https://cdn.example.com/i0.webp",` |
| L288 | posterUrl | test_fixture | `posterUrl: "https://cdn.example.com/marker.jpg",` |
| L299 | thumbUrl | test_fixture | `thumbUrl: "https://cdn.example.com/marker.jpg",` |
| L309 | posterUrl | test_fixture | `expect((envelope.assets as Array<Record<string, unknown>>)[0]?.posterUrl).toBe("https://cdn.example.com/marker.jpg");` |
| L322 | posterUrl | test_fixture | `posterUrl: "https://cdn.example.com/a.jpg",` |
| L334 | thumbUrl | test_fixture | `thumbUrl: "https://cdn.example.com/a.jpg",` |

### Locava Backendv2/src/lib/posts/post-envelope.ts

| L326 | assets[0] | migrated_appPostV2 | `const firstAsset = assets[0] ?? null;` |
| L382 | posterUrl | migrated_appPostV2 | `const posterUrl =` |
| L384 | thumbUrl | migrated_appPostV2 | `seed.thumbUrl,` |
| L385 | displayPhotoLink | migrated_appPostV2 | `seed.displayPhotoLink,` |
| L386 | photoLink | migrated_appPostV2 | `seed.photoLink,` |
| L387 | posterUrl | migrated_appPostV2 | `firstAsset?.posterUrl,` |
| L390 | posterUrl | migrated_appPostV2 | `sourcePost.posterUrl,` |
| L391 | displayPhotoLink | migrated_appPostV2 | `sourcePost.displayPhotoLink,` |
| L392 | thumbUrl | migrated_appPostV2 | `sourcePost.thumbUrl,` |
| L393 | photoLinks2 | migrated_appPostV2 | `firstMediaUrlFromCommaField(sourcePost.photoLinks2),` |
| L394 | photoLinks3 | migrated_appPostV2 | `firstMediaUrlFromCommaField(sourcePost.photoLinks3),` |
| L395 | photoLink | migrated_appPostV2 | `sourcePost.photoLink,` |
| L432 | posterUrl | migrated_appPostV2 | `normalizeNullableString(seed.firstAssetUrl ?? firstAsset?.originalUrl ?? firstAsset?.previewUrl ?? firstAsset?.posterUrl),` |
| L435 | posterUrl | migrated_appPostV2 | `posterUrl,` |
| L471 | thumbUrl | migrated_appPostV2 | `thumbUrl: posterUrl,` |
| L471 | posterUrl | migrated_appPostV2 | `thumbUrl: posterUrl,` |
| L472 | displayPhotoLink | migrated_appPostV2 | `displayPhotoLink:` |
| L474 | displayPhotoLink | migrated_appPostV2 | `seed.displayPhotoLink,` |
| L475 | displayPhotoLink | migrated_appPostV2 | `sourcePost.displayPhotoLink,` |
| L476 | displayPhotoLink | migrated_appPostV2 | `mediaNormalization.displayPhotoLink ?? undefined,` |
| L477 | posterUrl | migrated_appPostV2 | `posterUrl,` |
| L478 | posterUrl | migrated_appPostV2 | `) ?? posterUrl,` |
| L479 | photoLink | migrated_appPostV2 | `photoLink:` |
| L480 | photoLink | migrated_appPostV2 | `pickString(seed.photoLink, sourcePost.photoLink, mediaNormalization.photoLink ?? undefined, posterUrl) ??` |
| L480 | posterUrl | migrated_appPostV2 | `pickString(seed.photoLink, sourcePost.photoLink, mediaNormalization.photoLink ?? undefined, posterUrl) ??` |
| L481 | posterUrl | migrated_appPostV2 | `posterUrl,` |
| L482 | posterUrl | migrated_appPostV2 | `posterUrl,` |
| L516 | posterUrl | migrated_appPostV2 | `posterUrl,` |
| L547 | posterUrl | migrated_appPostV2 | `: posterUrl` |

### Locava Backendv2/src/lib/posts/video-playback-selection.test.ts

| L155 | thumbUrl | test_fixture | `thumbUrl: "https://cdn/p.jpg",` |
| L282 | photoLink | test_fixture | `it("returns true when cardSummary.photoLink lists multiple HTTPS URLs while assets holds one row", () => {` |
| L287 | photoLink | test_fixture | `photoLink:` |
| L356 | posterUrl | test_fixture | `posterUrl: "https://x/p.jpg",` |

### Locava Backendv2/src/lib/posts/video-playback-selection.ts

| L40 | fallbackVideoUrl | unknown | `fallbackVideoUrl?: string;` |
| L41 | posterUrl | unknown | `posterUrl?: string;` |
| L237 | thumbUrl | unknown | `const posterUrl = pickString(nest.posterUrl, nest.poster, nest.thumbnail, nest.thumbUrl);` |
| L237 | posterUrl | unknown | `const posterUrl = pickString(nest.posterUrl, nest.poster, nest.thumbnail, nest.thumbUrl);` |
| L241 | videoUrl | unknown | `nest.videoUrl,` |
| L248 | posterUrl | unknown | `if (!hasVariants && !orig && !posterUrl) return null;` |
| L252 | posterUrl | unknown | `...(posterUrl ? { poster: posterUrl, thumbnail: posterUrl } : {}),` |
| L288 | post.assets | unknown | `const assets = Array.isArray(post.assets) ? (post.assets as PostRecord[]) : [];` |
| L345 | post.assets | unknown | `(Array.isArray(post.assets) && (post.assets as PostRecord[]).some((a) => pickString(a?.type, a?.mediaType) === "video")) \|\|` |
| L354 | fallbackVideoUrl | unknown | `if (!sel.playbackUrl && !sel.fallbackVideoUrl) return true;` |
| L423 | photoLink | unknown | `card.photoLink,` |
| L424 | displayPhotoLink | unknown | `card.displayPhotoLink,` |
| L425 | photoLink | unknown | `legacy?.photoLink,` |
| L426 | photoLinks2 | unknown | `legacy?.photoLinks2,` |
| L427 | photoLinks3 | unknown | `legacy?.photoLinks3,` |
| L435 | photoLink | unknown | `post.photoLink,` |
| L436 | displayPhotoLink | unknown | `post.displayPhotoLink,` |
| L437 | photoLink | unknown | `legacyTop?.photoLink,` |
| L438 | photoLinks2 | unknown | `legacyTop?.photoLinks2,` |
| L439 | photoLinks3 | unknown | `legacyTop?.photoLinks3,` |
| L469 | photoLink | unknown | `* 'photoLink' / 'assetCount' still reflect the real gallery size. When true, callers should` |
| L475 | post.assets | unknown | `const assets = Array.isArray(post.assets) ? (post.assets as PostRecord[]) : [];` |
| L540 | posterUrl | unknown | `const posterUrl = pickString(` |
| L544 | posterUrl | unknown | `post.posterUrl,` |
| L545 | thumbUrl | unknown | `post.thumbUrl,` |
| L555 | videoUrl | unknown | `post.videoUrl,` |
| L557 | videoUrl | unknown | `extractVariantUrl(mediaRoot?.videoUrl),` |
| L563 | videoUrl | unknown | `extractVariantUrl(videoNestMedia?.videoUrl ?? videoNestMedia?.mp4Url),` |
| L565 | fallbackVideoUrl | unknown | `const postLevelFallback = pickString(post.fallbackVideoUrl);` |
| L667 | fallbackVideoUrl | unknown | `let fallbackVideoUrl = pickFallbackOriginal(asset, selectedUrl) ?? postLevelFallback;` |
| L670 | fallbackVideoUrl | unknown | `if (!playbackUrl && allowFallbackAsCanonicalPlayback && fallbackVideoUrl && isRemoteHttpUrl(fallbackVideoUrl)) {` |
| L671 | fallbackVideoUrl | unknown | `playbackUrl = fallbackVideoUrl;` |
| L693 | fallbackVideoUrl | unknown | `...(fallbackVideoUrl ? { fallbackVideoUrl } : {}),` |
| L694 | posterUrl | unknown | `...(posterUrl ? { posterUrl } : {}),` |

### Locava Backendv2/src/observability/feed-items-media-trace.test.ts

| L12 | posterUrl | test_fixture | `media: { type: "video", posterUrl: "https://x.com/p.jpg", startupHint: "poster_then_preview" },` |
| L15 | fallbackVideoUrl | test_fixture | `fallbackVideoUrl: "https://x.com/original.mp4",` |
| L28 | posterUrl | test_fixture | `media: { type: "image", posterUrl: "https://x.com/i.jpg", aspectRatio: 1 },` |
| L47 | posterUrl | test_fixture | `media: { type: "video", posterUrl: "https://cdn.example.com/p.jpg", startupHint: "poster_then_preview" },` |

### Locava Backendv2/src/observability/feed-items-media-trace.ts

| L66 | assets[0] | unknown | `const v0 = assets[0] as LooseRecord \| undefined;` |
| L75 | fallbackVideoUrl | unknown | `item.fallbackVideoUrl,` |
| L77 | posterUrl | unknown | `item.posterUrl,` |
| L78 | posterUrl | unknown | `media?.posterUrl,` |
| L96 | fallbackVideoUrl | unknown | `fallbackVideoUrlTail: fingerprintUrl(item.fallbackVideoUrl),` |
| L98 | posterUrl | unknown | `posterUrlTail: fingerprintUrl(item.posterUrl ?? media?.posterUrl),` |
| L106 | posterUrl | unknown | `posterTail: fingerprintUrl(v0.posterUrl),` |
| L144 | assets[0] | unknown | `const v0 = assets[0] as LooseRecord \| undefined;` |
| L198 | fallbackVideoUrl | unknown | `if (typeof it.fallbackVideoUrl === "string" && it.fallbackVideoUrl.length > 0) fallbackVideoNonEmpty++;` |
| L201 | posterUrl | unknown | `(typeof media?.posterUrl === "string" && media.posterUrl.length > 0) \|\|` |
| L202 | posterUrl | unknown | `(typeof it.posterUrl === "string" && it.posterUrl.length > 0);` |
| L208 | fallbackVideoUrl | unknown | `const pool: unknown[] = [it.playbackUrl, it.fallbackVideoUrl, it.firstAssetUrl];` |
| L210 | assets[0] | unknown | `const v0 = assets[0] as LooseRecord \| undefined;` |
| L228 | fallbackVideoUrl | unknown | `if (!sel.playbackUrl && !sel.fallbackVideoUrl) videoMissingPlayableCount += 1;` |

### Locava Backendv2/src/observability/route-policies.ts

| L320 | notification | unknown | `// Like path: viewer doc (repo) + post doc (notification resolvePostContext) + post doc (likeCount in orchestrator).` |

### Locava Backendv2/src/orchestration/mutations/notifications-mark-all-read.orchestrator.ts

| L16 | notification | needs_migration | `mutationType: "notification.markallread",` |

### Locava Backendv2/src/orchestration/mutations/notifications-mark-read.orchestrator.ts

| L16 | notification | needs_migration | `mutationType: "notification.markread" as const,` |
| L21 | notification | needs_migration | `mutationType: "notification.markread",` |

### Locava Backendv2/src/orchestration/mutations/post-delete.orchestrator.ts

| L18 | profile grid | needs_migration | `// Post delete must be strongly coherent for the acting viewer; otherwise the profile grid` |

### Locava Backendv2/src/orchestration/mutations/posting-finalize.orchestrator.test.ts

| L23 | posterUrl | test_fixture | `posterUrl: "https://cdn.example.com/poster.jpg",` |
| L26 | fallbackVideoUrl | test_fixture | `fallbackVideoUrl: "https://cdn.example.com/original.mp4",` |
| L51 | fallbackVideoUrl | test_fixture | `fallbackVideoUrl: "https://cdn.example.com/original.mp4",` |

### Locava Backendv2/src/orchestration/mutations/posting-finalize.orchestrator.ts

| L18 | posterUrl | needs_migration | `posterUrl?: string;` |
| L76 | posterUrl | needs_migration | `posterUrl: result.mediaReadiness.posterUrl,` |
| L80 | fallbackVideoUrl | needs_migration | `fallbackVideoUrl: result.mediaReadiness.fallbackVideoUrl,` |

### Locava Backendv2/src/orchestration/searchMixes.orchestrator.ts

| L26 | assets[0] | needs_migration | `Array.isArray(row.assets) && row.assets[0] && typeof row.assets[0] === "object"` |
| L27 | assets[0] | needs_migration | `? (row.assets[0] as Record<string, unknown>)` |
| L31 | posterUrl | needs_migration | `const posterUrl =` |
| L32 | thumbUrl | needs_migration | `cleanString(row.thumbUrl) ??` |
| L33 | displayPhotoLink | needs_migration | `cleanString(row.displayPhotoLink) ??` |
| L34 | posterUrl | needs_migration | `cleanString(firstAsset?.posterUrl) ??` |
| L41 | posterUrl | needs_migration | `cleanString(firstAsset?.posterUrl) ??` |
| L43 | displayPhotoLink | needs_migration | `cleanString(row.displayPhotoLink) ??` |
| L44 | thumbUrl | needs_migration | `cleanString(row.thumbUrl);` |
| L48 | displayPhotoLink | needs_migration | `cleanString(row.displayPhotoLink) ??` |
| L60 | posterUrl | needs_migration | `posterUrl,` |
| L172 | posterUrl | needs_migration | `const posterUrl = cleanString(primary?.posterUrl) ?? compactAsset.posterUrl ?? "";` |
| L189 | posterUrl | needs_migration | `posterUrl,` |
| L209 | posterUrl | needs_migration | `posterUrl: compactAsset.posterUrl \|\| null,` |
| L232 | posterUrl | needs_migration | `(compactAsset.originalUrl ?? compactAsset.previewUrl ?? compactAsset.posterUrl ?? null),` |

### Locava Backendv2/src/orchestration/surfaces/feed-item-detail.orchestrator.ts

| L134 | thumbUrl | needs_migration | `thumbUrl: post.thumbUrl,` |
| L135 | post.assets | needs_migration | `assets: post.assets,` |
| L151 | thumbUrl | needs_migration | `posterUrl: post.thumbUrl,` |
| L151 | posterUrl | needs_migration | `posterUrl: post.thumbUrl,` |

### Locava Backendv2/src/orchestration/surfaces/map-bootstrap.orchestrator.test.ts

| L14 | thumbUrl | test_fixture | `thumbUrl: "https://cdn/p1.jpg",` |

### Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.test.ts

| L12 | posterUrl | test_fixture | `media: { type: "video" as const, posterUrl: "https://cdn/p.jpg", aspectRatio: 9 / 16, startupHint: "poster_then_preview" as const },` |
| L24 | thumbUrl | test_fixture | `thumbUrl: "https://cdn/p.jpg",` |
| L42 | posterUrl | test_fixture | `media: { type: "video", posterUrl: "https://cdn/p.jpg", aspectRatio: 9 / 16, startupHint: "poster_then_preview" },` |
| L71 | thumbUrl | test_fixture | `thumbUrl: "https://cdn/p.jpg",` |
| L93 | posterUrl | test_fixture | `media: { type: "video" as const, posterUrl: "https://cdn/p.jpg", aspectRatio: 9 / 16, startupHint: "poster_then_preview" as const },` |
| L116 | thumbUrl | test_fixture | `thumbUrl: "https://cdn/p.jpg",` |
| L131 | posterUrl | test_fixture | `media: { type: "video" as const, posterUrl: "https://cdn/p.jpg", aspectRatio: 9 / 16, startupHint: "poster_then_preview" as const },` |
| L187 | thumbUrl | test_fixture | `thumbUrl: "https://cdn/p.jpg",` |
| L208 | posterUrl | test_fixture | `media: { type: "video" as const, posterUrl: "https://cdn/p.jpg", aspectRatio: 9 / 16, startupHint: "poster_then_preview" as const },` |
| L217 | posterUrl | test_fixture | `posterUrl: "https://cdn/p.jpg",` |
| L278 | thumbUrl | test_fixture | `thumbUrl: "https://cdn/from-truth.jpg",` |
| L295 | posterUrl | test_fixture | `media: { type: "video" as const, posterUrl: "", aspectRatio: 9 / 16, startupHint: "poster_then_preview" as const },` |
| L308 | posterUrl | test_fixture | `media: { type: "video" as const, posterUrl: "", aspectRatio: 9 / 16, startupHint: "poster_then_preview" as const },` |
| L327 | thumbUrl | test_fixture | `expect(post.posterPresent === true \|\| Boolean(post.thumbUrl)).toBe(true);` |
| L340 | thumbUrl | test_fixture | `thumbUrl: "https://cdn/one.jpg",` |
| L356 | posterUrl | test_fixture | `media: { type: "image" as const, posterUrl: "https://cdn/one.jpg", aspectRatio: 3 / 4, startupHint: "poster_only" as const },` |
| L372 | posterUrl | test_fixture | `posterUrl: "https://cdn/one.jpg",` |
| L388 | posterUrl | test_fixture | `media: { type: "image" as const, posterUrl: "https://cdn/one.jpg", aspectRatio: 3 / 4, startupHint: "poster_only" as const },` |
| L404 | posterUrl | test_fixture | `posterUrl: "https://cdn/one.jpg",` |
| L425 | post.assets | test_fixture | `expect(Array.isArray(post.assets)).toBe(true);` |
| L426 | post.assets | test_fixture | `expect((post.assets as unknown[]).length).toBe(4);` |
| L440 | thumbUrl | test_fixture | `thumbUrl: "https://cdn/0.jpg",` |
| L454 | posterUrl | test_fixture | `media: { type: "image" as const, posterUrl: "https://cdn/0.jpg", aspectRatio: 3 / 4, startupHint: "poster_only" as const },` |
| L470 | posterUrl | test_fixture | `posterUrl: "https://cdn/0.jpg",` |
| L522 | thumbUrl | test_fixture | `thumbUrl: "https://cdn/0.jpg",` |
| L536 | posterUrl | test_fixture | `media: { type: "image" as const, posterUrl: "https://cdn/a.jpg", aspectRatio: 3 / 4, startupHint: "poster_only" as const },` |
| L553 | posterUrl | test_fixture | `posterUrl: "https://cdn/a.jpg",` |
| L606 | posterUrl | test_fixture | `media: { type: "image" as const, posterUrl: "https://cdn/0.jpg", aspectRatio: 1, startupHint: "poster_only" as const },` |
| L622 | posterUrl | test_fixture | `posterUrl: url,` |
| L642 | post.assets | test_fixture | `expect((post.assets as unknown[]).length).toBe(3);` |
| L643 | post.assets | test_fixture | `const originals = (post.assets as Array<{ original?: string \| null; id?: string }>).map((a) =>` |
| L657 | thumbUrl | test_fixture | `thumbUrl: "https://cdn/poster.jpg",` |
| L680 | posterUrl | test_fixture | `media: { type: "video" as const, posterUrl: "https://cdn/poster.jpg", aspectRatio: 9 / 16, startupHint: "poster_then_preview" as const },` |
| L689 | posterUrl | test_fixture | `posterUrl: "https://cdn/poster.jpg",` |
| L724 | posterUrl | test_fixture | `posterUrl: "https://cdn/poster.jpg",` |
| L741 | posterUrl | test_fixture | `media: { type: "video" as const, posterUrl: "https://cdn/p1.jpg", aspectRatio: 9 / 16, startupHint: "poster_then_preview" as const },` |
| L746 | posterUrl | test_fixture | `assets: [{ ...productionAsset, posterUrl: "https://cdn/p1.jpg" }],` |
| L754 | posterUrl | test_fixture | `media: { type: "video" as const, posterUrl: "https://cdn/p3.jpg", aspectRatio: 9 / 16, startupHint: "poster_then_preview" as const },` |
| L759 | posterUrl | test_fixture | `assets: [{ ...productionAsset, posterUrl: "https://cdn/p3.jpg" }],` |
| L789 | thumbUrl | test_fixture | `thumbUrl: "https://cdn/poster.jpg",` |
| L795 | fallbackVideoUrl | test_fixture | `fallbackVideoUrl: "https://cdn/original.mp4",` |
| L821 | fallbackVideoUrl | test_fixture | `fallbackVideoUrl: "https://cdn/original.mp4",` |
| L843 | posterUrl | test_fixture | `media: { type: "video", posterUrl: "https://cdn/poster.jpg", aspectRatio: 9 / 16, startupHint: "poster_then_preview" },` |
| L849 | posterUrl | test_fixture | `posterUrl: "https://cdn/poster.jpg",` |
| L860 | fallbackVideoUrl | test_fixture | `fallbackVideoUrl: "https://cdn/original.mp4",` |
| L878 | fallbackVideoUrl | test_fixture | `Boolean(out.firstRender.post.playbackUrl) \|\| Boolean(out.firstRender.post.fallbackVideoUrl),` |
| L895 | posterUrl | test_fixture | `media: { type: "video", posterUrl: "https://cdn/poster.jpg", aspectRatio: 9 / 16, startupHint: "poster_then_preview" },` |
| L901 | posterUrl | test_fixture | `posterUrl: "https://cdn/poster.jpg",` |
| L932 | fallbackVideoUrl | test_fixture | `expect(Boolean(post.playbackUrl) \|\| Boolean(post.fallbackVideoUrl)).toBe(true);` |

### Locava Backendv2/src/orchestration/surfaces/posts-detail.orchestrator.ts

| L44 | fallbackVideoUrl | needs_migration | `fallbackVideoUrlPresent: Boolean(mediaReadiness.fallbackVideoUrl),` |
| L63 | thumbUrl | needs_migration | `thumbUrl: detail.thumbUrl \|\| base.thumbUrl,` |
| L85 | thumbUrl | needs_migration | `thumbUrl: detail.thumbUrl \|\| base.thumbUrl,` |
| L102 | fallbackVideoUrl | needs_migration | `fallbackVideoUrl?: string \| null;` |
| L103 | posterUrl | needs_migration | `posterUrl?: string \| null;` |
| L140 | fallbackVideoUrl | needs_migration | `...(typeof sx.fallbackVideoUrl === "string" ? { fallbackVideoUrl: sx.fallbackVideoUrl } : {}),` |
| L141 | posterUrl | needs_migration | `...(typeof sx.posterUrl === "string" ? { posterUrl: sx.posterUrl } : {}),` |
| L149 | photoLink | needs_migration | `...(typeof (summary as Record<string, unknown>).photoLink === "string"` |
| L150 | photoLink | needs_migration | `? { photoLink: (summary as Record<string, unknown>).photoLink as string }` |
| L152 | displayPhotoLink | needs_migration | `...(typeof (summary as Record<string, unknown>).displayPhotoLink === "string"` |
| L153 | displayPhotoLink | needs_migration | `? { displayPhotoLink: (summary as Record<string, unknown>).displayPhotoLink as string }` |
| L171 | photoLink | needs_migration | `"photoLink",` |
| L172 | displayPhotoLink | needs_migration | `"displayPhotoLink",` |
| L241 | posterUrl | needs_migration | `posterUrl: mediaReadiness.posterUrl,` |
| L245 | fallbackVideoUrl | needs_migration | `fallbackVideoUrl: mediaReadiness.fallbackVideoUrl,` |
| L369 | fallbackVideoUrl | needs_migration | `fallbackVideoUrlPresent: Boolean(mediaReadiness.fallbackVideoUrl),` |
| L409 | thumbUrl | needs_migration | `thumbUrl: post.thumbUrl,` |
| L416 | posterUrl | needs_migration | `posterUrl: mediaReadiness.posterUrl,` |
| L420 | fallbackVideoUrl | needs_migration | `fallbackVideoUrl: mediaReadiness.fallbackVideoUrl,` |
| L429 | post.assets | needs_migration | `assets: post.assets,` |
| L443 | thumbUrl | needs_migration | `posterUrl: post.thumbUrl,` |
| L443 | posterUrl | needs_migration | `posterUrl: post.thumbUrl,` |
| L555 | posterUrl | needs_migration | `posterUrl: mediaReadiness.posterUrl,` |
| L559 | fallbackVideoUrl | needs_migration | `fallbackVideoUrl: mediaReadiness.fallbackVideoUrl,` |
| L940 | posterUrl | needs_migration | `posterUrl: mediaReadiness.posterUrl,` |
| L944 | fallbackVideoUrl | needs_migration | `fallbackVideoUrl: mediaReadiness.fallbackVideoUrl,` |
| L1071 | thumbUrl | needs_migration | `thumbUrl: cardSummary.media.posterUrl,` |
| L1071 | posterUrl | needs_migration | `thumbUrl: cardSummary.media.posterUrl,` |
| L1099 | thumbUrl | needs_migration | `thumbUrl: detail.thumbUrl ?? cardSummary.media.posterUrl,` |
| L1099 | posterUrl | needs_migration | `thumbUrl: detail.thumbUrl ?? cardSummary.media.posterUrl,` |
| L1147 | post.assets | needs_migration | `const hasAssets = detail.firstRender.post.assets.length > 0;` |
| L1160 | thumbUrl | needs_migration | `const fallbackPoster = String(detail?.thumbUrl ?? summary?.media?.posterUrl ?? "");` |
| L1160 | posterUrl | needs_migration | `const fallbackPoster = String(detail?.thumbUrl ?? summary?.media?.posterUrl ?? "");` |
| L1172 | posterUrl | needs_migration | `posterUrl: fallbackPoster,` |

### Locava Backendv2/src/orchestration/surfaces/profile-bootstrap.orchestrator.test.ts

| L30 | thumbUrl | test_fixture | `thumbUrl: "https://cdn.example.com/p1.jpg",` |
| L116 | thumbUrl | test_fixture | `thumbUrl: 'https://cdn.example.com/t${i}.jpg',` |

### Locava Backendv2/src/orchestration/surfaces/profile-post-detail.orchestrator.ts

| L84 | thumbUrl | needs_migration | `thumbUrl: detail.thumbUrl,` |
| L91 | posterUrl | needs_migration | `posterUrl: mediaReadiness.posterUrl,` |
| L95 | fallbackVideoUrl | needs_migration | `fallbackVideoUrl: mediaReadiness.fallbackVideoUrl,` |
| L138 | thumbUrl | needs_migration | `thumbUrl: detail.thumbUrl,` |

### Locava Backendv2/src/repositories/compat/posts-batch.repository.ts

| L44 | thumbUrl | needs_migration | `"thumbUrl",` |
| L45 | displayPhotoLink | needs_migration | `"displayPhotoLink",` |
| L46 | photoLink | needs_migration | `"photoLink",` |

### Locava Backendv2/src/repositories/mixes.repository.ts

| L70 | thumbUrl | needs_migration | `"thumbUrl",` |
| L71 | displayPhotoLink | needs_migration | `"displayPhotoLink",` |
| L72 | photoLink | needs_migration | `"photoLink",` |

### Locava Backendv2/src/repositories/mixes/mixes.repository.test.ts

| L14 | displayPhotoLink | test_fixture | `displayPhotoLink: 'https://cdn.locava.test/post-${index + 1}.jpg',` |

### Locava Backendv2/src/repositories/mixPosts.repository.ts

| L17 | thumbUrl | needs_migration | `thumbUrl?: string;` |
| L18 | displayPhotoLink | needs_migration | `displayPhotoLink?: string;` |
| L33 | thumbUrl | needs_migration | `"thumbUrl",` |
| L34 | displayPhotoLink | needs_migration | `"displayPhotoLink",` |
| L35 | photoLink | needs_migration | `"photoLink",` |

### Locava Backendv2/src/repositories/source-of-truth/feed-detail-firestore.adapter.ts

| L36 | thumbUrl | needs_migration | `thumbUrl: string;` |
| L146 | thumbUrl | needs_migration | `"thumbUrl",` |
| L147 | displayPhotoLink | needs_migration | `"displayPhotoLink",` |
| L148 | photoLink | needs_migration | `"photoLink",` |
| L286 | thumbUrl | needs_migration | `thumbUrl?: string;` |
| L287 | displayPhotoLink | needs_migration | `displayPhotoLink?: string;` |
| L288 | photoLink | needs_migration | `photoLink?: string;` |
| L349 | thumbUrl | needs_migration | `const thumbUrl = resolveThumbCandidate(input.postData);` |
| L350 | thumbUrl | needs_migration | `if (!thumbUrl) {` |
| L400 | thumbUrl | needs_migration | `thumbUrl: normalizeThumbUrl(input.postData, thumbUrl),` |
| L404 | thumbUrl | needs_migration | `assets: normalizeAssets(input.responsePostId, mediaType, thumbUrl, input.postData),` |
| L502 | thumbUrl | needs_migration | `const direct = normalizeNullable(data.thumbUrl);` |
| L504 | displayPhotoLink | needs_migration | `const display = normalizeNullable(data.displayPhotoLink);` |
| L506 | photoLink | needs_migration | `if (typeof data.photoLink === "string" && data.photoLink.includes(",")) {` |
| L507 | photoLink | needs_migration | `const first = data.photoLink` |
| L513 | photoLink | needs_migration | `if (typeof data.photoLink === "string" && data.photoLink.trim()) {` |
| L514 | photoLink | needs_migration | `return data.photoLink.trim();` |
| L733 | displayPhotoLink | needs_migration | `const candidate = normalizeNullable(data.thumbUrl) ?? normalizeNullable(data.displayPhotoLink);` |
| L733 | thumbUrl | needs_migration | `const candidate = normalizeNullable(data.thumbUrl) ?? normalizeNullable(data.displayPhotoLink);` |
| L735 | photoLink | needs_migration | `if (typeof data.photoLink === "string" && data.photoLink.includes(",")) {` |
| L736 | photoLink | needs_migration | `const first = data.photoLink.split(",").map((v) => v.trim()).find(Boolean);` |
| L750 | thumbUrl | needs_migration | `thumbUrl: string,` |
| L771 | thumbUrl | needs_migration | `thumbUrl,` |
| L776 | thumbUrl | needs_migration | `thumbUrl,` |
| L806 | thumbUrl | needs_migration | `poster: thumbUrl,` |
| L807 | thumbUrl | needs_migration | `thumbnail: thumbUrl` |
| L815 | thumbUrl | needs_migration | `poster: thumbUrl,` |
| L816 | thumbUrl | needs_migration | `thumbnail: thumbUrl` |

### Locava Backendv2/src/repositories/source-of-truth/feed-firestore.adapter.test.ts

| L25 | displayPhotoLink | test_fixture | `displayPhotoLink: "https://example.com/post-2.jpg",` |
| L33 | displayPhotoLink | test_fixture | `displayPhotoLink: "https://example.com/post-1.jpg",` |

### Locava Backendv2/src/repositories/source-of-truth/feed-firestore.adapter.ts

| L16 | posterUrl | needs_migration | `posterUrl: string;` |
| L39 | posterUrl | needs_migration | `posterUrl: string \| null;` |
| L89 | thumbUrl | needs_migration | `"thumbUrl",` |
| L90 | displayPhotoLink | needs_migration | `"displayPhotoLink",` |
| L91 | photoLink | needs_migration | `"photoLink",` |
| L92 | photoLinks2 | needs_migration | `"photoLinks2",` |
| L93 | photoLinks3 | needs_migration | `"photoLinks3",` |
| L254 | displayPhotoLink | needs_migration | `typeof data.displayPhotoLink === "string" && data.displayPhotoLink.trim()` |
| L255 | displayPhotoLink | needs_migration | `? data.displayPhotoLink` |
| L256 | thumbUrl | needs_migration | `: typeof data.thumbUrl === "string" && data.thumbUrl.trim()` |
| L257 | thumbUrl | needs_migration | `? data.thumbUrl` |
| L458 | displayPhotoLink | needs_migration | `typeof data.displayPhotoLink === "string" && data.displayPhotoLink.trim()` |
| L459 | displayPhotoLink | needs_migration | `? data.displayPhotoLink` |
| L460 | thumbUrl | needs_migration | `: typeof data.thumbUrl === "string" && data.thumbUrl.trim()` |
| L461 | thumbUrl | needs_migration | `? data.thumbUrl` |
| L498 | posterUrl | needs_migration | `const posterUrl = readPosterUrl(data);` |
| L533 | posterUrl | needs_migration | `posterUrl,` |
| L650 | assets[0] | needs_migration | `const first = data.assets[0] as Record<string, unknown>;` |
| L657 | displayPhotoLink | needs_migration | `const direct = [data.displayPhotoLink, data.thumbUrl];` |
| L657 | thumbUrl | needs_migration | `const direct = [data.displayPhotoLink, data.thumbUrl];` |
| L661 | assets[0] | needs_migration | `if (Array.isArray(data.assets) && data.assets.length > 0 && typeof data.assets[0] === "object") {` |
| L662 | assets[0] | needs_migration | `const first = data.assets[0] as Record<string, unknown>;` |
| L672 | assets[0] | needs_migration | `if (!Array.isArray(data.assets) \|\| data.assets.length === 0 \|\| typeof data.assets[0] !== "object") {` |
| L675 | assets[0] | needs_migration | `const first = data.assets[0] as Record<string, unknown>;` |
| L743 | posterUrl | needs_migration | `posterUrl: normalizeText(thumb.webp) ?? normalizeText(sm.webp),` |

### Locava Backendv2/src/repositories/source-of-truth/firestore-client.ts

| L435 | notification | needs_migration | `title: "Warmup notification",` |
| L436 | notification | needs_migration | `body: "Warmup notification",` |

### Locava Backendv2/src/repositories/source-of-truth/map-markers-firestore.adapter.ts

| L194 | thumbUrl | needs_migration | `"thumbUrl",` |
| L195 | displayPhotoLink | needs_migration | `"displayPhotoLink",` |
| L196 | photoLink | needs_migration | `"photoLink",` |
| L197 | photoLinks2 | needs_migration | `"photoLinks2",` |
| L198 | photoLinks3 | needs_migration | `"photoLinks3",` |
| L253 | thumbUrl | needs_migration | `"thumbUrl",` |
| L254 | displayPhotoLink | needs_migration | `"displayPhotoLink",` |
| L255 | photoLink | needs_migration | `"photoLink",` |
| L256 | photoLinks2 | needs_migration | `"photoLinks2",` |
| L257 | photoLinks3 | needs_migration | `"photoLinks3",` |
| L350 | photoLink | needs_migration | `const thumbnailUrl = normalizeText(data.displayPhotoLink) ?? normalizeText(data.photoLink) ?? normalizeText(data.thumbUrl);` |
| L350 | displayPhotoLink | needs_migration | `const thumbnailUrl = normalizeText(data.displayPhotoLink) ?? normalizeText(data.photoLink) ?? normalizeText(data.thumbUrl);` |
| L350 | thumbUrl | needs_migration | `const thumbnailUrl = normalizeText(data.displayPhotoLink) ?? normalizeText(data.photoLink) ?? normalizeText(data.thumbUrl);` |
| L375 | thumbUrl | needs_migration | `thumbUrl: thumbnailUrl,` |
| L376 | displayPhotoLink | needs_migration | `displayPhotoLink: thumbnailUrl,` |
| L473 | photoLink | needs_migration | `const hasPhoto = Boolean(normalizeText(data.displayPhotoLink) ?? normalizeText(data.photoLink) ?? normalizeText(data.thumbUrl));` |
| L473 | displayPhotoLink | needs_migration | `const hasPhoto = Boolean(normalizeText(data.displayPhotoLink) ?? normalizeText(data.photoLink) ?? normalizeText(data.thumbUrl));` |
| L473 | thumbUrl | needs_migration | `const hasPhoto = Boolean(normalizeText(data.displayPhotoLink) ?? normalizeText(data.photoLink) ?? normalizeText(data.thumbUrl));` |

### Locava Backendv2/src/repositories/source-of-truth/post-firestore-projection.test.ts

| L5 | displayPhotoLink | test_fixture | `it("prefers displayPhotoLink for thumbnails", () => {` |
| L9 | displayPhotoLink | test_fixture | `displayPhotoLink: "https://cdn.example/p.jpg",` |
| L10 | photoLink | test_fixture | `photoLink: "https://other"` |

### Locava Backendv2/src/repositories/source-of-truth/post-firestore-projection.ts

| L6 | displayPhotoLink | needs_migration | `* (see sampled production: 'time', 'displayPhotoLink', 'likesCount', etc.).` |
| L46 | photoLink | needs_migration | `const direct = data.displayPhotoLink ?? data.photoLink ?? data.thumbUrl;` |
| L46 | displayPhotoLink | needs_migration | `const direct = data.displayPhotoLink ?? data.photoLink ?? data.thumbUrl;` |
| L46 | thumbUrl | needs_migration | `const direct = data.displayPhotoLink ?? data.photoLink ?? data.thumbUrl;` |
| L49 | assets[0] | needs_migration | `if (Array.isArray(assets) && assets[0] && typeof assets[0] === "object") {` |
| L50 | assets[0] | needs_migration | `const a0 = assets[0] as { downloadURL?: string; url?: string; poster?: string };` |
| L62 | assets[0] | needs_migration | `if (Array.isArray(assets) && assets[0] && typeof assets[0] === "object") {` |
| L63 | assets[0] | needs_migration | `const t = (assets[0] as { type?: string }).type;` |
| L103 | thumbUrl | needs_migration | `thumbUrl: string;` |
| L134 | thumbUrl | needs_migration | `thumbUrl: readPostThumbUrl(data, doc.id),` |

### Locava Backendv2/src/repositories/source-of-truth/profile-firestore.adapter.ts

| L40 | thumbUrl | needs_migration | `thumbUrl: string;` |
| L87 | profile grid | needs_migration | `/** Cursor modes for profile grid: stable paging avoids offset scans on deep pages. */` |
| L704 | displayPhotoLink | needs_migration | `"displayPhotoLink",` |
| L705 | photoLink | needs_migration | `"photoLink",` |
| L706 | thumbUrl | needs_migration | `"thumbUrl",` |
| L766 | displayPhotoLink | needs_migration | `"displayPhotoLink",` |
| L767 | photoLink | needs_migration | `"photoLink",` |
| L768 | thumbUrl | needs_migration | `"thumbUrl",` |

### Locava Backendv2/src/repositories/source-of-truth/profile-post-detail-firestore.adapter.ts

| L38 | thumbUrl | needs_migration | `thumbUrl: string;` |
| L170 | thumbUrl | needs_migration | `thumbUrl?: string;` |
| L240 | thumbUrl | needs_migration | `thumbUrl: readPostThumbUrl(raw, input.postDoc.id),` |
| L496 | thumbUrl | needs_migration | `const thumbUrl = readPostThumbUrl(raw, postId);` |
| L516 | thumbUrl | needs_migration | `thumbUrl,` |
| L521 | thumbUrl | needs_migration | `thumbUrl,` |

### Locava Backendv2/src/repositories/source-of-truth/search-results-firestore.adapter.ts

| L21 | thumbUrl | needs_migration | `thumbUrl: string;` |
| L22 | displayPhotoLink | needs_migration | `displayPhotoLink: string;` |
| L57 | thumbUrl | needs_migration | `thumbUrl: string;` |
| L58 | displayPhotoLink | needs_migration | `displayPhotoLink: string;` |
| L93 | thumbUrl | needs_migration | `"thumbUrl",` |
| L94 | displayPhotoLink | needs_migration | `"displayPhotoLink",` |
| L95 | photoLink | needs_migration | `"photoLink",` |
| L436 | thumbUrl | needs_migration | `thumbUrl: resolveBestCoverUrl(post),` |
| L437 | displayPhotoLink | needs_migration | `displayPhotoLink: resolveBestCoverUrl(post),` |
| L444 | post.assets | needs_migration | `assets: post.assets,` |
| L519 | displayPhotoLink | needs_migration | `const direct = String(post.thumbUrl ?? post.displayPhotoLink ?? "").trim();` |
| L519 | thumbUrl | needs_migration | `const direct = String(post.thumbUrl ?? post.displayPhotoLink ?? "").trim();` |
| L521 | post.assets | needs_migration | `const assets = post.assets;` |
| L522 | assets[0] | needs_migration | `if (Array.isArray(assets) && assets[0] && typeof assets[0] === "object") {` |
| L523 | assets[0] | needs_migration | `const a0 = assets[0] as { poster?: unknown; thumbnail?: unknown; original?: unknown; url?: unknown; downloadURL?: unknown };` |
| L562 | photoLink | needs_migration | `thumbUrl: String(data.thumbUrl ?? data.displayPhotoLink ?? data.photoLink ?? "").trim(),` |
| L562 | displayPhotoLink | needs_migration | `thumbUrl: String(data.thumbUrl ?? data.displayPhotoLink ?? data.photoLink ?? "").trim(),` |
| L562 | thumbUrl | needs_migration | `thumbUrl: String(data.thumbUrl ?? data.displayPhotoLink ?? data.photoLink ?? "").trim(),` |
| L563 | photoLink | needs_migration | `displayPhotoLink: String(data.displayPhotoLink ?? data.thumbUrl ?? data.photoLink ?? "").trim(),` |
| L563 | displayPhotoLink | needs_migration | `displayPhotoLink: String(data.displayPhotoLink ?? data.thumbUrl ?? data.photoLink ?? "").trim(),` |
| L563 | thumbUrl | needs_migration | `displayPhotoLink: String(data.displayPhotoLink ?? data.thumbUrl ?? data.photoLink ?? "").trim(),` |

### Locava Backendv2/src/repositories/surfaces/achievements.repository.ts

| L391 | imageUrl | needs_migration | `imageUrl: firstNonEmptyString(raw.imageUrl),` |
| L2054 | imageUrl | needs_migration | `leagueIconUrl: league.imageUrl ?? null,` |

### Locava Backendv2/src/repositories/surfaces/feed-for-you-simple.repository.ts

| L22 | posterUrl | needs_migration | `posterUrl: string;` |
| L43 | posterUrl | needs_migration | `posterUrl: string \| null;` |
| L109 | thumbUrl | needs_migration | `"thumbUrl",` |
| L110 | displayPhotoLink | needs_migration | `"displayPhotoLink",` |
| L547 | thumbUrl | needs_migration | `thumbUrl: item.posterUrl,` |
| L547 | posterUrl | needs_migration | `thumbUrl: item.posterUrl,` |
| L548 | displayPhotoLink | needs_migration | `displayPhotoLink: item.posterUrl,` |
| L548 | posterUrl | needs_migration | `displayPhotoLink: item.posterUrl,` |
| L618 | posterUrl | needs_migration | `const posterUrl = pickString(` |
| L619 | displayPhotoLink | needs_migration | `data.displayPhotoLink,` |
| L620 | thumbUrl | needs_migration | `data.thumbUrl,` |
| L621 | posterUrl | needs_migration | `assets[0]?.posterUrl,` |
| L621 | assets[0] | needs_migration | `assets[0]?.posterUrl,` |
| L622 | assets[0] | needs_migration | `assets[0]?.previewUrl,` |
| L623 | assets[0] | needs_migration | `assets[0]?.originalUrl,` |
| L624 | assets[0] | needs_migration | `assets[0]?.mp4Url,` |
| L625 | assets[0] | needs_migration | `assets[0]?.streamUrl` |
| L627 | posterUrl | needs_migration | `if (!posterUrl) return { reject: "no_media" };` |
| L651 | posterUrl | needs_migration | `posterUrl,` |
| L652 | posterUrl | needs_migration | `firstAssetUrl: assets[0]?.originalUrl ?? assets[0]?.previewUrl ?? posterUrl,` |
| L652 | assets[0] | needs_migration | `firstAssetUrl: assets[0]?.originalUrl ?? assets[0]?.previewUrl ?? posterUrl,` |
| L836 | posterUrl | needs_migration | `posterUrl: pickString(raw.posterUrl, raw.poster, variants.poster, thumb.webp, raw.thumbnail, raw.original, raw.downloadURL, raw.url),` |

### Locava Backendv2/src/repositories/surfaces/feed-for-you.repository.ts

| L35 | posterUrl | needs_migration | `posterUrl: string;` |
| L56 | posterUrl | needs_migration | `posterUrl: string \| null;` |
| L96 | thumbUrl | needs_migration | `"thumbUrl",` |
| L97 | displayPhotoLink | needs_migration | `"displayPhotoLink",` |
| L320 | displayPhotoLink | needs_migration | `const posterUrl = pickString(data.displayPhotoLink, data.thumbUrl) ?? "";` |
| L320 | thumbUrl | needs_migration | `const posterUrl = pickString(data.displayPhotoLink, data.thumbUrl) ?? "";` |
| L320 | posterUrl | needs_migration | `const posterUrl = pickString(data.displayPhotoLink, data.thumbUrl) ?? "";` |
| L321 | posterUrl | needs_migration | `if (!posterUrl) return null;` |
| L338 | posterUrl | needs_migration | `posterUrl,` |
| L339 | posterUrl | needs_migration | `firstAssetUrl: assets[0]?.originalUrl ?? assets[0]?.previewUrl ?? posterUrl,` |
| L339 | assets[0] | needs_migration | `firstAssetUrl: assets[0]?.originalUrl ?? assets[0]?.previewUrl ?? posterUrl,` |
| L467 | posterUrl | needs_migration | `posterUrl: pickString(raw.posterUrl, raw.poster, variants.poster, thumb.webp, raw.thumbnail),` |

### Locava Backendv2/src/repositories/surfaces/feed.repository.test.ts

| L42 | posterUrl | test_fixture | `posterUrl: "https://example.com/poster.jpg",` |
| L66 | posterUrl | test_fixture | `posterUrl: "https://example.com/poster.jpg",` |
| L134 | thumbUrl | test_fixture | `thumbUrl: "https://example.com/thumb.jpg",` |

### Locava Backendv2/src/repositories/surfaces/feed.repository.ts

| L51 | posterUrl | needs_migration | `posterUrl: string \| null;` |
| L72 | posterUrl | needs_migration | `posterUrl: string;` |
| L99 | photoLink | needs_migration | `photoLink?: string \| null;` |
| L100 | displayPhotoLink | needs_migration | `displayPhotoLink?: string \| null;` |
| L140 | thumbUrl | needs_migration | `thumbUrl: string;` |
| L204 | posterUrl | needs_migration | `posterUrl: string;` |
| L228 | posterUrl | needs_migration | `posterUrl: string \| null;` |
| L276 | posterUrl | needs_migration | `posterUrl: candidate.posterUrl,` |
| L317 | posterUrl | needs_migration | `const posterUrl = 'https://cdn.locava.test/posts/${encodeURIComponent(postId)}/poster.jpg';` |
| L324 | posterUrl | needs_migration | `posterUrl,` |
| L325 | posterUrl | needs_migration | `firstAssetUrl: posterUrl,` |
| L340 | posterUrl | needs_migration | `previewUrl: posterUrl,` |
| L341 | posterUrl | needs_migration | `posterUrl,` |
| L342 | posterUrl | needs_migration | `originalUrl: posterUrl,` |
| L363 | thumbUrl | needs_migration | `const posterUrl = bundle.post.thumbUrl;` |
| L363 | posterUrl | needs_migration | `const posterUrl = bundle.post.thumbUrl;` |
| L364 | assets[0] | needs_migration | `const firstAsset = bundle.post.assets[0];` |
| L364 | post.assets | needs_migration | `const firstAsset = bundle.post.assets[0];` |
| L393 | post.assets | needs_migration | `assets: bundle.post.assets.map((asset) => ({` |
| L405 | posterUrl | needs_migration | `posterUrl: asset.poster,` |
| L448 | posterUrl | needs_migration | `posterUrl,` |
| L468 | assets[0] | needs_migration | `const firstAsset = bundle.post.assets[0];` |
| L468 | post.assets | needs_migration | `const firstAsset = bundle.post.assets[0];` |
| L482 | thumbUrl | needs_migration | `bundle.post.thumbUrl;` |
| L496 | post.assets | needs_migration | `assets: bundle.post.assets.map((asset) => ({` |
| L508 | posterUrl | needs_migration | `posterUrl: asset.poster,` |
| L536 | thumbUrl | needs_migration | `posterUrl: bundle.post.thumbUrl,` |
| L536 | posterUrl | needs_migration | `posterUrl: bundle.post.thumbUrl,` |
| L686 | thumbUrl | needs_migration | `posterUrl: bundle.post.thumbUrl,` |
| L686 | posterUrl | needs_migration | `posterUrl: bundle.post.thumbUrl,` |
| L687 | thumbUrl | needs_migration | `firstAssetUrl: bundle.post.assets[0]?.thumbnail ?? bundle.post.thumbUrl,` |
| L687 | assets[0] | needs_migration | `firstAssetUrl: bundle.post.assets[0]?.thumbnail ?? bundle.post.thumbUrl,` |
| L687 | post.assets | needs_migration | `firstAssetUrl: bundle.post.assets[0]?.thumbnail ?? bundle.post.thumbUrl,` |
| L698 | post.assets | needs_migration | `assets: bundle.post.assets.map((a) => ({` |
| L702 | posterUrl | needs_migration | `posterUrl: a.poster,` |
| L823 | thumbUrl | needs_migration | `thumbUrl: fromSource.post.thumbUrl,` |
| L827 | post.assets | needs_migration | `assets: fromSource.post.assets,` |
| L1055 | thumbUrl | needs_migration | `thumbUrl: profileById.data.thumbUrl,` |
| L1060 | thumbUrl | needs_migration | `poster: asset.poster ?? asset.thumbnail ?? profileById.data.thumbUrl,` |
| L1061 | thumbUrl | needs_migration | `thumbnail: asset.thumbnail ?? asset.poster ?? profileById.data.thumbUrl,` |

### Locava Backendv2/src/repositories/surfaces/map.repository.test.ts

| L53 | thumbUrl | test_fixture | `thumbUrl: null,` |

### Locava Backendv2/src/repositories/surfaces/map.repository.ts

| L52 | thumbUrl | needs_migration | `thumbUrl: marker.thumbnailUrl ?? null,` |
| L65 | thumbUrl | needs_migration | `thumbUrl: marker.thumbnailUrl ?? null,` |
| L66 | displayPhotoLink | needs_migration | `displayPhotoLink: marker.thumbnailUrl ?? null,` |

### Locava Backendv2/src/repositories/surfaces/notifications.repository.test.ts

| L53 | notification | test_fixture | `it("reuses cached notification read-state instead of refetching the doc", async () => {` |
| L84 | notification | test_fixture | `if (key === "notification:viewer-1:notif-1:read-state") {` |
| L109 | notification | test_fixture | `it("does not count chat notifications toward the notification unread badge", async () => {` |

### Locava Backendv2/src/repositories/surfaces/notifications.repository.ts

| L2 | notification | needs_migration | `import type { NotificationSummary } from "../../contracts/entities/notification-entities.contract.js";` |
| L285 | notification | needs_migration | `return 'notification:${viewerId}:${notificationId}:read-state';` |
| L346 | thumbUrl | needs_migration | `thumbUrl: typeof metadata.postThumbUrl === "string" ? metadata.postThumbUrl : null` |
| L714 | displayPhotoLink | needs_migration | `asTrimmedString(postData.displayPhotoLink) ??` |
| L715 | photoLink | needs_migration | `asTrimmedString(postData.photoLink) ??` |
| L1185 | thumbUrl | needs_migration | `thumbUrl: typeof metadata.postThumbUrl === "string" ? metadata.postThumbUrl : null` |

### Locava Backendv2/src/repositories/surfaces/profile-post-detail.repository.test.ts

| L37 | thumbUrl | test_fixture | `thumbUrl: "https://thumb",` |

### Locava Backendv2/src/repositories/surfaces/profile-post-detail.repository.ts

| L25 | thumbUrl | needs_migration | `thumbUrl: string;` |
| L106 | thumbUrl | needs_migration | `const thumbUrl = 'https://picsum.photos/seed/${encodeURIComponent('${userId}-${safeIndex}')}/500/888';` |
| L114 | thumbUrl | needs_migration | `poster: thumbUrl,` |
| L115 | thumbUrl | needs_migration | `thumbnail: thumbUrl,` |
| L127 | thumbUrl | needs_migration | `poster: thumbUrl,` |
| L128 | thumbUrl | needs_migration | `thumbnail: thumbUrl` |
| L141 | thumbUrl | needs_migration | `thumbUrl,` |
| L162 | thumbUrl | needs_migration | `thumbUrl,` |
| L163 | displayPhotoLink | needs_migration | `displayPhotoLink: thumbUrl,` |
| L163 | thumbUrl | needs_migration | `displayPhotoLink: thumbUrl,` |

### Locava Backendv2/src/repositories/surfaces/profile.repository.test.ts

| L48 | thumbUrl | test_fixture | `items: [{ postId: "u-1-post-1", thumbUrl: "https://thumb", mediaType: "image", updatedAtMs: Date.now() }],` |

### Locava Backendv2/src/repositories/surfaces/profile.repository.ts

| L48 | thumbUrl | needs_migration | `thumbUrl: string;` |

### Locava Backendv2/src/repositories/surfaces/search.repository.ts

| L15 | thumbUrl | needs_migration | `thumbUrl: string;` |
| L16 | displayPhotoLink | needs_migration | `displayPhotoLink: string;` |

### Locava Backendv2/src/routes/compat/legacy-api-stubs.routes.ts

| L22 | notification | needs_migration | `import { mapV2NotificationListToLegacyItems } from "./map-v2-notification-to-legacy-product.js";` |
| L69 | thumbUrl | needs_migration | `rows: Array<{ userId: string; postId: string; thumbUrl: string }>;` |
| L83 | thumbUrl | needs_migration | `async function loadRecentPostsForStoryUsers(): Promise<Array<{ userId: string; postId: string; thumbUrl: string }>> {` |
| L89 | thumbUrl | needs_migration | `const rows: Array<{ userId: string; postId: string; thumbUrl: string }> = [];` |
| L96 | photoLink | needs_migration | `const thumbUrl = String(data.thumbUrl ?? data.displayPhotoLink ?? data.photoLink ?? "").trim();` |
| L96 | displayPhotoLink | needs_migration | `const thumbUrl = String(data.thumbUrl ?? data.displayPhotoLink ?? data.photoLink ?? "").trim();` |
| L96 | thumbUrl | needs_migration | `const thumbUrl = String(data.thumbUrl ?? data.displayPhotoLink ?? data.photoLink ?? "").trim();` |
| L97 | thumbUrl | needs_migration | `rows.push({ userId, postId, thumbUrl });` |
| L213 | photoLink | needs_migration | `thumbUrl: String(data.thumbUrl ?? data.displayPhotoLink ?? data.photoLink ?? ""),` |
| L213 | displayPhotoLink | needs_migration | `thumbUrl: String(data.thumbUrl ?? data.displayPhotoLink ?? data.photoLink ?? ""),` |
| L213 | thumbUrl | needs_migration | `thumbUrl: String(data.thumbUrl ?? data.displayPhotoLink ?? data.photoLink ?? ""),` |
| L214 | photoLink | needs_migration | `displayPhotoLink: String(data.displayPhotoLink ?? data.thumbUrl ?? data.photoLink ?? "")` |
| L214 | displayPhotoLink | needs_migration | `displayPhotoLink: String(data.displayPhotoLink ?? data.thumbUrl ?? data.photoLink ?? "")` |
| L214 | thumbUrl | needs_migration | `displayPhotoLink: String(data.displayPhotoLink ?? data.thumbUrl ?? data.photoLink ?? "")` |
| L667 | thumbUrl | needs_migration | `const latestByUser = new Map<string, { postId: string; thumbUrl: string }>();` |
| L672 | thumbUrl | needs_migration | `latestByUser.set(userId, { postId: row.postId, thumbUrl: row.thumbUrl });` |
| L695 | thumbUrl | needs_migration | `thumbUrl: post.thumbUrl,` |
| L1450 | displayPhotoLink | needs_migration | `thumbUrl: String(post.thumbUrl ?? post.displayPhotoLink ?? ""),` |
| L1450 | thumbUrl | needs_migration | `thumbUrl: String(post.thumbUrl ?? post.displayPhotoLink ?? ""),` |
| L1451 | displayPhotoLink | needs_migration | `displayPhotoLink: String(post.displayPhotoLink ?? post.thumbUrl ?? ""),` |
| L1451 | thumbUrl | needs_migration | `displayPhotoLink: String(post.displayPhotoLink ?? post.thumbUrl ?? ""),` |
| L1911 | imageUrl | needs_migration | `return reply.send({ success: true, displayPhotoUrl: uploaded.url, imageUrl: uploaded.url });` |
| L1914 | imageUrl | needs_migration | `const imageUrl =` |
| L1915 | imageUrl | needs_migration | `typeof raw.imageUrl === "string"` |
| L1916 | imageUrl | needs_migration | `? raw.imageUrl` |
| L1922 | imageUrl | needs_migration | `return reply.send({ success: true, imageUrl });` |
| L1943 | imageUrl | needs_migration | `: typeof raw.imageUrl === "string"` |
| L1944 | imageUrl | needs_migration | `? raw.imageUrl` |
| L2000 | imageUrl | needs_migration | `return reply.send({ success: true, displayPhotoUrl: uploaded.url, imageUrl: uploaded.url });` |
| L2014 | imageUrl | needs_migration | `: typeof raw.imageUrl === "string"` |
| L2015 | imageUrl | needs_migration | `? raw.imageUrl` |
| L2126 | displayPhotoLink | needs_migration | `const thumb = String(post.thumbUrl ?? post.displayPhotoLink ?? "").trim();` |
| L2126 | thumbUrl | needs_migration | `const thumb = String(post.thumbUrl ?? post.displayPhotoLink ?? "").trim();` |
| L2154 | displayPhotoLink | needs_migration | `.map((post) => String(post.thumbUrl ?? post.displayPhotoLink ?? "").trim())` |
| L2154 | thumbUrl | needs_migration | `.map((post) => String(post.thumbUrl ?? post.displayPhotoLink ?? "").trim())` |
| L2290 | imageUrl | needs_migration | `: typeof raw.imageUrl === "string"` |
| L2291 | imageUrl | needs_migration | `? raw.imageUrl` |
| L2772 | thumbUrl | needs_migration | `thumbUrl: String(m.thumbUrl ?? ""),` |
| L2999 | imageUrl | needs_migration | `coverUrl: typeof raw.imageUrl === "string" ? raw.imageUrl : typeof raw.coverUrl === "string" ? raw.coverUrl : undefined` |

### Locava Backendv2/src/routes/compat/legacy-monolith-notifications-proxy.routes.ts

| L16 | notification | needs_migration | `"Legacy notification mutation/push routes are monolith-backed. Set LEGACY_MONOLITH_PROXY_BASE_URL to enable /api/notifications parity."` |

### Locava Backendv2/src/routes/compat/legacy-product-bootstrap.ts

| L39 | thumbUrl | needs_migration | `thumbUrl: string;` |
| L65 | thumbUrl | needs_migration | `thumbUrl: it.thumbUrl,` |

### Locava Backendv2/src/routes/compat/legacy-reels-near-me.routes.ts

| L193 | post.assets | needs_migration | `const assets = post.assets;` |
| L195 | assets[0] | needs_migration | `const first = assets[0] as Record<string, unknown> \| undefined;` |
| L322 | post.assets | needs_migration | `const assets = Array.isArray(post.assets) ? (post.assets as Array<Record<string, unknown>>) : [];` |
| L323 | assets[0] | needs_migration | `const firstAsset = assets[0];` |
| L328 | posterUrl | needs_migration | `const posterUrl =` |
| L333 | displayPhotoLink | needs_migration | `normalizeUrl(post.displayPhotoLink) ??` |
| L392 | posterUrl | needs_migration | `posterUrl,` |

### Locava Backendv2/src/routes/compat/map-v2-notification-to-legacy-product.test.ts

| L2 | notification | test_fixture | `import { mapV2NotificationRowToLegacyProductItem } from "./map-v2-notification-to-legacy-product.js";` |
| L15 | thumbUrl | test_fixture | `preview: { text: "liked your post", thumbUrl: "https://cdn.example/t.jpg" }` |
| L37 | thumbUrl | test_fixture | `preview: { text: "started following you", thumbUrl: null }` |

### Locava Backendv2/src/routes/compat/map-v2-notification-to-legacy-product.ts

| L2 | notification | needs_migration | `* Maps Backendv2 notification list payload ('data' envelope) to legacy` |
| L24 | thumbUrl | needs_migration | `const u = preview && typeof preview.thumbUrl === "string" ? preview.thumbUrl.trim() : "";` |
| L34 | notification | needs_migration | `/** One notification row for legacy product JSON ('NotificationItem'-compatible). */` |
| L63 | notification | needs_migration | `message: previewText(n) \|\| 'Notification ${index + 1}',` |

### Locava Backendv2/src/routes/contracts.ts

| L128 | profile grid | needs_migration | `{ method: "GET", path: "/v2/profiles/:userId/grid", description: "V2 profile grid pagination surface", tags: ["v2", "profile"], querySchema: { cursor: "string optional", limit: "number (6-24) optional` |
| L589 | map marker | needs_migration | `description: "V2 map marker-index bootstrap read surface",` |

### Locava Backendv2/src/routes/debug/local-debug.routes.ts

| L11 | notification | needs_migration | `import { legacyNotificationPushPublisher } from "../../services/notifications/legacy-notification-push.publisher.js";` |
| L36 | notification | needs_migration | `commentText: z.string().min(1).default("Testing Backend v2 comment notification deep link"),` |
| L40 | notification | needs_migration | `messageText: z.string().min(1).default("Testing Backend v2 realtime chat notification"),` |

### Locava Backendv2/src/routes/debug/post-rebuilder.routes.ts

| L46 | media.assets | needs_migration | `const c=d.canonicalPreview\|\|{};const media=(c.media\|\|{});const assets=(media.assets\|\|[]).map(a=>a.type==='video'?{id:a.id,type:a.type,default:a.video?.playback?.defaultUrl,primary:a.video?.playback?.p` |
| L47 | media.assets | needs_migration | `el("media").textContent=json({cover:media.cover,assetCount:media.assetCount,assetsReady:media.assetsReady,instantPlaybackReady:media.instantPlaybackReady,rawAssetCount:media.rawAssetCount,hasMultipleA` |
| L134 | photoLink | compatibility_alias_only | `Boolean(normalized.canonical.compatibility.photoLink) &&` |
| L135 | displayPhotoLink | compatibility_alias_only | `Boolean(normalized.canonical.compatibility.displayPhotoLink) &&` |
| L136 | photoLinks2 | compatibility_alias_only | `Boolean(normalized.canonical.compatibility.photoLinks2 ?? normalized.canonical.compatibility.fallbackVideoUrl),` |
| L136 | fallbackVideoUrl | needs_migration | `Boolean(normalized.canonical.compatibility.photoLinks2 ?? normalized.canonical.compatibility.fallbackVideoUrl),` |
| L137 | media.assets | needs_migration | `hasMp4ImageAssets: normalized.canonical.media.assets.some(` |

### Locava Backendv2/src/routes/public/expo-push.routes.ts

| L45 | imageUrl | needs_migration | `const imageUrl = asTrimmedString(rawBody.imageUrl);` |
| L58 | notification | needs_migration | `return reply.status(400).send(failure("validation_error", "Missing 'body' (notification message text)"));` |
| L73 | imageUrl | needs_migration | `if (imageUrl && /^https?:\/\//i.test(imageUrl)) {` |
| L75 | imageUrl | needs_migration | `expoMessage.richContent = { image: imageUrl };` |
| L76 | imageUrl | needs_migration | `data.imageUrl = imageUrl;` |
| L77 | imageUrl | needs_migration | `data._richContent = JSON.stringify({ image: imageUrl });` |

### Locava Backendv2/src/routes/v2/collections-detail.routes.test.ts

| L104 | posterUrl | test_fixture | `const makeRow = (postId: string, posterUrl: string) => ({` |
| L111 | posterUrl | test_fixture | `posterUrl,` |
| L112 | posterUrl | test_fixture | `firstAssetUrl: posterUrl,` |
| L127 | posterUrl | test_fixture | `previewUrl: posterUrl,` |
| L128 | posterUrl | test_fixture | `posterUrl,` |
| L129 | posterUrl | test_fixture | `originalUrl: posterUrl,` |
| L140 | displayPhotoLink | test_fixture | `sourcePost: { postId, thumbUrl: posterUrl, displayPhotoLink: posterUrl, userId: 'author-${postId}' },` |
| L140 | thumbUrl | test_fixture | `sourcePost: { postId, thumbUrl: posterUrl, displayPhotoLink: posterUrl, userId: 'author-${postId}' },` |
| L140 | posterUrl | test_fixture | `sourcePost: { postId, thumbUrl: posterUrl, displayPhotoLink: posterUrl, userId: 'author-${postId}' },` |
| L141 | displayPhotoLink | test_fixture | `rawPost: { postId, thumbUrl: posterUrl, displayPhotoLink: posterUrl, userId: 'author-${postId}' },` |
| L141 | thumbUrl | test_fixture | `rawPost: { postId, thumbUrl: posterUrl, displayPhotoLink: posterUrl, userId: 'author-${postId}' },` |
| L141 | posterUrl | test_fixture | `rawPost: { postId, thumbUrl: posterUrl, displayPhotoLink: posterUrl, userId: 'author-${postId}' },` |
| L185 | posterUrl | test_fixture | `expect(body.data.posts.items[0].media.posterUrl).toBe("https://cdn.locava.test/posts/post-1.jpg");` |
| L186 | assets[0] | test_fixture | `expect(body.data.posts.items[0].assets[0].originalUrl).toBe("https://cdn.locava.test/posts/post-1.jpg");` |
| L188 | posterUrl | test_fixture | `expect(body.data.recommended.items.every((item: { media: { posterUrl: string } }) => item.media.posterUrl.startsWith("https://"))).toBe(true);` |
| L222 | posterUrl | test_fixture | `const posterUrl = postId === "post-bad" ? "" : 'https://cdn.locava.test/posts/${postId}.jpg';` |
| L230 | posterUrl | test_fixture | `posterUrl,` |
| L231 | posterUrl | test_fixture | `firstAssetUrl: posterUrl \|\| null,` |
| L242 | posterUrl | test_fixture | `assets: posterUrl` |
| L247 | posterUrl | test_fixture | `previewUrl: posterUrl,` |
| L248 | posterUrl | test_fixture | `posterUrl,` |
| L249 | posterUrl | test_fixture | `originalUrl: posterUrl,` |
| L261 | displayPhotoLink | test_fixture | `sourcePost: { postId, thumbUrl: posterUrl, displayPhotoLink: posterUrl },` |
| L261 | thumbUrl | test_fixture | `sourcePost: { postId, thumbUrl: posterUrl, displayPhotoLink: posterUrl },` |
| L261 | posterUrl | test_fixture | `sourcePost: { postId, thumbUrl: posterUrl, displayPhotoLink: posterUrl },` |
| L262 | displayPhotoLink | test_fixture | `rawPost: { postId, thumbUrl: posterUrl, displayPhotoLink: posterUrl },` |
| L262 | thumbUrl | test_fixture | `rawPost: { postId, thumbUrl: posterUrl, displayPhotoLink: posterUrl },` |
| L262 | posterUrl | test_fixture | `rawPost: { postId, thumbUrl: posterUrl, displayPhotoLink: posterUrl },` |
| L277 | posterUrl | test_fixture | `media: { type: "image", posterUrl: "https://cdn.locava.test/posts/post-4.jpg", aspectRatio: 1, startupHint: "poster_only" },` |
| L297 | posterUrl | test_fixture | `expect(body.data.items[0].media.posterUrl).toBe("https://cdn.locava.test/posts/post-4.jpg");` |

### Locava Backendv2/src/routes/v2/collections-v2.routes.ts

| L59 | imageUrl | needs_migration | `imageUrl: HttpsCoverUrlSchema.optional()` |
| L106 | thumbUrl | needs_migration | `thumbUrl: string;` |
| L107 | displayPhotoLink | needs_migration | `displayPhotoLink: string;` |
| L117 | displayPhotoLink | needs_migration | `const posterUrl = String(row.thumbUrl \|\| row.displayPhotoLink \|\| "").trim();` |
| L117 | thumbUrl | needs_migration | `const posterUrl = String(row.thumbUrl \|\| row.displayPhotoLink \|\| "").trim();` |
| L117 | posterUrl | needs_migration | `const posterUrl = String(row.thumbUrl \|\| row.displayPhotoLink \|\| "").trim();` |
| L133 | posterUrl | needs_migration | `firstAssetUrl: /^https?:\/\//i.test(posterUrl) ? posterUrl : null,` |
| L136 | posterUrl | needs_migration | `posterUrl,` |
| L220 | posterUrl | needs_migration | `card.posterUrl,` |
| L221 | thumbUrl | needs_migration | `card.thumbUrl,` |
| L222 | displayPhotoLink | needs_migration | `card.displayPhotoLink,` |
| L223 | posterUrl | needs_migration | `media?.posterUrl,` |
| L224 | posterUrl | needs_migration | `normalizedMedia?.posterUrl,` |
| L234 | posterUrl | needs_migration | `return [asset.originalUrl, asset.previewUrl, asset.posterUrl, asset.mp4Url, asset.streamUrl].some(` |
| L289 | posterUrl | needs_migration | `posterUrl: row.posterUrl,` |
| L290 | assets[0] | needs_migration | `aspectRatio: row.assets[0]?.aspectRatio ?? 9 / 16,` |
| L546 | posterUrl | needs_migration | `const posterUrl = String(item.media?.posterUrl ?? "").trim();` |
| L547 | posterUrl | needs_migration | `if (!/^https?:\/\//i.test(posterUrl)) continue;` |
| L667 | displayPhotoLink | needs_migration | `const u = first ? String(first.thumbUrl ?? first.displayPhotoLink ?? "").trim() : "";` |
| L667 | thumbUrl | needs_migration | `const u = first ? String(first.thumbUrl ?? first.displayPhotoLink ?? "").trim() : "";` |
| L880 | posterUrl | needs_migration | `.filter((row) => /^https?:\/\//i.test(String(row.media?.posterUrl ?? "")));` |
| L977 | imageUrl | needs_migration | `coverUri = String(raw.coverUri ?? raw.url ?? raw.imageUrl ?? "").trim();` |
| L1081 | collection post | needs_migration | `// invalidation: delete invalidates viewer collection list, collection detail, and collection post pages.` |

### Locava Backendv2/src/routes/v2/feed-bootstrap.routes.test.ts

| L113 | posterUrl | test_fixture | `expect(String(media.posterUrl ?? "").length).toBeGreaterThan(0);` |

### Locava Backendv2/src/routes/v2/feed-for-you-simple.routes.test.ts

| L78 | thumbUrl | test_fixture | `thumbUrl: omitMedia ? "" : 'https://cdn.locava.test/posts/${postId}/thumb.jpg',` |
| L79 | displayPhotoLink | test_fixture | `displayPhotoLink: omitMedia ? "" : 'https://cdn.locava.test/posts/${postId}/display.jpg',` |
| L602 | thumbUrl | test_fixture | `thumbUrl: "",` |
| L603 | displayPhotoLink | test_fixture | `displayPhotoLink: "",` |

### Locava Backendv2/src/routes/v2/feed-for-you.routes.test.ts

| L33 | displayPhotoLink | test_fixture | `displayPhotoLink: 'https://cdn.locava.test/posts/${postId}/display.jpg',` |
| L34 | thumbUrl | test_fixture | `thumbUrl: 'https://cdn.locava.test/posts/${postId}/thumb.jpg',` |
| L68 | displayPhotoLink | test_fixture | `displayPhotoLink: 'https://cdn.locava.test/posts/${postId}/display.jpg',` |
| L69 | thumbUrl | test_fixture | `thumbUrl: 'https://cdn.locava.test/posts/${postId}/thumb.jpg',` |

### Locava Backendv2/src/routes/v2/feed-page.routes.test.ts

| L205 | posterUrl | test_fixture | `expect(String(media.posterUrl ?? "").length).toBeGreaterThan(0);` |

### Locava Backendv2/src/routes/v2/map-markers.routes.ts

| L28 | posterUrl | needs_migration | `posterUrl: String(marker.thumbnailUrl ?? "").trim(),` |
| L47 | thumbUrl | needs_migration | `thumbUrl: marker.thumbnailUrl ?? null,` |
| L48 | displayPhotoLink | needs_migration | `displayPhotoLink: marker.thumbnailUrl ?? null,` |

### Locava Backendv2/src/routes/v2/notifications.routes.test.ts

| L91 | notification | test_fixture | `it("invalidates deeper cached notification pages after read-state mutations", async () => {` |

### Locava Backendv2/src/routes/v2/posting-staging-presign.routes.ts

| L73 | posterUrl | needs_migration | `posterUrl?: string;` |
| L186 | posterUrl | needs_migration | `posterUrl?: string;` |

### Locava Backendv2/src/routes/v2/posting.routes.test.ts

| L346 | displayPhotoLink | test_fixture | `const displayPhotoLink = String(postRow["displayPhotoLink"] ?? "");` |
| L347 | displayPhotoLink | test_fixture | `expect(displayPhotoLink.includes("postSessionStaging")).toBe(false);` |

### Locava Backendv2/src/routes/v2/posts-detail.routes.test.ts

| L23 | post.assets | test_fixture | `expect(Array.isArray(body.data.firstRender.post.assets)).toBe(true);` |
| L112 | thumbUrl | test_fixture | `expect(typeof first?.thumbUrl).toBe("string");` |
| L113 | thumbUrl | test_fixture | `expect(String(first?.thumbUrl ?? "").length).toBeGreaterThan(0);` |

### Locava Backendv2/src/routes/v2/profile-grid.routes.test.ts

| L6 | profile grid | test_fixture | `describe("v2 profile grid route", () => {` |
| L9 | profile grid | test_fixture | `it("allows anonymous viewer for profile grid (surface not internal-gated)", async () => {` |

### Locava Backendv2/src/routes/v2/profile-post-detail.routes.test.ts

| L29 | post.assets | test_fixture | `expect(Array.isArray(body.data.firstRender.post.assets)).toBe(true);` |
| L30 | post.assets | test_fixture | `expect(body.data.firstRender.post.assets.length).toBeGreaterThan(0);` |

### Locava Backendv2/src/routes/v2/search-discovery.routes.ts

| L306 | displayPhotoLink | needs_migration | `thumbUrl: String(post.thumbUrl ?? post.displayPhotoLink ?? ""),` |
| L306 | thumbUrl | needs_migration | `thumbUrl: String(post.thumbUrl ?? post.displayPhotoLink ?? ""),` |
| L307 | displayPhotoLink | needs_migration | `displayPhotoLink: String(post.displayPhotoLink ?? post.thumbUrl ?? ""),` |
| L307 | thumbUrl | needs_migration | `displayPhotoLink: String(post.displayPhotoLink ?? post.thumbUrl ?? ""),` |
| L330 | thumbUrl | needs_migration | `const coverUri = String(item.coverPhotoUrl ?? item.coverUri ?? item.thumbUrl ?? "");` |
| L511 | displayPhotoLink | needs_migration | `.map((p) => String((p as any)?.thumbUrl ?? (p as any)?.displayPhotoLink ?? "").trim())` |
| L511 | thumbUrl | needs_migration | `.map((p) => String((p as any)?.thumbUrl ?? (p as any)?.displayPhotoLink ?? "").trim())` |

### Locava Backendv2/src/routes/v2/search-results.routes.test.ts

| L36 | posterUrl | test_fixture | `expect(body.data.items[0].media.posterUrl).toBeTruthy();` |

### Locava Backendv2/src/services/mixes/mixCover.service.ts

| L21 | photoLink | unknown | `/** 'photoLink' is often comma-separated in Locava — match liftable 'getHeroUri' behavior. */` |
| L42 | photoLink | unknown | `* First hero still URL aligned with native 'getHeroUri': displayPhotoLink / photoLink / thumbUrl,` |
| L42 | displayPhotoLink | unknown | `* First hero still URL aligned with native 'getHeroUri': displayPhotoLink / photoLink / thumbUrl,` |
| L42 | thumbUrl | unknown | `* First hero still URL aligned with native 'getHeroUri': displayPhotoLink / photoLink / thumbUrl,` |
| L43 | assets[0] | unknown | `* then assets[0] with image tier order sm→md→thumb→lg and video posters (never raw MP4 previews for tiles).` |
| L47 | assets[0] | unknown | `if (!Array.isArray(assets) \|\| assets.length === 0 \|\| typeof assets[0] !== "object" \|\| !assets[0]) {` |
| L50 | assets[0] | unknown | `const a0 = assets[0] as Record<string, unknown>;` |
| L93 | displayPhotoLink | unknown | `obj.displayPhotoLink,` |
| L94 | photoLink | unknown | `obj.photoLink,` |
| L95 | thumbUrl | unknown | `obj.thumbUrl,` |
| L100 | imageUrl | unknown | `obj.imageUrl,` |
| L101 | posterUrl | unknown | `media.posterUrl,` |

### Locava Backendv2/src/services/mixes/mixes.service.test.ts

| L15 | thumbUrl | test_fixture | `thumbUrl: "https://cdn/p4.jpg",` |
| L27 | thumbUrl | test_fixture | `thumbUrl: "https://cdn/p3.jpg",` |
| L39 | thumbUrl | test_fixture | `thumbUrl: "https://cdn/p2.jpg",` |
| L51 | thumbUrl | test_fixture | `thumbUrl: "https://cdn/p1.jpg",` |
| L127 | thumbUrl | test_fixture | `thumbUrl: "",` |
| L128 | displayPhotoLink | test_fixture | `displayPhotoLink: "",` |
| L137 | thumbUrl | test_fixture | `thumbUrl: "https://cdn/beach.jpg",` |
| L218 | thumbUrl | test_fixture | `thumbUrl: "https://cdn/a1.jpg",` |
| L226 | thumbUrl | test_fixture | `thumbUrl: "https://cdn/a2.jpg",` |
| L234 | thumbUrl | test_fixture | `thumbUrl: "https://cdn/a3.jpg",` |
| L265 | thumbUrl | test_fixture | `thumbUrl: "https://cdn/g1.jpg",` |
| L275 | thumbUrl | test_fixture | `thumbUrl: "https://cdn/g2.jpg",` |
| L285 | thumbUrl | test_fixture | `thumbUrl: "https://cdn/g3.jpg",` |
| L325 | thumbUrl | test_fixture | `thumbUrl: "https://cdn/al1.jpg",` |
| L335 | thumbUrl | test_fixture | `thumbUrl: "https://cdn/al2.jpg",` |
| L345 | thumbUrl | test_fixture | `thumbUrl: "https://cdn/al3.jpg",` |
| L355 | thumbUrl | test_fixture | `thumbUrl: "https://cdn/other.jpg",` |
| L438 | thumbUrl | test_fixture | `thumbUrl: "https://cdn/px.jpg",` |
| L486 | fallbackVideoUrl | test_fixture | `fallbackVideoUrl: "https://cdn/ready_original.mp4",` |
| L487 | thumbUrl | test_fixture | `thumbUrl: "https://cdn/ready_poster.jpg",` |
| L500 | fallbackVideoUrl | test_fixture | `fallbackVideoUrl: "https://cdn/processing_original.mp4",` |
| L501 | thumbUrl | test_fixture | `thumbUrl: "https://cdn/processing_poster.jpg",` |
| L532 | fallbackVideoUrl | test_fixture | `expect(Boolean(ready.playbackUrl \|\| ready.fallbackVideoUrl)).toBe(true);` |
| L536 | fallbackVideoUrl | test_fixture | `expect(typeof processing.fallbackVideoUrl).toBe("string");` |

### Locava Backendv2/src/services/mixes/mixes.service.ts

| L196 | assets[0] | unknown | `const first = assets[0] ?? {};` |
| L199 | thumbUrl | unknown | `normalizeText((row as any).thumbUrl) ??` |
| L200 | displayPhotoLink | unknown | `normalizeText((row as any).displayPhotoLink) ??` |
| L202 | photoLink | unknown | `normalizeText((row as any).photoLink) ??` |
| L206 | posterUrl | unknown | `normalizeText(first.posterUrl);` |
| L258 | assets[0] | unknown | `const first = assets[0] ?? {};` |
| L268 | thumbUrl | unknown | `normalizeText((row as any).thumbUrl) ??` |
| L269 | displayPhotoLink | unknown | `normalizeText((row as any).displayPhotoLink) ??` |
| L271 | photoLink | unknown | `normalizeText((row as any).photoLink) ??` |
| L275 | posterUrl | unknown | `normalizeText(first.posterUrl) ??` |
| L293 | fallbackVideoUrl | unknown | `const fallbackVideoUrl =` |
| L294 | fallbackVideoUrl | unknown | `normalizeText((row as any).fallbackVideoUrl) ??` |
| L295 | fallbackVideoUrl | unknown | `normalizeText(mediaReadiness.fallbackVideoUrl);` |
| L334 | posterUrl | unknown | `posterUrl: poster,` |
| L347 | posterUrl | unknown | `posterUrl: poster \|\| null,` |
| L370 | fallbackVideoUrl | unknown | `fallbackVideoUrl: fallbackVideoUrl ?? null,` |
| L371 | posterUrl | unknown | `posterUrl: poster \|\| null,` |

### Locava Backendv2/src/services/mixes/v2/searchMixes.service.test.ts

| L18 | displayPhotoLink | test_fixture | `displayPhotoLink: 'https://cdn.locava.test/${input.postId}.jpg',` |
| L19 | thumbUrl | test_fixture | `thumbUrl: 'https://cdn.locava.test/${input.postId}-thumb.jpg',` |

### Locava Backendv2/src/services/mutations/posting-mutation.service.test.ts

| L218 | posterUrl | test_fixture | `posterUrl: "https://cdn.example.com/poster.jpg",` |
| L255 | assets[0] | test_fixture | `expect(assets[0]?.original).toBe("https://cdn.example.com/video.mp4");` |
| L256 | assets[0] | test_fixture | `expect(assets[0]?.poster).toBe("https://cdn.example.com/poster.jpg");` |
| L377 | posterUrl | test_fixture | `posterUrl: "https://cdn.example.com/native_poster.jpg",` |
| L392 | assets[0] | test_fixture | `expect(assets[0]?.variants?.main720).toBeUndefined();` |

### Locava Backendv2/src/services/mutations/posting-mutation.service.ts

| L49 | posterUrl | unknown | `posterUrl?: string;` |
| L907 | posterUrl | unknown | `...(item.posterUrl ? { posterUrl: item.posterUrl } : {})` |
| L927 | posterUrl | unknown | `...(finalized.posterUrl ? { posterUrl: finalized.posterUrl } : {})` |
| L1058 | posterUrl | unknown | `posterUrl?: string;` |
| L1226 | fallbackVideoUrl | unknown | `...(readiness.fallbackVideoUrl ? { fallbackVideoUrl: readiness.fallbackVideoUrl } : {}),` |
| L1229 | posterUrl | unknown | `...(readiness.posterUrl ? { posterUrl: readiness.posterUrl } : {}),` |
| L1253 | fallbackVideoUrl | unknown | `...(readiness.fallbackVideoUrl ? { fallbackVideoUrl: readiness.fallbackVideoUrl } : {}),` |
| L1256 | posterUrl | unknown | `...(readiness.posterUrl ? { posterUrl: readiness.posterUrl } : {}),` |
| L1354 | post.assets | unknown | `const assets = Array.isArray(post.assets) ? (post.assets as Record<string, unknown>[]) : [];` |
| L1391 | fallbackVideoUrl | unknown | `...(readiness.fallbackVideoUrl ? { fallbackVideoUrl: readiness.fallbackVideoUrl } : {}),` |
| L1394 | posterUrl | unknown | `...(readiness.posterUrl ? { posterUrl: readiness.posterUrl } : {}),` |
| L1446 | displayPhotoLink | unknown | `const displayPhotoLink = String(row.displayPhotoLink ?? "").trim();` |
| L1447 | displayPhotoLink | unknown | `if (displayPhotoLink) urls.add(displayPhotoLink);` |
| L1538 | imageUrl | unknown | `const imageUrl = 'https://media.locava.test/images/${postId}_lg.webp';` |
| L1553 | imageUrl | unknown | `original: imageUrl,` |
| L1555 | imageUrl | unknown | `thumb: { webp: imageUrl, w: 180, h: 320 },` |
| L1556 | imageUrl | unknown | `sm: { webp: imageUrl, w: 360, h: 640 },` |
| L1557 | imageUrl | unknown | `md: { webp: imageUrl, w: 720, h: 1280 },` |
| L1558 | imageUrl | unknown | `lg: { webp: imageUrl, w: 1080, h: 1920 },` |
| L1559 | imageUrl | unknown | `fallbackJpg: { jpg: imageUrl.replace(".webp", ".jpg") }` |
| L1568 | displayPhotoLink | unknown | `displayPhotoLink: imageUrl,` |
| L1568 | imageUrl | unknown | `displayPhotoLink: imageUrl,` |
| L1569 | photoLink | unknown | `photoLink: imageUrl,` |
| L1569 | imageUrl | unknown | `photoLink: imageUrl,` |
| L1570 | photoLinks2 | unknown | `photoLinks2: imageUrl,` |
| L1570 | imageUrl | unknown | `photoLinks2: imageUrl,` |
| L1571 | photoLinks3 | unknown | `photoLinks3: imageUrl,` |
| L1571 | imageUrl | unknown | `photoLinks3: imageUrl,` |
| L1573 | photoLink | unknown | `photoLink: imageUrl,` |
| L1573 | imageUrl | unknown | `photoLink: imageUrl,` |
| L1574 | photoLinks2 | unknown | `photoLinks2: imageUrl,` |
| L1574 | imageUrl | unknown | `photoLinks2: imageUrl,` |
| L1575 | photoLinks3 | unknown | `photoLinks3: imageUrl` |
| L1575 | imageUrl | unknown | `photoLinks3: imageUrl` |

### Locava Backendv2/src/services/notifications/legacy-notification-push.publisher.test.ts

| L2 | notification | test_fixture | `import { buildLegacyExpoPushPayload } from "./legacy-notification-push.publisher.js";` |
| L4 | notification | test_fixture | `describe("legacy notification push publisher", () => {` |
| L106 | imageUrl | test_fixture | `imageUrl: "https://cdn.example.com/post-thumb.jpg",` |
| L122 | imageUrl | test_fixture | `imageUrl: "https://cdn.example.com/profile.jpg",` |
| L134 | imageUrl | test_fixture | `imageUrl: "https://cdn.example.com/profile.jpg",` |
| L151 | imageUrl | test_fixture | `expect((payload.data as Record<string, unknown>).imageUrl).toBeUndefined();` |

### Locava Backendv2/src/services/notifications/legacy-notification-push.publisher.ts

| L109 | imageUrl | unknown | `metadata.imageUrl,` |
| L111 | thumbUrl | unknown | `metadata.thumbUrl,` |
| L113 | displayPhotoLink | unknown | `metadata.displayPhotoLink,` |
| L116 | imageUrl | unknown | `pushData.imageUrl,` |
| L117 | thumbUrl | unknown | `pushData.thumbUrl,` |
| L209 | notification | unknown | `if (notificationData.type === "system") return { title: "Locava", body: notificationData.message \|\| "Notification" };` |
| L210 | notification | unknown | `return { title, body: notificationData.message \|\| "You have a new notification." };` |
| L262 | imageUrl | unknown | `const imageUrl = resolveRichImageUrl(notificationData, senderData);` |
| L263 | imageUrl | unknown | `if (imageUrl && (isPostRelatedPush(notificationData) \|\| isPeopleRelatedPush(notificationData))) {` |
| L264 | imageUrl | unknown | `payload.richContent = { image: imageUrl };` |
| L267 | imageUrl | unknown | `stringData.imageUrl = imageUrl;` |
| L268 | imageUrl | unknown | `stringData._richContent = JSON.stringify({ image: imageUrl });` |

### Locava Backendv2/src/services/posting/assemblePostAssets.ts

| L13 | posterUrl | unknown | `posterUrl?: string;` |
| L21 | photoLink | unknown | `/** First asset's best URL for displayPhotoLink / photoLink fallbacks */` |
| L21 | displayPhotoLink | unknown | `/** First asset's best URL for displayPhotoLink / photoLink fallbacks */` |
| L30 | posterUrl | unknown | `posterUrl: string;` |
| L32 | posterUrl | unknown | `const { id, originalUrl, posterUrl } = input;` |
| L38 | posterUrl | unknown | `const poster = posterUrl.trim() \|\| originalUrl;` |
| L148 | posterUrl | unknown | `const posterUrl = String(item.posterUrl ?? "").trim();` |
| L149 | posterUrl | unknown | `if (!posterUrl \|\| !/^https?:\/\//i.test(posterUrl)) {` |
| L155 | posterUrl | unknown | `posterUrl` |
| L158 | posterUrl | unknown | `if (!primaryDisplayUrl) primaryDisplayUrl = posterUrl;` |

### Locava Backendv2/src/services/posting/buildPostDocument.ts

| L58 | assets[0] | unknown | `const first = input.assembled.assets[0] as { poster?: string; original?: string; type?: string } \| undefined;` |
| L59 | photoLink | unknown | `const photoLink =` |
| L66 | fallbackVideoUrl | unknown | `const fallbackVideoUrl = String(firstVideo?.original ?? "").trim() \|\| undefined;` |
| L67 | posterUrl | unknown | `const posterUrl = String(firstVideo?.poster ?? first?.poster ?? input.assembled.primaryDisplayUrl).trim() \|\| undefined;` |
| L91 | thumbUrl | unknown | `thumbUrl: input.assembled.primaryDisplayUrl,` |
| L92 | displayPhotoLink | unknown | `displayPhotoLink: input.assembled.primaryDisplayUrl,` |
| L93 | photoLink | unknown | `photoLink,` |
| L94 | photoLink | unknown | `photoLinks2: photoLink,` |
| L94 | photoLinks2 | unknown | `photoLinks2: photoLink,` |
| L95 | photoLink | unknown | `photoLinks3: photoLink,` |
| L95 | photoLinks3 | unknown | `photoLinks3: photoLink,` |
| L97 | photoLink | unknown | `photoLink,` |
| L98 | photoLinks2 | unknown | `photoLinks2: "",` |
| L99 | photoLinks3 | unknown | `photoLinks3: ""` |
| L144 | posterUrl | unknown | `base.posterReady = Boolean(posterUrl);` |
| L145 | posterUrl | unknown | `base.posterPresent = Boolean(posterUrl);` |
| L146 | posterUrl | unknown | `if (posterUrl) base.posterUrl = posterUrl;` |
| L149 | fallbackVideoUrl | unknown | `if (fallbackVideoUrl) base.fallbackVideoUrl = fallbackVideoUrl;` |
| L175 | photoLink | unknown | `base.posterUrl = photoLink;` |
| L175 | posterUrl | unknown | `base.posterUrl = photoLink;` |
| L188 | displayPhotoLink | unknown | `const displayPhotoLink = String(doc.displayPhotoLink ?? "").trim();` |
| L189 | displayPhotoLink | unknown | `if (!displayPhotoLink) throw new Error("publish_validation_missing_display_photo");` |

### Locava Backendv2/src/services/posting/native-post-document.test.ts

| L70 | posterUrl | test_fixture | `posterUrl: "https://cdn.example.com/poster.jpg"` |
| L96 | posterUrl | test_fixture | `posterUrl: "https://x.com/p.jpg"` |

### Locava Backendv2/src/services/storage/wasabi-presign.service.test.ts

| L39 | posterUrl | test_fixture | `expect(video.posterUrl).toContain(video.posterKey!);` |

### Locava Backendv2/src/services/storage/wasabi-presign.service.ts

| L89 | posterUrl | unknown | `posterUrl?: string;` |
| L98 | posterUrl | unknown | `posterUrl: keys.posterKey ? wasabiPublicUrlForKey(cfg, keys.posterKey) : undefined` |
| L199 | posterUrl | unknown | `posterUrl?: string;` |
| L220 | posterUrl | unknown | `posterUrl: finalized.posterUrl` |

### Locava Backendv2/src/services/surfaces/achievement-celebrations.service.ts

| L51 | imageUrl | unknown | `imageUrl: typeof data.imageUrl === "string" ? data.imageUrl : undefined,` |

### Locava Backendv2/src/services/surfaces/feed-for-you-simple.service.ts

| L690 | fallbackVideoUrl | unknown | `fallbackVideoUrl?: string;` |
| L698 | assets[0] | unknown | `const a0 = candidate.assets[0];` |
| L716 | posterUrl | unknown | `const posterOk = Boolean(candidate.posterUrl?.trim() \|\| a0.posterUrl?.trim());` |
| L722 | fallbackVideoUrl | unknown | `...(sel.fallbackVideoUrl ? { fallbackVideoUrl: sel.fallbackVideoUrl } : {}),` |
| L739 | posterUrl | unknown | `const posterOk = Boolean(candidate.posterUrl?.trim() \|\| candidate.assets[0]?.posterUrl?.trim());` |
| L739 | assets[0] | unknown | `const posterOk = Boolean(candidate.posterUrl?.trim() \|\| candidate.assets[0]?.posterUrl?.trim());` |
| L750 | assets[0] | unknown | `const a0 = candidate.assets[0];` |
| L804 | assets[0] | unknown | `const a = candidate.assets[0];` |
| L812 | posterUrl | unknown | `const poster = (a.posterUrl ?? "").trim();` |
| L854 | posterUrl | unknown | `posterUrl: candidate.posterUrl,` |
| L855 | assets[0] | unknown | `aspectRatio: candidate.assets[0]?.aspectRatio ?? 9 / 16,` |

### Locava Backendv2/src/services/surfaces/feed-for-you.service.test.ts

| L45 | posterUrl | test_fixture | `posterUrl: input.posterUrl ?? 'https://cdn.locava.test/${idx}/poster.jpg',` |
| L69 | posterUrl | test_fixture | `posterUrl: 'https://cdn.locava.test/${idx}/poster.jpg',` |
| L191 | posterUrl | test_fixture | `candidate(1, { postId: "bad-1", posterUrl: "" }),` |

### Locava Backendv2/src/services/surfaces/feed-for-you.service.ts

| L250 | posterUrl | unknown | `return Boolean(candidate.postId && candidate.authorId && candidate.posterUrl && candidate.posterUrl.trim().length > 0);` |
| L295 | posterUrl | unknown | `posterUrl: candidate.posterUrl,` |
| L296 | assets[0] | unknown | `aspectRatio: candidate.assets[0]?.aspectRatio ?? 9 / 16,` |

### Locava Backendv2/src/services/surfaces/notifications.service.ts

| L6 | notification | unknown | `import { legacyNotificationPushPublisher } from "../notifications/legacy-notification-push.publisher.js";` |
| L15 | notification | unknown | `// Repository serves denormalized actor/target fields from the notification row itself.` |
| L67 | notification | unknown | `mutationType: "notification.create",` |
| L81 | notification | unknown | `console.warn("[notifications] synchronous notification creation failed", {` |
| L92 | notification | unknown | `console.warn("[notifications] notification mutation pipeline failed", {` |

### Locava Backendv2/src/services/surfaces/search-discovery.service.ts

| L49 | thumbUrl | unknown | `thumbUrl: string;` |
| L50 | displayPhotoLink | unknown | `displayPhotoLink: string;` |
| L88 | thumbUrl | unknown | `"thumbUrl",` |
| L89 | displayPhotoLink | unknown | `"displayPhotoLink",` |
| L90 | photoLink | unknown | `"photoLink",` |
| L108 | photoLink | unknown | `const direct = String(data.thumbUrl ?? data.displayPhotoLink ?? data.photoLink ?? "").trim();` |
| L108 | displayPhotoLink | unknown | `const direct = String(data.thumbUrl ?? data.displayPhotoLink ?? data.photoLink ?? "").trim();` |
| L108 | thumbUrl | unknown | `const direct = String(data.thumbUrl ?? data.displayPhotoLink ?? data.photoLink ?? "").trim();` |
| L111 | assets[0] | unknown | `if (Array.isArray(assets) && assets[0] && typeof assets[0] === "object") {` |
| L112 | assets[0] | unknown | `const a0 = assets[0] as Record<string, unknown>;` |
| L915 | thumbUrl | unknown | `thumbUrl: post.thumbUrl,` |
| L916 | displayPhotoLink | unknown | `displayPhotoLink: post.displayPhotoLink,` |
| L939 | thumbUrl | unknown | `.filter((post) => post.thumbUrl.startsWith("http"))` |
| L1139 | thumbUrl | unknown | `thumbUrl: thumb,` |
| L1140 | displayPhotoLink | unknown | `displayPhotoLink: String(data.displayPhotoLink ?? thumb).trim(),` |

### Locava Backendv2/src/services/surfaces/search-home-v1.projection.ts

| L23 | assets[0] | unknown | `if (Array.isArray(assets) && assets[0] && typeof assets[0] === "object") {` |
| L24 | assets[0] | unknown | `const a0 = assets[0] as Record<string, unknown>;` |

### Locava Backendv2/src/services/surfaces/search-home-v1.service.test.ts

| L44 | thumbUrl | test_fixture | `thumbUrl: "https://cdn.example.com/p1.jpg",` |
| L53 | thumbUrl | test_fixture | `thumbUrl: "https://cdn.example.com/p2.jpg",` |

### Locava Backendv2/src/services/surfaces/search.service.test.ts

| L27 | thumbUrl | test_fixture | `thumbUrl: "https://example.com/post-1.jpg",` |
| L28 | displayPhotoLink | test_fixture | `displayPhotoLink: "https://example.com/post-1.jpg",` |
| L77 | thumbUrl | test_fixture | `thumbUrl: "https://example.com/global.jpg",` |
| L78 | displayPhotoLink | test_fixture | `displayPhotoLink: "https://example.com/global.jpg",` |

### Locava Backendv2/src/services/surfaces/search.service.ts

| L42 | thumbUrl | unknown | `thumbUrl?: string;` |
| L43 | displayPhotoLink | unknown | `displayPhotoLink?: string;` |
| L70 | displayPhotoLink | unknown | `const posterUrl = String(row.thumbUrl \|\| row.displayPhotoLink \|\| "");` |
| L70 | thumbUrl | unknown | `const posterUrl = String(row.thumbUrl \|\| row.displayPhotoLink \|\| "");` |
| L70 | posterUrl | unknown | `const posterUrl = String(row.thumbUrl \|\| row.displayPhotoLink \|\| "");` |
| L86 | posterUrl | unknown | `firstAssetUrl: posterUrl,` |
| L94 | posterUrl | unknown | `posterUrl,` |
| L208 | posterUrl | unknown | `.filter((row) => isUrl(String(row.media?.posterUrl ?? "")))` |

### Locava Backendv2/src/services/video/video-post-processor.service.ts

| L87 | post.assets | unknown | `const assets = Array.isArray(post.assets) ? [...(post.assets as Record<string, unknown>[])] : [];` |
| L297 | posterUrl | unknown | `const posterUrl =` |
| L307 | posterUrl | unknown | `posterReady: Boolean(posterUrl),` |
| L308 | posterUrl | unknown | `posterPresent: Boolean(posterUrl),` |
| L309 | posterUrl | unknown | `...(posterUrl ? { posterUrl } : {}),` |
| L312 | photoLinks2 | unknown | `photoLinks2: preview360Avc \|\| posterUrl,` |
| L312 | posterUrl | unknown | `photoLinks2: preview360Avc \|\| posterUrl,` |
| L313 | photoLinks3 | unknown | `photoLinks3: main720Avc \|\| preview360Avc \|\| posterUrl,` |
| L313 | posterUrl | unknown | `photoLinks3: main720Avc \|\| preview360Avc \|\| posterUrl,` |
| L316 | photoLink | unknown | `photoLink: posterUrl ?? post.photoLink,` |
| L316 | posterUrl | unknown | `photoLink: posterUrl ?? post.photoLink,` |
| L317 | photoLinks2 | unknown | `photoLinks2: preview360Avc,` |
| L318 | photoLinks3 | unknown | `photoLinks3: main720Avc` |
| L352 | fallbackVideoUrl | unknown | `if (readiness.fallbackVideoUrl) mergedPost.fallbackVideoUrl = readiness.fallbackVideoUrl;` |
| L400 | fallbackVideoUrl | unknown | `...(playbackReadinessFromDoc.fallbackVideoUrl` |
| L401 | fallbackVideoUrl | unknown | `? { fallbackVideoUrl: playbackReadinessFromDoc.fallbackVideoUrl }` |
| L405 | posterUrl | unknown | `...(playbackReadinessFromDoc.posterUrl ? { posterUrl: playbackReadinessFromDoc.posterUrl } : {}),` |

### Locava-Native/src/analytics/analyticsClientDedupe.test.ts

| L19 | notification | test_fixture | `buildClientDedupeKey('app_open', { source: 'notification' }) === 'app_open\|notification',` |

### Locava-Native/src/analytics/enhancedTrackingService.ts

| L264 | notification | unknown | `const notificationContent = lastNotificationResponse.notification.request.content;` |
| L266 | notification | unknown | `const identifier = lastNotificationResponse.notification.request.identifier;` |
| L279 | notification | unknown | `this.trackAppOpen('notification');` |

### Locava-Native/src/auth/auth.store.ts

| L708 | notification | unknown | `const { clearNotificationDomainState } = await import('../features/notifications/state/notification.repository');` |

### Locava-Native/src/auth/AuthProvider.tsx

| L42 | notification | unknown | `// System notification prompt for returning users runs after the find-friends overlay (PostSignInNotificationPrompt).` |
| L84 | notification | unknown | `import('../features/notifications/state/notification.repository')` |
| L118 | notification | unknown | `// Revalidate on app resume if last sync was > 60s ago; refresh Expo push token when notification permission already granted` |

### Locava-Native/src/contracts/appPostV2.ts

| L3 | media.assets | legacy_fallback_inside_helper | `* Canonical media: 'media.assets[]' + 'media.cover'; compatibility fields are fallback only.` |
| L74 | posterUrl | migrated_appPostV2 | `posterUrl: string \| null;` |
| L113 | thumbUrl | migrated_appPostV2 | `thumbUrl: string \| null;` |
| L114 | posterUrl | migrated_appPostV2 | `posterUrl: string \| null;` |
| L198 | photoLink | migrated_appPostV2 | `photoLink: string \| null;` |
| L199 | photoLinks2 | migrated_appPostV2 | `photoLinks2: string \| null;` |
| L200 | photoLinks3 | migrated_appPostV2 | `photoLinks3: string \| null;` |
| L201 | displayPhotoLink | migrated_appPostV2 | `displayPhotoLink: string \| null;` |
| L202 | thumbUrl | migrated_appPostV2 | `thumbUrl: string \| null;` |
| L203 | posterUrl | migrated_appPostV2 | `posterUrl: string \| null;` |
| L204 | fallbackVideoUrl | legacy_fallback_inside_helper | `fallbackVideoUrl: string \| null;` |

### Locava-Native/src/data/auth/v2Bootstrap.maps.ts

| L48 | thumbUrl | unknown | `thumbUrl: it.thumbUrl,` |

### Locava-Native/src/data/auth/v2Bootstrap.types.ts

| L60 | thumbUrl | unknown | `thumbUrl: string;` |

### Locava-Native/src/data/cache/postMetadata.cache.ts

| L114 | assets[0] | unknown | `const firstAsset = Array.isArray(post.assets) ? (post.assets[0] as Record<string, unknown> \| undefined) : undefined;` |
| L114 | post.assets | unknown | `const firstAsset = Array.isArray(post.assets) ? (post.assets[0] as Record<string, unknown> \| undefined) : undefined;` |
| L174 | post.assets | unknown | `const assets = Array.isArray(post.assets) ? (post.assets as Record<string, unknown>[]) : [];` |
| L188 | profile grid | unknown | `* Thin sources (profile grid thumbs, partial API rows) omit title/address/geo; 'writePostMetadataCache*'` |
| L198 | post.assets | unknown | `const assetsArr = Array.isArray(post.assets) ? (post.assets as Record<string, unknown>[]) : [];` |
| L209 | displayPhotoLink | unknown | `const displayPhotoLink =` |
| L210 | displayPhotoLink | unknown | `(typeof post.displayPhotoLink === 'string' && isUsablePublicThumbUrl(post.displayPhotoLink) && post.displayPhotoLink.trim()) \|\|` |
| L211 | photoLink | unknown | `(typeof post.photoLink === 'string' && isUsablePublicThumbUrl(post.photoLink) && post.photoLink.trim()) \|\|` |
| L214 | photoLink | unknown | `typeof post.photoLink === 'string' && isUsablePublicThumbUrl(post.photoLink)` |
| L215 | photoLink | unknown | `? post.photoLink.trim()` |
| L216 | displayPhotoLink | unknown | `: displayPhotoLink;` |
| L246 | displayPhotoLink | unknown | `if (typeof displayPhotoLink === 'string' && displayPhotoLink) {` |
| L247 | displayPhotoLink | unknown | `row.displayPhotoLink = displayPhotoLink;` |
| L250 | photoLink | unknown | `row.photoLink = photoLinkResolved;` |

### Locava-Native/src/data/cutover/nativeOldRailShutdown.ts

| L21 | notification | unknown | `import('../../features/notifications/state/notification.repository').then((m) =>` |

### Locava-Native/src/data/repos/postRepo.ts

| L496 | fallbackVideoUrl | unknown | `fallbackVideoUrlPresent: Boolean((post as Record<string, unknown>).fallbackVideoUrl),` |
| L552 | profile grid | unknown | `// - remove the tile from profile grid + decrement count` |

### Locava-Native/src/debug/debugConfig/debugFeatureToggles.store.ts

| L28 | notification | unknown | `notificationStats: 'Reserved — notification badge API when identified',` |

### Locava-Native/src/engagement/index.ts

| L5 | AssetCarouselOnly | unknown | `* ReelsCellHeavy Android), Following feed, carousel watch time via AssetCarouselOnly → post_engagement_summary_v1.` |

### Locava-Native/src/engagement/postEngagement.liftable.ts

| L18 | notification | unknown | `return 'notification';` |

### Locava-Native/src/engagement/postEngagement.types.ts

| L19 | notification | unknown | `\| 'notification'` |

### Locava-Native/src/features/achievements/achievementModals.store.ts

| L38 | imageUrl | unknown | `weeklyCapture?: { wasNewCompletion?: boolean; title?: string; description?: string; xpReward?: number; imageUrl?: string };` |
| L66 | imageUrl | unknown | `weeklyCaptureData?: { title?: string; description?: string; xpReward?: number; imageUrl?: string } \| null;` |
| L79 | imageUrl | unknown | `imageUrl?: string \| null;` |
| L87 | displayPhotoLink | needs_migration | `/** Post thumbnail for globe marker (first image or displayPhotoLink). */` |
| L209 | imageUrl | unknown | `? { title: p.weeklyCapture.title, description: p.weeklyCapture.description, xpReward: p.weeklyCapture.xpReward, imageUrl: p.weeklyCapture.imageUrl }` |

### Locava-Native/src/features/achievements/achievements.store.ts

| L1956 | imageUrl | unknown | `const imageUrl = delta.weeklyCapture.imageUrl ?? null;` |
| L1976 | imageUrl | unknown | `imageUrl: imageUrl ?? target.imageUrl,` |
| L1977 | displayPhotoLink | needs_migration | `displayPhotoLink: imageUrl ?? (target as { displayPhotoLink?: string }).displayPhotoLink,` |
| L1977 | imageUrl | unknown | `displayPhotoLink: imageUrl ?? (target as { displayPhotoLink?: string }).displayPhotoLink,` |
| L1978 | photoLink | needs_migration | `photoLink: imageUrl ?? (target as { photoLink?: string }).photoLink,` |
| L1978 | imageUrl | unknown | `photoLink: imageUrl ?? (target as { photoLink?: string }).photoLink,` |

### Locava-Native/src/features/achievements/achievements.types.ts

| L45 | photoLink | needs_migration | `/** Image URL for the capture (post thumb). Backend may send displayPhotoLink/photoLink (from post) or imageUrl/thumbUrl. */` |
| L45 | displayPhotoLink | needs_migration | `/** Image URL for the capture (post thumb). Backend may send displayPhotoLink/photoLink (from post) or imageUrl/thumbUrl. */` |
| L45 | thumbUrl | needs_migration | `/** Image URL for the capture (post thumb). Backend may send displayPhotoLink/photoLink (from post) or imageUrl/thumbUrl. */` |
| L45 | imageUrl | unknown | `/** Image URL for the capture (post thumb). Backend may send displayPhotoLink/photoLink (from post) or imageUrl/thumbUrl. */` |
| L46 | imageUrl | unknown | `imageUrl?: string;` |
| L47 | thumbUrl | needs_migration | `thumbUrl?: string;` |
| L49 | displayPhotoLink | needs_migration | `displayPhotoLink?: string;` |
| L50 | photoLink | needs_migration | `photoLink?: string;` |
| L263 | imageUrl | unknown | `imageUrl?: string;` |
| L333 | imageUrl | unknown | `imageUrl?: string;` |
| L391 | thumbUrl | needs_migration | `thumbUrl?: string;` |

### Locava-Native/src/features/achievements/achievements.utils.ts

| L3 | photoLink | needs_migration | `* (matches old app: displayPhotoLink \|\| imageUrl \|\| photoLink \|\| thumbUrl).` |
| L3 | displayPhotoLink | needs_migration | `* (matches old app: displayPhotoLink \|\| imageUrl \|\| photoLink \|\| thumbUrl).` |
| L3 | thumbUrl | needs_migration | `* (matches old app: displayPhotoLink \|\| imageUrl \|\| photoLink \|\| thumbUrl).` |
| L3 | imageUrl | unknown | `* (matches old app: displayPhotoLink \|\| imageUrl \|\| photoLink \|\| thumbUrl).` |
| L86 | displayPhotoLink | needs_migration | `(c as { displayPhotoLink?: string }).displayPhotoLink ??` |
| L87 | imageUrl | unknown | `c.imageUrl ??` |
| L88 | photoLink | needs_migration | `(c as { photoLink?: string }).photoLink ??` |
| L89 | thumbUrl | needs_migration | `c.thumbUrl ??` |

### Locava-Native/src/features/achievements/backendv2/achievementsV2.types.ts

| L297 | imageUrl | unknown | `imageUrl?: string \| null;` |

### Locava-Native/src/features/achievements/badgeItems.ts

| L82 | imageUrl | unknown | `imageUrl: resolveBadgeImageUrl(apiBadge),` |
| L116 | imageUrl | unknown | `imageUrl: undefined,` |

### Locava-Native/src/features/achievements/competitive/CompetitiveBadgeDetailModal.tsx

| L96 | thumbUrl | needs_migration | `thumbUrl={first.thumbUrl ?? null}` |
| L100 | thumbUrl | needs_migration | `thumbUrl: post.thumbUrl ?? null,` |

### Locava-Native/src/features/achievements/data/achievements.api.ts

| L639 | imageUrl | unknown | `imageUrl: l.imageUrl ?? undefined,` |

### Locava-Native/src/features/achievements/data/leagues.data.ts

| L76 | imageUrl | unknown | `iconUrl: l.icon \|\| l.imageUrl \|\| '',` |

### Locava-Native/src/features/achievements/heavy/BadgeCard.tsx

| L34 | imageUrl | unknown | `imageUrl?: string;` |
| L79 | imageUrl | unknown | `imageUrl,` |
| L206 | imageUrl | unknown | `{imageUrl ? (` |
| L208 | imageUrl | unknown | `source={{ uri: imageUrl }}` |

### Locava-Native/src/features/achievements/heavy/BadgePreviewTile.tsx

| L25 | imageUrl | unknown | `const imageUri = isHttpImageUri(badge.imageUrl) ? badge.imageUrl!.trim() : null;` |

### Locava-Native/src/features/achievements/heavy/sections/DebugSection.tsx

| L122 | thumbUrl | needs_migration | `thumbUrl: markerUri,` |
| L215 | imageUrl | unknown | `): Array<{ id: string; title: string; prev: number; next: number; target: number; barColor?: string; imageUrl?: string \| null; iconKey?: 'chestOpen' \| 'chestClose' }> {` |
| L216 | imageUrl | unknown | `const cards: Array<{ id: string; title: string; prev: number; next: number; target: number; barColor?: string; imageUrl?: string \| null; iconKey?: 'chestOpen' \| 'chestClose' }> = [];` |
| L236 | imageUrl | unknown | `imageUrl: b.image ?? b.iconUrl ?? undefined,` |
| L244 | imageUrl | unknown | `type DebugWeeklyCaptureData = { title?: string; description?: string; xpReward?: number; imageUrl?: string };` |
| L675 | imageUrl | unknown | `imageUrl: d.weeklyCapture.imageUrl,` |
| L704 | imageUrl | unknown | `const imageUrl = getCaptureImageUrl(cap) ?? undefined;` |
| L716 | imageUrl | unknown | `weeklyCaptureData: { title, description, xpReward, imageUrl },` |
| L756 | imageUrl | unknown | `imageUrl: getCaptureImageUrl(cap) ?? undefined,` |

### Locava-Native/src/features/achievements/heavy/sections/OverviewSection.tsx

| L222 | displayPhotoLink | needs_migration | `displayPhotoLink: heroUri ?? undefined,` |

### Locava-Native/src/features/achievements/heavy/WeeklyCaptures.tsx

| L339 | displayPhotoLink | needs_migration | `displayPhotoLink: heroUri ?? undefined,` |
| L592 | thumbUrl | needs_migration | `const thumbUrl = getCaptureImageUrl(c);` |
| L618 | thumbUrl | needs_migration | `{thumbUrl && thumbUrl.trim().length > 0 ? (` |
| L620 | thumbUrl | needs_migration | `source={{ uri: thumbUrl }}` |

### Locava-Native/src/features/achievements/modals/PostResultFlow.heavy.tsx

| L320 | imageUrl | unknown | `imageUrl?: string \| null;` |
| L343 | imageUrl | unknown | `imageUrl: resolveBadgeImageUrl(badge),` |
| L880 | imageUrl | unknown | `capture?: { title?: string; description?: string; xpReward?: number; imageUrl?: string } \| null;` |
| L901 | imageUrl | unknown | `c?.imageUrl && c.imageUrl.trim().length > 0 ? c.imageUrl : null;` |
| L987 | thumbUrl | needs_migration | `<MapMarkerPin thumbUrl={oldImageUri} />` |
| L990 | thumbUrl | needs_migration | `<MapMarkerPin thumbUrl={newImageUri} />` |
| L1066 | imageUrl | unknown | `imageUrl,` |
| L1073 | imageUrl | unknown | `imageUrl?: string \| null;` |
| L1082 | imageUrl | unknown | `{imageUrl && imageUrl.startsWith('http') ? (` |
| L1083 | imageUrl | unknown | `<Image source={{ uri: imageUrl }} style={styles.achievementPhoto} contentFit="cover" />` |
| L1124 | imageUrl | unknown | `imageUrl,` |
| L1140 | imageUrl | unknown | `imageUrl?: string \| null;` |
| L1217 | imageUrl | unknown | `imageUrl={imageUrl ?? undefined}` |
| L1259 | imageUrl | unknown | `imageUrl?: string \| null;` |
| L1312 | imageUrl | unknown | `imageUrl: resolveBadgeImageUrl(b),` |
| L1354 | imageUrl | unknown | `imageUrl: c.imageUrl ?? null,` |
| L1401 | imageUrl | unknown | `imageUrl: card.imageUrl ?? meta?.imageUrl ?? null,` |
| L1952 | imageUrl | unknown | `imageUrl={a.imageUrl}` |
| L2307 | imageUrl | unknown | `weeklyCaptureData?: { title?: string; description?: string; xpReward?: number; imageUrl?: string } \| null;` |
| L2319 | imageUrl | unknown | `imageUrl?: string \| null;` |

### Locava-Native/src/features/achievements/monthlyOverview/MonthlyOverviewModal.heavy.tsx

| L52 | AssetCarouselOnly | unknown | `import { AssetCarouselOnly } from '../../liftable/AssetCarouselOnly';` |
| L55 | PostTile | unknown | `import { PostTile } from '../../liftable/PostTile';` |
| L230 | post.assets | needs_migration | `const assets = (post.assets as unknown[] \| undefined) ?? [];` |
| L233 | displayPhotoLink | needs_migration | `(post.displayPhotoLink as string \| undefined) ??` |
| L234 | photoLink | needs_migration | `(post.photoLink as string \| undefined) ??` |
| L235 | thumbUrl | needs_migration | `(post.thumbUrl as string \| undefined);` |
| L237 | photoLink | needs_migration | `(post.legacy as { photoLink?: string } \| undefined)?.photoLink ??` |
| L238 | photoLink | needs_migration | `(post.photoLink as string \| undefined);` |
| L330 | displayPhotoLink | needs_migration | `displayPhotoLink: post.heroUri,` |
| L331 | thumbUrl | needs_migration | `thumbUrl: post.heroUri,` |
| L368 | PostTile | unknown | `<PostTile` |
| L396 | thumbUrl | needs_migration | `thumbUrl: post.heroUri,` |
| L998 | thumbUrl | needs_migration | `<MapMarkerPin thumbUrl={post.heroUri ?? null} />` |
| L1128 | thumbUrl | needs_migration | `thumbUrl: post.heroUri ?? null,` |
| L1178 | AssetCarouselOnly | unknown | `<AssetCarouselOnly` |
| L1677 | thumbUrl | needs_migration | `<MapMarkerPin thumbUrl={post.heroUri ?? null} />` |
| L1843 | LiftableViewerHost | unknown | `/** Raw drag translation (same model as LiftableViewerHost); visuals scale by VIEWER_DRAG_CONTAINER_PAN_TRACK. */` |
| L1848 | LiftableViewerHost | unknown | `/** Mirrors LiftableViewerHost pan: separates vertical scroll intent from horizontal edge dismiss. */` |

### Locava-Native/src/features/achievements/monthlyOverview/monthlyRecap.load.ts

| L276 | photoLink | needs_migration | `heroUri = getHeroUri(source) ?? raw.displayPhotoLink ?? raw.photoLink ?? undefined;` |
| L276 | displayPhotoLink | needs_migration | `heroUri = getHeroUri(source) ?? raw.displayPhotoLink ?? raw.photoLink ?? undefined;` |
| L278 | displayPhotoLink | needs_migration | `const d = raw.displayPhotoLink;` |
| L279 | photoLink | needs_migration | `const p = raw.photoLink;` |

### Locava-Native/src/features/achievements/postResultAchievementCards.ts

| L92 | imageUrl | unknown | `imageUrl?: string \| null;` |
| L282 | imageUrl | unknown | `imageUrl: item.imageUrl ?? null,` |

### Locava-Native/src/features/achievements/recentBadgeOverlay.ts

| L65 | imageUrl | unknown | `imageUrl: card.imageUrl ?? undefined,` |
| L75 | imageUrl | unknown | `imageUrl: card.imageUrl ?? base.imageUrl,` |

### Locava-Native/src/features/achievements/weeklyCapturesShowcase/WeeklyCapturesMapFullScreen.heavy.tsx

| L148 | thumbUrl | needs_migration | `<MapMarkerPin thumbUrl={getCaptureImageUrl(capture) ?? null} />` |
| L424 | displayPhotoLink | needs_migration | `displayPhotoLink: heroUri ?? undefined,` |
| L538 | thumbUrl | needs_migration | `thumbUrl={getCaptureImageUrl(capture) ?? null}` |

### Locava-Native/src/features/achievements/weeklyCapturesShowcase/WeeklyCapturesRevealView.heavy.tsx

| L87 | thumbUrl | needs_migration | `const thumbUrl = getCaptureImageUrl(capture);` |
| L109 | thumbUrl | needs_migration | `{thumbUrl ? (` |
| L110 | thumbUrl | needs_migration | `<Image source={{ uri: thumbUrl }} style={styles.pinImage} contentFit="cover" />` |

### Locava-Native/src/features/chats/components/CreateGroupChatScreen.tsx

| L102 | assets[0] | needs_migration | `setImageUri(result.assets[0].uri);` |

### Locava-Native/src/features/chats/components/EditGroupScreen.tsx

| L100 | assets[0] | needs_migration | `setImageUri(result.assets[0].uri);` |

### Locava-Native/src/features/chatThread/ChatThread.content.tsx

| L74 | notification | unknown | `/** When header metadata is incomplete (e.g. notification / deep link), fetch and merge via setResolvedListItem. */` |

### Locava-Native/src/features/chatThread/components/MessageBubble.tsx

| L2 | PostTile | unknown | `* Single message bubble. Text, reply preview, reaction, status. Photo: image. Post: PostTile (same as profile).` |
| L7 | PostTile | unknown | `import { PostTile } from '../../liftable/PostTile';` |
| L245 | MessageBubble | unknown | `export const MessageBubble = React.memo(function MessageBubble({` |
| L423 | photoLink | needs_migration | `if (post && (post.displayPhotoLink ?? post.thumbUrl ?? post.photoLink)) {` |
| L423 | displayPhotoLink | needs_migration | `if (post && (post.displayPhotoLink ?? post.thumbUrl ?? post.photoLink)) {` |
| L423 | thumbUrl | needs_migration | `if (post && (post.displayPhotoLink ?? post.thumbUrl ?? post.photoLink)) {` |
| L427 | photoLink | needs_migration | `thumbUrl: (post.displayPhotoLink ?? post.thumbUrl ?? post.photoLink) as string \| undefined,` |
| L427 | displayPhotoLink | needs_migration | `thumbUrl: (post.displayPhotoLink ?? post.thumbUrl ?? post.photoLink) as string \| undefined,` |
| L427 | thumbUrl | needs_migration | `thumbUrl: (post.displayPhotoLink ?? post.thumbUrl ?? post.photoLink) as string \| undefined,` |
| L428 | displayPhotoLink | needs_migration | `displayPhotoLink: post.displayPhotoLink as string \| undefined,` |
| L447 | PostTile | unknown | `<PostTile` |

### Locava-Native/src/features/chatThread/components/MessageContextMenu.tsx

| L27 | MessageBubble | unknown | `import { MessageBubble } from './MessageBubble';` |
| L220 | MessageBubble | unknown | `<MessageBubble` |

### Locava-Native/src/features/chatThread/components/MessageList.tsx

| L10 | MessageBubble | unknown | `import { MessageBubble } from './MessageBubble';` |
| L87 | MessageBubble | unknown | `/** Match MessageBubble: backend may store photos as type photo or text/message with photoUrl. */` |
| L306 | MessageBubble | unknown | `<MessageBubble` |

### Locava-Native/src/features/chatThread/components/MessageListSkeleton.tsx

| L3 | MessageBubble | unknown | `* Matches old chat thread: same vertical rhythm (marginVertical 6) and bubble radii as MessageBubble.` |

### Locava-Native/src/features/chatThread/thread.styles.ts

| L13 | MessageBubble | unknown | `/** Match MessageBubble min height (padding 9*2 + line ~22) so skeleton has zero layout shift. */` |

### Locava-Native/src/features/collections/CreateBlendSheetContent.tsx

| L91 | assets[0] | needs_migration | `setImageUri(result.assets[0].uri);` |

### Locava-Native/src/features/collections/CreateCollectionModalContent.tsx

| L127 | assets[0] | needs_migration | `setImageUri(result.assets[0].uri);` |

### Locava-Native/src/features/collections/CreateCollectionSheet.heavy.tsx

| L66 | assets[0] | needs_migration | `setImageUri(result.assets[0].uri);` |

### Locava-Native/src/features/collections/CreateMixSheetContent.tsx

| L103 | assets[0] | needs_migration | `setImageUri(result.assets[0].uri);` |

### Locava-Native/src/features/collections/EditCollectionModalContent.tsx

| L134 | assets[0] | needs_migration | `setImageUri(result.assets[0].uri);` |

### Locava-Native/src/features/commonsReview/CommonsReviewScreen.heavy.tsx

| L221 | assets[0] | needs_migration | `const thumb = assets[0]?.thumbnailUrl ?? assets[0]?.fileUrl ?? null;` |

### Locava-Native/src/features/continuity/mergePostPreserveRichFields.ts

| L70 | displayPhotoLink | needs_migration | `"displayPhotoLink",` |
| L71 | photoLink | needs_migration | `"photoLink",` |
| L72 | thumbUrl | needs_migration | `"thumbUrl",` |
| L73 | posterUrl | unknown | `"posterUrl",` |

### Locava-Native/src/features/continuity/postEntity.store.ts

| L126 | posterUrl | unknown | `poster: m.posterUrl,` |
| L127 | posterUrl | unknown | `thumbnail: m.posterUrl,` |
| L129 | posterUrl | unknown | `poster: m.posterUrl,` |
| L137 | posterUrl | unknown | `thumbnail: m.posterUrl,` |
| L270 | thumbUrl | needs_migration | `thumbUrl:` |
| L271 | thumbUrl | needs_migration | `pickNonEmptyString((withAuth as Record<string, unknown> \| null)?.thumbUrl) ??` |
| L272 | thumbUrl | needs_migration | `pickNonEmptyString(fallbackLayer?.thumbUrl) ??` |
| L273 | thumbUrl | needs_migration | `(withAuth as Record<string, unknown> \| null)?.thumbUrl,` |
| L274 | displayPhotoLink | needs_migration | `displayPhotoLink:` |
| L275 | displayPhotoLink | needs_migration | `pickNonEmptyString((withAuth as Record<string, unknown> \| null)?.displayPhotoLink) ??` |
| L276 | displayPhotoLink | needs_migration | `pickNonEmptyString(fallbackLayer?.displayPhotoLink) ??` |
| L277 | displayPhotoLink | needs_migration | `(withAuth as Record<string, unknown> \| null)?.displayPhotoLink,` |

### Locava-Native/src/features/continuity/postWarmQueue.ts

| L142 | thumbUrl | needs_migration | `thumbUrl: typeof thin?.thumbUrl === "string" ? thin.thumbUrl : undefined,` |
| L157 | thumbUrl | needs_migration | `const thumbUrl =` |
| L158 | displayPhotoLink | needs_migration | `(withIds.displayPhotoLink as string \| undefined) ??` |
| L159 | thumbUrl | needs_migration | `(withIds.thumbUrl as string \| undefined) ??` |
| L160 | photoLink | needs_migration | `(withIds.photoLink as string \| undefined);` |
| L161 | thumbUrl | needs_migration | `return { postId: pid, post: withIds, thumbUrl };` |
| L211 | post.assets | needs_migration | `const assets = post.assets as VideoAssetLike[] \| undefined;` |
| L217 | assets[0] | needs_migration | `const first = assets[0];` |
| L418 | post.assets | needs_migration | `const assets = row.post.assets as VideoAssetLike[] \| undefined;` |
| L491 | post.assets | needs_migration | `return count + (Array.isArray(post.assets) && post.assets.length > 0 ? 1 : 0);` |
| L629 | assets[0] | needs_migration | `const v0 = assets[0];` |

### Locava-Native/src/features/deepLinking/DeepLinkBridge.tsx

| L3 | notification | unknown | `* Listens for URL and notification response; enqueues intents; executes when prerequisites ready.` |
| L174 | notification | unknown | `/** Prefer first frame over InteractionManager so notification / deep-link intents are not queued behind long interaction chains. */` |
| L198 | notification | unknown | `// Warm the slide-in chunk so notification taps are less likely to hit "store=true, UI not mounted yet".` |
| L218 | notification | unknown | `LOG('executor opening notification post', { postId: intent.payload.postId });` |
| L402 | notification | unknown | `// Background → foreground: when user taps notification and app was in background, the response listener` |
| L411 | notification | unknown | `const receivedSub = Notifications.addNotificationReceivedListener((notification) => {` |
| L413 | notification | unknown | `const data = (notification.request.content.data ?? {}) as Record<string, unknown>;` |
| L425 | notification | unknown | `identifier: notification.request.identifier,` |
| L427 | notification | unknown | `title: notification.request.content.title,` |
| L428 | notification | unknown | `body: notification.request.content.body,` |
| L429 | notification | unknown | `data: notification.request.content.data as Record<string, unknown> \| undefined,` |
| L449 | notification | unknown | `const data = response.notification.request.content.data as Record<string, unknown> \| undefined;` |
| L453 | notification | unknown | `notificationId: response.notification.request.identifier,` |
| L460 | notification | unknown | `title: response.notification.request.content.title ?? null,` |
| L461 | notification | unknown | `body: response.notification.request.content.body ?? null,` |
| L465 | notification | unknown | `enhancedAnalytics.track('app_open', { source: 'notification', previousSessionGapMs: null }, { immediate: true });` |

### Locava-Native/src/features/deepLinking/homeInteractive.ts

| L2 | notification | unknown | `* One-shot notification when Home tab becomes interactive (after SCREEN_SHELL_COMMIT + TAB_INTERACTIVE).` |

### Locava-Native/src/features/deepLinking/intentRouter.collectionNotifications.test.ts

| L9 | notification | test_fixture | `notification: {` |

### Locava-Native/src/features/deepLinking/intentRouter.groupNotifications.test.ts

| L7 | notification | test_fixture | `notification: {` |

### Locava-Native/src/features/deepLinking/intentRouter.postNotifications.test.ts

| L7 | notification | test_fixture | `notification: {` |
| L42 | notification | test_fixture | `'mention should preserve notification type',` |
| L69 | notification | test_fixture | `'comment should preserve notification type',` |

### Locava-Native/src/features/deepLinking/intentRouter.ts

| L2 | notification | unknown | `* Intent queue + executor for deep links and notification taps.` |
| L173 | notification | unknown | `notification: {` |
| L180 | notification | unknown | `const request = response.notification.request as {` |
| L247 | notification | unknown | `LOG('enqueue skip already processed notification', { notificationId: nid, type: intent.type });` |
| L251 | notification | unknown | `LOG('enqueue skip duplicate notification in queue', { notificationId: nid, type: intent.type });` |
| L398 | notification | unknown | `notification: {` |
| L411 | notification | unknown | `const notificationId = response.notification.request.identifier;` |
| L465 | notification | unknown | `const title = typeof response.notification.request.content.title === 'string'` |
| L466 | notification | unknown | `? response.notification.request.content.title.trim()` |
| L468 | notification | unknown | `const body = typeof response.notification.request.content.body === 'string'` |
| L469 | notification | unknown | `? response.notification.request.content.body` |

### Locava-Native/src/features/deepLinking/intentTypes.ts

| L2 | notification | unknown | `* Normalized intent shape for deep links and notification taps.` |

### Locava-Native/src/features/downloads/downloads.postTransform.test.ts

| L18 | displayPhotoLink | test_fixture | `displayPhotoLink: 'https://cdn.locava.app/post-hero.jpg',` |
| L28 | displayPhotoLink | test_fixture | `assert.equal(finalizedSparse.post.displayPhotoLink, localHero);` |
| L29 | thumbUrl | test_fixture | `assert.equal(finalizedSparse.post.thumbUrl, localHero);` |
| L30 | photoLink | test_fixture | `assert.equal(finalizedSparse.post.photoLink, localHero);` |
| L31 | post.assets | test_fixture | `assert.equal(Array.isArray(finalizedSparse.post.assets), true);` |
| L32 | post.assets | test_fixture | `assert.equal((finalizedSparse.post.assets as Array<Record<string, unknown>>).length, 1);` |
| L34 | post.assets | test_fixture | `(finalizedSparse.post.assets as Array<Record<string, unknown>>)[0]?.localUri,` |
| L45 | thumbUrl | test_fixture | `thumbUrl: 'https://cdn.locava.app/thumb.jpg',` |
| L52 | post.assets | test_fixture | `assert.equal((finalizedExistingAssets.post.assets as Array<Record<string, unknown>>).length, 1);` |
| L54 | post.assets | test_fixture | `(finalizedExistingAssets.post.assets as Array<Record<string, unknown>>)[0]?.id,` |
| L58 | displayPhotoLink | test_fixture | `tryPickStaticPostMediaUrl({ displayPhotoLink: 'https://cdn.locava.app/grid.jpg' }),` |
| L62 | displayPhotoLink | test_fixture | `tryPickStaticPostMediaUrl({ displayPhotoLink: 'https://cdn.locava.app/video.m3u8' }),` |

### Locava-Native/src/features/downloads/downloads.postTransform.ts

| L25 | photoLink | needs_migration | `for (const raw of [post.displayPhotoLink, post.thumbUrl, post.photoLink]) {` |
| L25 | displayPhotoLink | needs_migration | `for (const raw of [post.displayPhotoLink, post.thumbUrl, post.photoLink]) {` |
| L25 | thumbUrl | needs_migration | `for (const raw of [post.displayPhotoLink, post.thumbUrl, post.photoLink]) {` |
| L57 | photoLink | needs_migration | `const existingLocalHero = [nextPost.displayPhotoLink, nextPost.thumbUrl, nextPost.photoLink].find(` |
| L57 | displayPhotoLink | needs_migration | `const existingLocalHero = [nextPost.displayPhotoLink, nextPost.thumbUrl, nextPost.photoLink].find(` |
| L57 | thumbUrl | needs_migration | `const existingLocalHero = [nextPost.displayPhotoLink, nextPost.thumbUrl, nextPost.photoLink].find(` |
| L84 | displayPhotoLink | needs_migration | `nextPost.displayPhotoLink = resolvedHeroUri;` |
| L85 | thumbUrl | needs_migration | `nextPost.thumbUrl = resolvedHeroUri;` |
| L86 | photoLink | needs_migration | `nextPost.photoLink = resolvedHeroUri;` |

### Locava-Native/src/features/downloads/downloads.store.ts

| L67 | post.assets | needs_migration | `if (Array.isArray(post.assets) && post.assets.length > 0) return true;` |
| L70 | displayPhotoLink | needs_migration | `(post.displayPhotoLink as string \| undefined) ??` |
| L71 | thumbUrl | needs_migration | `(post.thumbUrl as string \| undefined) ??` |
| L72 | photoLink | needs_migration | `(post.photoLink as string \| undefined)` |
| L348 | post.assets | needs_migration | `const assets = Array.isArray(post.assets) ? [...(post.assets as Record<string, unknown>[])] : [];` |
| L536 | displayPhotoLink | needs_migration | `const heroUri = getHeroUri(post) ?? (post.displayPhotoLink as string \| undefined) ?? '';` |

### Locava-Native/src/features/editProfile/EditProfile.heavy.tsx

| L166 | assets[0] | needs_migration | `const uri = result.assets[0].uri;` |

### Locava-Native/src/features/findFriends/findFriends.postMedia.ts

| L9 | thumbUrl | needs_migration | `if (typeof post.thumbUrl === 'string' && post.thumbUrl.trim()) return post.thumbUrl;` |
| L10 | displayPhotoLink | needs_migration | `if (typeof post.displayPhotoLink === 'string' && post.displayPhotoLink.trim()) return post.displayPhotoLink;` |
| L11 | photoLink | needs_migration | `if (typeof post.photoLink === 'string' && post.photoLink.trim()) return post.photoLink;` |
| L12 | post.assets | needs_migration | `const assets = Array.isArray(post.assets) ? post.assets : [];` |

### Locava-Native/src/features/findFriends/findFriends.store.ts

| L92 | notification | unknown | `/** Dev: show post–find-friends notification explainer (Achievements debug). */` |

### Locava-Native/src/features/findFriends/FindFriendsHeroMap.tsx

| L41 | thumbUrl | needs_migration | `thumbUrl: p.thumbUrl,` |

### Locava-Native/src/features/findFriends/PostSignInNotificationPrompt.tsx

| L2 | notification | unknown | `* Post-sign-in explainer before notification permission.` |
| L3 | notification | unknown | `* Keep the hero simple: only the notification preview image.` |

### Locava-Native/src/features/groups/CreateGroupScreen.tsx

| L205 | assets[0] | needs_migration | `if (!result.canceled && result.assets[0]?.uri) setImageUri(result.assets[0].uri);` |
| L369 | notification | unknown | `A linked group chat is created automatically. Invited people get a notification and can join from Locava.` |

### Locava-Native/src/features/groups/EditGroupModal.tsx

| L157 | assets[0] | needs_migration | `setImageUri(result.assets[0].uri);` |

### Locava-Native/src/features/groups/GroupDetailScreen.tsx

| L38 | PostTile | unknown | `import { PostTile } from '../liftable/PostTile';` |
| L258 | displayPhotoLink | needs_migration | `if (typeof post.displayPhotoLink === 'string' && post.displayPhotoLink.trim()) return post.displayPhotoLink.trim();` |
| L259 | photoLink | needs_migration | `if (typeof post.photoLink === 'string' && post.photoLink.trim()) return post.photoLink.trim();` |
| L310 | thumbUrl | needs_migration | `thumbUrl: point.photoUrl,` |
| L458 | thumbUrl | needs_migration | `const thumbUrl = getGroupPostThumbUrl(post);` |
| L460 | PostTile | unknown | `<PostTile` |
| L465 | thumbUrl | needs_migration | `thumbUrl,` |
| L466 | displayPhotoLink | needs_migration | `displayPhotoLink: thumbUrl,` |
| L466 | thumbUrl | needs_migration | `displayPhotoLink: thumbUrl,` |
| L467 | photoLink | needs_migration | `photoLink: thumbUrl,` |
| L467 | thumbUrl | needs_migration | `photoLink: thumbUrl,` |

### Locava-Native/src/features/groups/groupInvitePreview.cache.ts

| L48 | displayPhotoLink | needs_migration | `return typeof post.displayPhotoLink === 'string' && post.displayPhotoLink.trim()` |
| L49 | displayPhotoLink | needs_migration | `? post.displayPhotoLink.trim()` |
| L50 | photoLink | needs_migration | `: typeof post.photoLink === 'string' && post.photoLink.trim()` |
| L51 | photoLink | needs_migration | `? post.photoLink.trim()` |

### Locava-Native/src/features/groups/groups.api.ts

| L106 | imageUrl | unknown | `imageUrl?: string;` |
| L149 | photoLink | needs_migration | `photoLink?: string;` |
| L150 | displayPhotoLink | needs_migration | `displayPhotoLink?: string;` |

### Locava-Native/src/features/home/backendv2/appendUniqueFeedItems.test.ts

| L26 | posterUrl | test_fixture | `posterUrl: 'https://example.com/p.jpg',` |

### Locava-Native/src/features/home/backendv2/feedDetailV2.normalize.embedded-comments.test.ts

| L16 | thumbUrl | test_fixture | `thumbUrl: 'https://example.com/p.jpg',` |

### Locava-Native/src/features/home/backendv2/feedDetailV2.normalize.media-source.test.ts

| L20 | thumbUrl | test_fixture | `thumbUrl: "https://cdn.example.com/poster.jpg",` |

### Locava-Native/src/features/home/backendv2/feedDetailV2.normalize.ts

| L116 | post.assets | needs_migration | `const normalizedAssets = (post.assets ?? []).map((asset) => ({` |
| L119 | thumbUrl | needs_migration | `poster: asset.poster ?? asset.thumbnail ?? post.thumbUrl ?? null,` |
| L120 | thumbUrl | needs_migration | `thumbnail: asset.thumbnail ?? asset.poster ?? post.thumbUrl ?? null,` |
| L135 | thumbUrl | needs_migration | `nonEmpty(post.thumbUrl),` |
| L254 | thumbUrl | needs_migration | `thumbUrl: post.thumbUrl,` |
| L255 | displayPhotoLink | needs_migration | `displayPhotoLink: post.thumbUrl,` |
| L255 | thumbUrl | needs_migration | `displayPhotoLink: post.thumbUrl,` |
| L256 | photoLink | needs_migration | `photoLink: post.thumbUrl,` |
| L256 | thumbUrl | needs_migration | `photoLink: post.thumbUrl,` |

### Locava-Native/src/features/home/backendv2/feedDetailV2.owner.ts

| L99 | post.assets | needs_migration | `assets: Array.isArray(post.assets) ? post.assets.length : 0,` |

### Locava-Native/src/features/home/backendv2/feedDetailV2.types.ts

| L52 | thumbUrl | needs_migration | `thumbUrl: string;` |

### Locava-Native/src/features/home/backendv2/feedV2.normalize.test.ts

| L25 | posterUrl | test_fixture | `media: { type: 'image', posterUrl: 'https://example.com/a.webp', aspectRatio: 0.75 },` |

### Locava-Native/src/features/home/backendv2/feedV2.normalize.ts

| L14 | posterUrl | unknown | `const assetPosterUrl = String(item.assets?.[0]?.posterUrl ?? '').trim();` |
| L15 | posterUrl | legacy_fallback_inside_helper | `const posterUrl = posterFromApp \|\| assetPosterUrl \|\| String(item.media?.posterUrl ?? '').trim();` |
| L16 | posterUrl | legacy_fallback_inside_helper | `if (!postId \|\| !posterUrl) return null;` |
| L72 | assets[0] | needs_migration | `width: typeof item.assets?.[0]?.width === 'number' ? item.assets[0].width : null,` |
| L73 | assets[0] | needs_migration | `height: typeof item.assets?.[0]?.height === 'number' ? item.assets[0].height : null,` |
| L75 | posterUrl | unknown | `posterUrl,` |

### Locava-Native/src/features/home/backendv2/feedV2.repository.ts

| L95 | posterUrl | unknown | `posterUrl?: string \| null;` |
| L128 | posterUrl | unknown | `posterUrl?: string;` |
| L136 | assets[0] | needs_migration | `const firstAsset = assets[0];` |
| L137 | posterUrl | unknown | `const posterUrl =` |
| L138 | posterUrl | unknown | `String(firstAsset?.posterUrl ?? item.media?.posterUrl ?? '').trim() \|\| null;` |
| L149 | posterUrl | unknown | `typeof asset?.posterUrl === 'string' && asset.posterUrl.trim()` |
| L150 | posterUrl | unknown | `? asset.posterUrl.trim()` |
| L151 | posterUrl | unknown | `: posterUrl;` |
| L172 | posterUrl | unknown | `posterUrl: poster,` |
| L216 | thumbUrl | needs_migration | `thumbUrl: posterUrl,` |
| L216 | posterUrl | unknown | `thumbUrl: posterUrl,` |
| L217 | displayPhotoLink | needs_migration | `displayPhotoLink: posterUrl,` |
| L217 | posterUrl | unknown | `displayPhotoLink: posterUrl,` |
| L218 | photoLink | needs_migration | `photoLink: posterUrl,` |
| L218 | posterUrl | unknown | `photoLink: posterUrl,` |

### Locava-Native/src/features/home/backendv2/feedV2.types.ts

| L38 | posterUrl | unknown | `posterUrl?: string \| null;` |
| L51 | posterUrl | unknown | `posterUrl?: string;` |

### Locava-Native/src/features/home/feeds/FollowingFeed.lazy.tsx

| L170 | posterUrl | unknown | `(i) => i?.media?.posterUrl && String(i.media.posterUrl).trim().length > 0,` |

### Locava-Native/src/features/home/feeds/postToReelsItem.ts

| L28 | posterUrl | unknown | `(v as { posterUrl?: string }).posterUrl ??` |
| L36 | photoLink | needs_migration | `const displayOrPhoto = (p.displayPhotoLink ?? p.photoLink) as string \| undefined;` |
| L36 | displayPhotoLink | needs_migration | `const displayOrPhoto = (p.displayPhotoLink ?? p.photoLink) as string \| undefined;` |
| L38 | thumbUrl | needs_migration | `const thumb = (p.thumbUrl as string \| undefined) ?? (p.thumb as string \| undefined);` |
| L56 | posterUrl | unknown | `const posterUrl = getPosterUrl(p);` |
| L57 | posterUrl | unknown | `if (!posterUrl \|\| !posterUrl.trim()) return null;` |
| L60 | assets[0] | needs_migration | `const firstAsset = assets[0];` |
| L183 | posterUrl | unknown | `posterUrl,` |

### Locava-Native/src/features/home/reels.types.ts

| L3 | posterUrl | unknown | `* Video-aware: posterUrl, previewUrl, streamUrl, mp4Url.` |
| L41 | posterUrl | unknown | `posterUrl: string;` |

### Locava-Native/src/features/home/reels/ElevatableReelsCell.heavy.tsx

| L55 | AssetCarouselOnly | unknown | `import { AssetCarouselOnly } from "../../liftable/AssetCarouselOnly";` |
| L118 | LiftableViewerHost | unknown | `/** Same as LiftableViewerHost: only allow drag-to-close when carousel is at correct edge (first or last asset). */` |
| L256 | displayPhotoLink | needs_migration | `const lockedDisplayPhotoLink = pickNonEmptyString(locked.displayPhotoLink);` |
| L257 | photoLink | needs_migration | `const lockedPhotoLink = pickNonEmptyString(locked.photoLink);` |
| L258 | thumbUrl | needs_migration | `const lockedThumbUrl = pickNonEmptyString(locked.thumbUrl);` |
| L259 | displayPhotoLink | needs_migration | `if (lockedDisplayPhotoLink) merged.displayPhotoLink = lockedDisplayPhotoLink;` |
| L260 | photoLink | needs_migration | `if (lockedPhotoLink) merged.photoLink = lockedPhotoLink;` |
| L261 | thumbUrl | needs_migration | `if (lockedThumbUrl) merged.thumbUrl = lockedThumbUrl;` |
| L406 | thumbUrl | needs_migration | `thumbUrl?: string;` |
| L407 | displayPhotoLink | needs_migration | `displayPhotoLink?: string;` |
| L408 | photoLink | needs_migration | `photoLink?: string;` |
| L419 | thumbUrl | needs_migration | `full.thumbUrl ??` |
| L420 | displayPhotoLink | needs_migration | `full.displayPhotoLink ??` |
| L421 | photoLink | needs_migration | `full.photoLink ??` |
| L422 | posterUrl | unknown | `item.media?.posterUrl ??` |
| L435 | thumbUrl | needs_migration | `thumbUrl: thumbFallback,` |
| L436 | displayPhotoLink | needs_migration | `displayPhotoLink: full.displayPhotoLink ?? thumbFallback,` |
| L437 | photoLink | needs_migration | `photoLink: full.photoLink ?? thumbFallback,` |
| L591 | posterUrl | unknown | `const posterUrl =` |
| L592 | posterUrl | unknown | `item.media?.posterUrl && String(item.media.posterUrl).trim();` |
| L597 | posterUrl | unknown | `if (posterUrl) {` |
| L600 | displayPhotoLink | needs_migration | `displayPhotoLink: posterUrl,` |
| L600 | posterUrl | unknown | `displayPhotoLink: posterUrl,` |
| L601 | photoLink | needs_migration | `photoLink: posterUrl,` |
| L601 | posterUrl | unknown | `photoLink: posterUrl,` |
| L630 | posterUrl | unknown | `heroUri: item.media.posterUrl,` |
| L633 | posterUrl | unknown | `[item.postId, item.media.posterUrl, postForCarousel, postForInfo],` |
| L649 | photoLink | needs_migration | `(postForCarousel.legacy as { photoLink?: string })?.photoLink ??` |
| L650 | photoLink | needs_migration | `(postForCarousel.photoLink as string \| undefined);` |
| L696 | LiftableViewerHost | unknown | `/** Same as LiftableViewerHost: drag-to-close only when at first or last asset. */` |
| L1491 | LiftableViewerHost | unknown | `/** Match LiftableViewerHost: fixed bottom on outer wrapper; opacity + slight parallax on scroll when elevated. */` |
| L1599 | AssetCarouselOnly | unknown | `<AssetCarouselOnly` |
| L1603 | posterUrl | unknown | `heroUri={item.media.posterUrl}` |
| L1721 | thumbUrl | needs_migration | `let assetMarkers: Array<{ latitude: number; longitude: number; thumbUrl: string \| null }> \| undefined;` |
| L1734 | thumbUrl | needs_migration | `const thumbUrl =` |
| L1740 | thumbUrl | needs_migration | `return { latitude: la, longitude: ln, thumbUrl };` |
| L1742 | thumbUrl | needs_migration | `.filter((m): m is { latitude: number; longitude: number; thumbUrl: string \| null } => m != null);` |
| L1745 | thumbUrl | needs_migration | `const thumbUrl =` |
| L1746 | thumbUrl | needs_migration | `(post?.thumbUrl as string \| undefined) ??` |
| L1747 | posterUrl | unknown | `item.media?.posterUrl ??` |
| L1755 | thumbUrl | needs_migration | `thumbUrl: thumbUrl ?? null,` |

### Locava-Native/src/features/home/reels/ReelsCellContent.tsx

| L76 | posterUrl | unknown | `{displayItem.media?.posterUrl ? (` |
| L81 | posterUrl | unknown | `source={{ uri: displayItem.media.posterUrl }}` |

### Locava-Native/src/features/home/reels/ReelsCellHeavy.tsx

| L612 | posterUrl | unknown | `source={{ uri: displayItem.media.posterUrl }}` |
| L752 | posterUrl | unknown | `prev.item.media.posterUrl === next.item.media.posterUrl &&` |

### Locava-Native/src/features/home/reels/ReelsFeedContent.tsx

| L72 | posterUrl | unknown | `(i) => i?.media?.posterUrl && String(i.media.posterUrl).trim().length > 0,` |

### Locava-Native/src/features/home/reels/ReelsFeedHeavy.tsx

| L279 | posterUrl | unknown | `(i) => i?.media?.posterUrl && String(i.media.posterUrl).trim().length > 0,` |
| L403 | posterUrl | unknown | `hasPoster: Boolean(first?.media?.posterUrl),` |
| L404 | posterUrl | unknown | `posterLen: first?.media?.posterUrl?.length ?? 0,` |

### Locava-Native/src/features/home/reels/reelsFullPostCache.ts

| L141 | post.assets | needs_migration | `if (post && Array.isArray(post.assets) && post.assets.length > 0) {` |

### Locava-Native/src/features/home/reels/reelsItemUpgrade.ts

| L48 | posterUrl | unknown | `posterUrl: item.media.posterUrl \|\| upgraded.media.posterUrl,` |

### Locava-Native/src/features/home/reelsStartupCache.model.test.ts

| L18 | posterUrl | test_fixture | `media: { posterUrl: 'https://example.com/${id}.jpg', type: 'image' },` |

### Locava-Native/src/features/invites/InviteAttributionEntry.tsx

| L15 | thumbUrl | needs_migration | `if (typeof post.thumbUrl === 'string' && post.thumbUrl.trim()) return post.thumbUrl;` |
| L16 | displayPhotoLink | needs_migration | `if (typeof post.displayPhotoLink === 'string' && post.displayPhotoLink.trim()) return post.displayPhotoLink;` |
| L17 | photoLink | needs_migration | `if (typeof post.photoLink === 'string' && post.photoLink.trim()) return post.photoLink;` |
| L18 | post.assets | needs_migration | `const assets = Array.isArray(post.assets) ? post.assets : [];` |

### Locava-Native/src/features/liftable/AnimatedBottomPagination.tsx

| L3 | LiftableViewerHost | unknown | `* Rebuilt in new app; matches OLD LiftableViewerHost behavior (no import from old).` |

### Locava-Native/src/features/liftable/AssetCarouselOnly.tsx

| L3 | AssetCarouselOnly | unknown | `* AssetCarouselOnly — Horizontal paging carousel (images + video slides).` |
| L140 | posterUrl | unknown | `ap.media.cover.posterUrl ??` |
| L141 | thumbUrl | needs_migration | `ap.media.cover.thumbUrl ??` |
| L142 | displayPhotoLink | compatibility_alias_only | `ap.compatibility.displayPhotoLink ??` |
| L143 | photoLink | compatibility_alias_only | `ap.compatibility.photoLink ??` |
| L160 | posterUrl | unknown | `const poster = asset.video.posterHighUrl ?? asset.video.posterUrl ?? asset.video.thumbnailUrl ?? coverUri;` |
| L161 | posterUrl | unknown | `const thumb = asset.video.thumbnailUrl ?? asset.video.posterUrl ?? coverUri;` |
| L359 | LiftableViewerHost | unknown | `* (LiftableViewerHost passes expand+handoff settle). Default: use InteractionManager only (reels/modals).` |
| L395 | AssetCarouselOnly | unknown | `export function AssetCarouselOnly({` |
| L605 | LiftableViewerHost | unknown | `// after expand settles (LiftableViewerHost passes dimensionLayoutProbeDelayMs); otherwise InteractionManager` |

### Locava-Native/src/features/liftable/CarouselVideoSlide.tsx

| L1377 | AssetCarouselOnly | unknown | `// AssetCarouselOnly switches that slide to poster-only.` |

### Locava-Native/src/features/liftable/getHeroUri.ts

| L2 | PostTile | unknown | `* getHeroUri — minimal hero URI for PostTile / ghost.` |
| L3 | displayPhotoLink | migrated_appPostV2 | `* Prefers AppPostV2 'media.cover' when 'appPost' / 'appPostV2' is present, then legacy displayPhotoLink / assets.` |
| L19 | photoLink | needs_migration | `for (const raw of [post.displayPhotoLink, post.photoLink, post.thumbUrl]) {` |
| L19 | displayPhotoLink | needs_migration | `for (const raw of [post.displayPhotoLink, post.photoLink, post.thumbUrl]) {` |
| L19 | thumbUrl | needs_migration | `for (const raw of [post.displayPhotoLink, post.photoLink, post.thumbUrl]) {` |
| L37 | post.assets | needs_migration | `const assets = post.assets as unknown[] \| undefined;` |
| L40 | assets[0] | needs_migration | `const hero = assets[0] as ImageAssetLike \| VideoAssetLike \| undefined;` |
| L90 | post.assets | needs_migration | `const assets = post.assets as unknown[] \| undefined;` |

### Locava-Native/src/features/liftable/index.ts

| L3 | PostTile | unknown | `* Tiles (PostTile) call open(); LiftableHostShell at root lazy-loads heavy viewer.` |
| L6 | PostTile | unknown | `export { PostTile } from './PostTile';` |
| L7 | PostTile | unknown | `export type { PostTileProps, PostTilePost } from './PostTile';` |

### Locava-Native/src/features/liftable/liftable.types.ts

| L50 | notification | unknown | `/** When set (e.g. notification row → post), closing animation uses this URI for the shrinking ghost (e.g. sender avatar) instead of the post asset. */` |

### Locava-Native/src/features/liftable/liftableGestureConstants.ts

| L2 | LiftableViewerHost | unknown | `* Shared gesture and parallax constants for LiftableViewerHost and ElevatableReelsCell.` |
| L27 | LiftableViewerHost | unknown | `* LiftableViewerHost: shared-element expand (~400ms) plus ghost linger and handoff slack.` |
| L61 | LiftableViewerHost | unknown | `* LiftableViewerHost: horizontal drag-to-close tuning (also used by Monthly recap modal).` |

### Locava-Native/src/features/liftable/liftableHeavyHostLoad.ts

| L2 | LiftableViewerHost | unknown | `* Single flight for 'LiftableViewerHost.heavy' so every early caller shares one download parse:` |
| L5 | PostTile | unknown | `* - {@link PostTile} press-in warm path` |
| L20 | LiftableViewerHost | unknown | `heavyModulePromise = import("./LiftableViewerHost.heavy");` |

### Locava-Native/src/features/liftable/LiftableHostShell.tsx

| L53 | LiftableViewerHost | unknown | `* Must be true for modal-layer shells. {@link LiftableViewerHost.heavy} returns null for` |

### Locava-Native/src/features/liftable/liftableOpenSnapshot.test.ts

| L288 | thumbUrl | test_fixture | `thumbUrl: "https://cdn.example.com/thumb.jpg",` |

### Locava-Native/src/features/liftable/liftableOpenSnapshot.ts

| L115 | post.assets | needs_migration | `const assets = post.assets as ViewerAssetRecord[] \| undefined;` |
| L187 | post.assets | needs_migration | `const assets = post.assets as unknown[] \| undefined;` |
| L234 | post.assets | needs_migration | `const assets = post.assets as unknown[] \| undefined;` |

### Locava-Native/src/features/liftable/liftableOpenTrace.ts

| L33 | post.assets | needs_migration | `const assets = post.assets as unknown[] \| undefined;` |
| L104 | displayPhotoLink | needs_migration | `typeof post.displayPhotoLink === "string" &&` |
| L105 | displayPhotoLink | needs_migration | `isProcessingPlaceholderCdnUrl(post.displayPhotoLink),` |
| L107 | displayPhotoLink | needs_migration | `typeof post.displayPhotoLink === "string" &&` |
| L109 | displayPhotoLink | needs_migration | `post.displayPhotoLink === orig,` |

### Locava-Native/src/features/liftable/liftablePostCache.ts

| L94 | post.assets | needs_migration | `const assets = post.assets;` |

### Locava-Native/src/features/liftable/LiftablePostInfo.tsx

| L2 | LiftableViewerHost | unknown | `* LiftablePostInfo — White section content for LiftableViewerHost.` |

### Locava-Native/src/features/liftable/liftablePrecache.ts

| L82 | thumbUrl | needs_migration | `thumbUrl?: string;` |
| L120 | thumbUrl | needs_migration | `thumbUrl: input.thumbUrl,` |
| L157 | thumbUrl | needs_migration | `thumbUrl?: string;` |
| L536 | post.assets | needs_migration | `const assets = post.assets as unknown[] \| undefined;` |
| L568 | post.assets | needs_migration | `const assets = post.assets as unknown[] \| undefined;` |
| L679 | assets[0] | needs_migration | `* Exact URL the carousel uses for the first asset (AssetCarouselOnly getAssetUri(assets[0])).` |
| L679 | AssetCarouselOnly | unknown | `* Exact URL the carousel uses for the first asset (AssetCarouselOnly getAssetUri(assets[0])).` |
| L689 | post.assets | needs_migration | `const assets = post.assets as unknown[] \| undefined;` |
| L701 | post.assets | needs_migration | `const assets = post.assets as unknown[] \| undefined;` |
| L703 | assets[0] | needs_migration | `const first = assets[0] as` |
| L806 | assets[0] | needs_migration | `assets?.[0] && typeof assets[0] === "object"` |
| L807 | assets[0] | needs_migration | `? (assets[0] as { type?: string }).type` |
| L951 | thumbUrl | needs_migration | `(typeof entry.thumbUrl === "string" && entry.thumbUrl` |
| L952 | thumbUrl | needs_migration | `? entry.thumbUrl` |
| L1147 | thumbUrl | needs_migration | `thumbUrl: e.thumbUrl,` |
| L1159 | PostTile | unknown | `* Single post entered view (e.g. PostTile mount with isVisible).` |
| L1166 | thumbUrl | needs_migration | `thumbUrl?: string,` |
| L1174 | thumbUrl | needs_migration | `thumbUrl,` |
| L1187 | thumbUrl | needs_migration | `thumbUrl: enriched.thumbUrl,` |
| L1192 | post.assets | needs_migration | `const assets = enriched.post.assets as unknown[] \| undefined;` |

### Locava-Native/src/features/liftable/liftableStore.ts

| L248 | post.assets | needs_migration | `Array.isArray(post.assets) &&` |
| L249 | post.assets | needs_migration | `(post.assets as unknown[]).length > 0;` |

### Locava-Native/src/features/liftable/LiftableViewerHost.heavy.tsx

| L4 | LiftableViewerHost | unknown | `* LiftableViewerHost.heavy — Single global post viewer (Instagram pattern).` |
| L70 | AssetCarouselOnly | unknown | `import { AssetCarouselOnly } from "./AssetCarouselOnly";` |
| L180 | AssetCarouselOnly | unknown | `/** Match AssetCarouselOnly letterbox fallback so ghost open matches carousel before first slide lays out. */` |
| L365 | LiftableViewerHost | unknown | `function LiftableViewerHost({` |
| L400 | post.assets | needs_migration | `Array.isArray(currentReq.post.assets)` |
| L401 | post.assets | needs_migration | `? (currentReq.post.assets as unknown[]).length` |
| L423 | LiftableViewerHost | unknown | `/** Main song (post.recordings mainSong): play on open, stop + unload on close — same as OLD LiftableViewerHost */` |
| L649 | AssetCarouselOnly | unknown | `/** Match AssetCarouselOnly: layout posts page horizontally by layout page, not raw asset count. */` |
| L744 | assets[0] | needs_migration | `const firstRaw = Array.isArray(assets) ? assets[0] : null;` |
| L812 | LiftableViewerHost | unknown | `console.warn("[LiftableViewerHost] stopMainSong:", e);` |
| L887 | LiftableViewerHost | unknown | `console.warn("[LiftableViewerHost] main song load/play failed:", e);` |
| L919 | notification | unknown | `// When we have postId but no/minimal post data (e.g. deep link, notification): try cache first, then fetch. Hydration is request-safe.` |
| L969 | post.assets | needs_migration | `Array.isArray(post.assets) &&` |
| L970 | post.assets | needs_migration | `(post.assets as unknown[]).length > 0;` |
| L974 | post.assets | needs_migration | `(post.assets as Array<{ type?: string }>).some((a) => a?.type === "video");` |
| L1545 | displayPhotoLink | needs_migration | `updateData.displayPhotoLink = hero;` |
| L1546 | thumbUrl | needs_migration | `updateData.thumbUrl = hero;` |
| L1871 | assets[0] | needs_migration | `const firstAsset = Array.isArray(assets) ? assets[0] : null;` |
| L2995 | AssetCarouselOnly | unknown | `/** Same predicate as AssetCarouselOnly fitWidthForSquareImages — open-only ghost matches carousel before handoff; close keeps cover ghost. */` |
| L3194 | AssetCarouselOnly | unknown | `<AssetCarouselOnly` |
| L3346 | thumbUrl | needs_migration | `let assetMarkers: Array<{ latitude: number; longitude: number; thumbUrl: string \| null }> \| undefined;` |
| L3359 | thumbUrl | needs_migration | `const thumbUrl =` |
| L3365 | thumbUrl | needs_migration | `return { latitude: la, longitude: ln, thumbUrl };` |
| L3367 | thumbUrl | needs_migration | `.filter((m): m is { latitude: number; longitude: number; thumbUrl: string \| null } => m != null);` |
| L3370 | thumbUrl | needs_migration | `const thumbUrl =` |
| L3371 | thumbUrl | needs_migration | `(post?.thumbUrl as string \| undefined) ??` |
| L3377 | thumbUrl | needs_migration | `thumbUrl: thumbUrl ?? null,` |
| L3797 | LiftableViewerHost | unknown | `export default LiftableViewerHost;` |

### Locava-Native/src/features/liftable/LocationMapPreview.heavy.tsx

| L4 | thumbUrl | needs_migration | `* Shows asset markers (thumbnails) when assetMarkers provided; otherwise single MapMarkerPin with thumbUrl.` |
| L18 | thumbUrl | needs_migration | `thumbUrl: string \| null;` |
| L26 | LiftableViewerHost | unknown | `/** When provided (e.g. from LiftableViewerHost), close the viewer before navigating to full map */` |
| L35 | thumbUrl | needs_migration | `thumbUrl?: string \| null;` |
| L83 | thumbUrl | needs_migration | `thumbUrl,` |
| L88 | thumbUrl | needs_migration | `return [{ latitude, longitude, thumbUrl: thumbUrl ?? null }];` |
| L89 | thumbUrl | needs_migration | `}, [assetMarkers, latitude, longitude, thumbUrl]);` |
| L122 | thumbUrl | needs_migration | `<MapMarkerPin thumbUrl={m.thumbUrl} />` |

### Locava-Native/src/features/liftable/nativeVideoPrefetch.ts

| L44 | post.assets | needs_migration | `const assets = post.assets as unknown[] \| undefined;` |

### Locava-Native/src/features/liftable/PostInfoPanel.tsx

| L181 | thumbUrl | needs_migration | `thumbUrl?: string \| null;` |
| L182 | thumbUrl | needs_migration | `assetMarkers?: Array<{ latitude: number; longitude: number; thumbUrl: string \| null }>;` |
| L337 | thumbUrl | needs_migration | `const thumbUrl =` |
| L339 | thumbUrl | needs_migration | `return { latitude: la, longitude: ln, thumbUrl };` |
| L341 | thumbUrl | needs_migration | `.filter((m): m is { latitude: number; longitude: number; thumbUrl: string \| null } => m != null);` |
| L347 | thumbUrl | needs_migration | `return (post?.thumbUrl as string \| undefined) ?? getHeroUri(post ?? undefined) ?? undefined;` |
| L651 | thumbUrl | needs_migration | `thumbUrl={thumbUrlForMap ?? null}` |

### Locava-Native/src/features/liftable/postInfoPanelActivityIcons.ts

| L4 | LiftableViewerHost | unknown | `* Only used inside LiftableViewerHost.heavy (not in entry).` |

### Locava-Native/src/features/liftable/postOpenGuard.ts

| L49 | photoLink | needs_migration | `for (const raw of [post.displayPhotoLink, post.photoLink, post.thumbUrl]) {` |
| L49 | displayPhotoLink | needs_migration | `for (const raw of [post.displayPhotoLink, post.photoLink, post.thumbUrl]) {` |
| L49 | thumbUrl | needs_migration | `for (const raw of [post.displayPhotoLink, post.photoLink, post.thumbUrl]) {` |
| L52 | post.assets | needs_migration | `const assets = post.assets as unknown[] \| undefined;` |
| L115 | post.assets | needs_migration | `const assets = post.assets as unknown[] \| undefined;` |
| L142 | post.assets | needs_migration | `const assets = post.assets as Array<Record<string, unknown>> \| undefined;` |

### Locava-Native/src/features/liftable/PostTile.tsx

| L3 | PostTile | unknown | `* PostTile — Ultra-light grid/list cell. Instagram pattern.` |
| L78 | thumbUrl | needs_migration | `thumbUrl?: string;` |
| L81 | displayPhotoLink | needs_migration | `displayPhotoLink?: string;` |
| L82 | photoLink | needs_migration | `photoLink?: string;` |
| L141 | assets[0] | needs_migration | `const first = assets[0];` |
| L179 | post.assets | needs_migration | `if (!Array.isArray(post?.assets) \|\| post.assets.length === 0) return;` |
| L234 | PostTile | unknown | `export const PostTile = React.memo<PostTileProps>(function PostTile({` |
| L295 | assets[0] | needs_migration | `const first = assets[0];` |
| L312 | posterUrl | unknown | `poster: first.video.posterHighUrl ?? first.video.posterUrl ?? first.video.thumbnailUrl ?? null,` |
| L409 | displayPhotoLink | needs_migration | `const display = post?.displayPhotoLink as string \| undefined;` |
| L410 | thumbUrl | needs_migration | `const thumb = post?.thumbUrl as string \| undefined;` |
| L427 | thumbUrl | needs_migration | `if (fb?.thumbUrl && isUsableGridThumbUrl(fb.thumbUrl)) return fb.thumbUrl.trim();` |
| L430 | photoLink | needs_migration | `}, [post?.id, post?.postId, post?.displayPhotoLink, post?.thumbUrl, post?.assets, post?.photoLink, postId, resolvedPost]);` |
| L430 | displayPhotoLink | needs_migration | `}, [post?.id, post?.postId, post?.displayPhotoLink, post?.thumbUrl, post?.assets, post?.photoLink, postId, resolvedPost]);` |
| L430 | thumbUrl | needs_migration | `}, [post?.id, post?.postId, post?.displayPhotoLink, post?.thumbUrl, post?.assets, post?.photoLink, postId, resolvedPost]);` |
| L688 | PostTile | unknown | `console.warn('[PostTile] Delete failed:', result.error);` |
| L691 | PostTile | unknown | `if (__DEV__) console.warn('[PostTile] Delete error:', err);` |

### Locava-Native/src/features/liftable/thumbUrlUtils.ts

| L2 | photoLink | needs_migration | `* Grid / map tiles must ignore legacy garbage like photoLink ",," (empty joined links).` |
| L3 | displayPhotoLink | needs_migration | `* Otherwise PostTile prefers broken thumbUrl over assets[].poster / displayPhotoLink.` |
| L3 | thumbUrl | needs_migration | `* Otherwise PostTile prefers broken thumbUrl over assets[].poster / displayPhotoLink.` |
| L3 | PostTile | unknown | `* Otherwise PostTile prefers broken thumbUrl over assets[].poster / displayPhotoLink.` |

### Locava-Native/src/features/liftable/utils/assetUriSurface.ts

| L3 | AssetCarouselOnly | unknown | `* Used by {@link LayoutViewerSlide} and {@link AssetCarouselOnly} (keeps one implementation).` |

### Locava-Native/src/features/map/backendv2/mapV2.normalize.ts

| L41 | thumbUrl | needs_migration | `thumbUrl: m.thumbnailUrl ?? undefined,` |
| L65 | thumbUrl | needs_migration | `thumbUrl: m.thumbUrl,` |

### Locava-Native/src/features/map/backendv2/mapV2.select.test.ts

| L12 | thumbUrl | test_fixture | `thumbUrl: 'https://cdn.example.com/post_${index}.jpg',` |
| L53 | thumbUrl | test_fixture | `thumbUrl: 'https://cdn.example.com/unknown_1.jpg',` |

### Locava-Native/src/features/map/backendv2/mapV2.select.ts

| L12 | thumbUrl | needs_migration | `thumbUrl: m.thumbUrl,` |
| L77 | thumbUrl | needs_migration | `thumbUrl: marker.thumbUrl,` |

### Locava-Native/src/features/map/backendv2/mapV2.store.ts

| L95 | thumbUrl | needs_migration | `if (item.thumbUrl && item.thumbUrl.trim().length > 0) return item;` |
| L96 | thumbUrl | needs_migration | `return { ...item, thumbUrl: old.thumbUrl ?? item.thumbUrl, thumbKey: old.thumbKey ?? item.thumbKey };` |
| L105 | thumbUrl | needs_migration | `if (item.thumbUrl && item.thumbUrl.trim().length > 0) return item;` |
| L106 | thumbUrl | needs_migration | `return { ...item, thumbUrl: old.thumbUrl ?? item.thumbUrl, thumbKey: old.thumbKey ?? item.thumbKey };` |

### Locava-Native/src/features/map/backendv2/mapV2.thumbnail-resilience.test.ts

| L31 | thumbUrl | test_fixture | `assert(useMapV2Store.getState().markers[0]?.thumbUrl === 'https://cdn.example.com/p1.jpg', 'expected initial thumbnail');` |
| L33 | thumbUrl | test_fixture | `// Simulate failed/detail-degraded refresh where thumbUrl is missing.` |
| L53 | thumbUrl | test_fixture | `useMapV2Store.getState().markers[0]?.thumbUrl === 'https://cdn.example.com/p1.jpg',` |

### Locava-Native/src/features/map/backendv2/mapV2.types.ts

| L8 | thumbUrl | needs_migration | `thumbUrl?: string;` |

### Locava-Native/src/features/map/chrome/MapChromeBottomSheetShell.tsx

| L32 | PostTile | unknown | `import { PostTile } from "../../liftable/PostTile";` |
| L113 | thumbUrl | needs_migration | `thumbUrl: item.thumbUrl,` |
| L118 | thumbUrl | needs_migration | `thumbUrl: item.thumbUrl,` |
| L121 | thumbUrl | needs_migration | `[hydratedPost, item.id, item.thumbUrl, item.mediaType],` |
| L125 | PostTile | unknown | `<PostTile` |
| L139 | thumbUrl | needs_migration | `prev.item.thumbUrl === next.item.thumbUrl &&` |
| L288 | thumbUrl | needs_migration | `thumbUrl: item.thumbUrl,` |

### Locava-Native/src/features/map/data/mapIndex.api.ts

| L44 | photoLink | needs_migration | `// Thumb: displayPhotoLink / photoLink first; then assets[0].variants.thumb or poster.` |
| L44 | displayPhotoLink | needs_migration | `// Thumb: displayPhotoLink / photoLink first; then assets[0].variants.thumb or poster.` |
| L44 | assets[0] | needs_migration | `// Thumb: displayPhotoLink / photoLink first; then assets[0].variants.thumb or poster.` |
| L45 | photoLink | needs_migration | `// Do not use '??' between display and photo — empty string "" is a common placeholder and would block photoLink / asset fallbacks.` |
| L46 | thumbUrl | needs_migration | `let thumbUrl: string \| undefined;` |
| L73 | thumbUrl | needs_migration | `const topThumbUrl = (p as { thumbUrl?: unknown }).thumbUrl;` |
| L74 | thumbUrl | needs_migration | `thumbUrl = firstUsableThumb(` |
| L75 | displayPhotoLink | needs_migration | `p.displayPhotoLink,` |
| L76 | photoLink | needs_migration | `p.photoLink,` |
| L79 | thumbUrl | needs_migration | `if (!thumbUrl) {` |
| L92 | thumbUrl | needs_migration | `thumbUrl = hit;` |
| L96 | thumbUrl | needs_migration | `if (!thumbUrl) {` |
| L100 | thumbUrl | needs_migration | `thumbUrl = hit;` |
| L106 | thumbUrl | needs_migration | `if (!thumbUrl) thumbUrl = pickString(first?.poster);` |
| L147 | thumbUrl | needs_migration | `thumbUrl,` |

### Locava-Native/src/features/map/data/mapIndex.store.ts

| L95 | thumbUrl | needs_migration | `const usable = rows.filter((r) => isUsableGridThumbUrl(r.thumbUrl));` |
| L114 | thumbUrl | needs_migration | `!isUsableGridThumbUrl(p.thumbUrl) &&` |
| L166 | thumbUrl | needs_migration | `let thumbUrl = enrichThumbFromMetadata(p.postId, p.thumbUrl);` |
| L167 | thumbUrl | needs_migration | `if (!isUsableGridThumbUrl(thumbUrl) && isUsableGridThumbUrl(prev?.thumbUrl)) {` |
| L168 | thumbUrl | needs_migration | `thumbUrl = prev!.thumbUrl;` |
| L170 | thumbUrl | needs_migration | `indexById.set(p.postId, { ...p, thumbUrl });` |
| L303 | thumbUrl | needs_migration | `.filter((p) => !isUsableGridThumbUrl(p.thumbUrl))` |
| L392 | thumbUrl | needs_migration | `* Slim list for native map component (id, lat, lon, thumbUrl, mediaType). Capped at CAP_NATIVE_MAP.` |
| L393 | thumbUrl | needs_migration | `* Enriches thumbUrl from local fallback for just-created posts (Snapchat-style) when server has no thumb yet.` |
| L402 | thumbUrl | needs_migration | `let thumbUrl: string \| undefined = isUsableGridThumbUrl(p.thumbUrl) ? p.thumbUrl : undefined;` |
| L403 | thumbUrl | needs_migration | `if (!thumbUrl) {` |
| L405 | thumbUrl | needs_migration | `if (isUsableGridThumbUrl(fb?.thumbUrl)) thumbUrl = fb!.thumbUrl;` |
| L407 | thumbUrl | needs_migration | `if (!thumbUrl) {` |
| L411 | thumbUrl | needs_migration | `if (h) thumbUrl = h;` |
| L420 | thumbUrl | needs_migration | `thumbUrl,` |

### Locava-Native/src/features/map/data/types.ts

| L11 | thumbUrl | needs_migration | `thumbUrl?: string;` |

### Locava-Native/src/features/map/map.types.ts

| L8 | thumbUrl | needs_migration | `* Matches old LocavaPostsMapPost bridge contract: id, lat, lon, thumbUrl/thumbKey, mediaType.` |
| L14 | thumbUrl | needs_migration | `thumbUrl?: string;` |

### Locava-Native/src/features/map/MapMarkerPin.tsx

| L15 | thumbUrl | needs_migration | `thumbUrl?: string \| null;` |
| L19 | thumbUrl | needs_migration | `function MapMarkerPinInner({ thumbUrl, onPress }: MapMarkerPinProps): React.ReactElement {` |
| L22 | thumbUrl | needs_migration | `{thumbUrl && thumbUrl.trim().length > 0 ? (` |
| L24 | thumbUrl | needs_migration | `source={{ uri: thumbUrl }}` |
| L28 | thumbUrl | needs_migration | `recyclingKey={thumbUrl}` |

### Locava-Native/src/features/map/mapOpenShell.test.ts

| L17 | thumbUrl | test_fixture | `thumbUrl: "https://cdn.example.com/map-post-1.jpg",` |
| L25 | thumbUrl | test_fixture | `thumbUrl: "https://cdn.example.com/map-post-1.jpg",` |
| L49 | thumbUrl | test_fixture | `assert(shell?.thumbUrl === "https://cdn.example.com/map-post-1.jpg", "expected shell thumb from marker");` |

### Locava-Native/src/features/map/mapOpenShell.ts

| L16 | thumbUrl | needs_migration | `function buildMarkerShellAsset(postId: string, mediaType: "image" \| "video", thumbUrl?: string): PostRecord[] \| undefined {` |
| L17 | thumbUrl | needs_migration | `const resolvedThumb = pickNonEmptyString(thumbUrl);` |
| L58 | thumbUrl | needs_migration | `const thumbUrl =` |
| L59 | thumbUrl | needs_migration | `pickNonEmptyString(marker?.thumbUrl) ??` |
| L60 | thumbUrl | needs_migration | `pickNonEmptyString(rawMarker?.thumbUrl) ??` |
| L61 | thumbUrl | needs_migration | `pickNonEmptyString(seed?.thumbUrl) ??` |
| L62 | displayPhotoLink | needs_migration | `pickNonEmptyString(seed?.displayPhotoLink) ??` |
| L63 | photoLink | needs_migration | `pickNonEmptyString(seed?.photoLink);` |
| L88 | thumbUrl | needs_migration | `thumbUrl,` |
| L89 | displayPhotoLink | needs_migration | `displayPhotoLink: thumbUrl,` |
| L89 | thumbUrl | needs_migration | `displayPhotoLink: thumbUrl,` |
| L90 | photoLink | needs_migration | `photoLink: thumbUrl,` |
| L90 | thumbUrl | needs_migration | `photoLink: thumbUrl,` |
| L142 | thumbUrl | needs_migration | `: buildMarkerShellAsset(postId, mediaType, thumbUrl)) ?? [],` |

### Locava-Native/src/features/map/MapSurface.tsx

| L80 | thumbUrl | needs_migration | `thumbUrl: p.thumbUrl,` |
| L291 | thumbUrl | needs_migration | `thumbUrl: post.thumbUrl,` |
| L318 | thumbUrl | needs_migration | `(mergedPost.thumbUrl as string \| undefined) ??` |
| L319 | displayPhotoLink | needs_migration | `(mergedPost.displayPhotoLink as string \| undefined) ??` |
| L320 | thumbUrl | needs_migration | `(post?.thumbUrl as string \| undefined) ??` |

### Locava-Native/src/features/map/PostSpotMapFullScreen.entry.tsx

| L15 | thumbUrl | needs_migration | `thumbUrl?: string \| null;` |
| L16 | thumbUrl | needs_migration | `assetMarkers?: { latitude: number; longitude: number; thumbUrl: string \| null }[];` |

### Locava-Native/src/features/map/PostSpotMapFullScreen.heavy.tsx

| L42 | thumbUrl | needs_migration | `thumbUrl: string \| null;` |
| L49 | thumbUrl | needs_migration | `thumbUrl?: string \| null;` |
| L100 | thumbUrl | needs_migration | `thumbUrl,` |
| L119 | thumbUrl | needs_migration | `return [{ latitude, longitude, thumbUrl: thumbUrl ?? null }];` |
| L120 | thumbUrl | needs_migration | `}, [assetMarkers, latitude, longitude, thumbUrl]);` |
| L183 | thumbUrl | needs_migration | `<MapMarkerPin thumbUrl={m.thumbUrl} />` |

### Locava-Native/src/features/map/postSpotMapFullScreen.store.ts

| L12 | thumbUrl | needs_migration | `thumbUrl: string \| null;` |
| L20 | thumbUrl | needs_migration | `thumbUrl?: string \| null;` |
| L48 | thumbUrl | needs_migration | `thumbUrl: payload.thumbUrl ?? null,` |

### Locava-Native/src/features/map/PostSpotMapFullScreenGate.tsx

| L34 | thumbUrl | needs_migration | `thumbUrl={payload.thumbUrl}` |
| L63 | thumbUrl | needs_migration | `thumbUrl={payload.thumbUrl}` |

### Locava-Native/src/features/map/search/mapSearchBar.store.ts

| L36 | search result | unknown | `/** Called when user selects a search result in the map search modal. Sets activity so posts filter by it. */` |

### Locava-Native/src/features/media/mediaInstrumentationConfig.ts

| L7 | map marker | unknown | `* debugging startup, map marker opens, or feed carousel behavior.` |

### Locava-Native/src/features/media/mediaPrefetchCoordinator.ts

| L186 | post.assets | needs_migration | `const assets = post.assets as unknown[] \| undefined;` |
| L210 | assets[0] | needs_migration | `const t0 = assets[0] as { type?: string } \| undefined;` |
| L363 | assets[0] | needs_migration | `const a = assets[0] as VideoAssetLike \| undefined;` |
| L420 | posterUrl | unknown | `const poster = item.media?.posterUrl;` |
| L450 | assets[0] | needs_migration | `const firstImg = full.assets[0] as { type?: string };` |
| L558 | post.assets | needs_migration | `const assets = e.post.assets as unknown[] \| undefined;` |

### Locava-Native/src/features/media/mediaSourcePolicy.ts

| L783 | assets[0] | needs_migration | `const first = assets[0] as VideoAssetLike \| undefined;` |

### Locava-Native/src/features/media/playbackPlanner.repository.ts

| L53 | profile grid | unknown | `/** Profile grid / map / collection: bias to 720 faststart for faster tap-to-motion. */` |

### Locava-Native/src/features/media/playbackPostModel.test.ts

| L56 | profile grid | test_fixture | `/** Profile grid often sends main720-only variants; MMKV/feed cache may hold faststart URLs. */` |
| L426 | displayPhotoLink | test_fixture | `displayPhotoLink: "https://cdn.example.com/video_10_0_poster.jpg",` |
| L471 | displayPhotoLink | test_fixture | `displayPhotoLink: "https://cdn.example.com/out/poster_frame.jpg?v=2",` |
| L504 | photoLink | test_fixture | `photoLink:` |
| L528 | photoLink | test_fixture | `"comma-separated photoLink must still collapse poster companion image rows",` |
| L533 | thumbUrl | test_fixture | `thumbUrl: "https://cdn.example.com/vd_thumb.jpg",` |
| L628 | displayPhotoLink | test_fixture | `displayPhotoLink: "https://cdn.example.com/video_10b_0_poster.jpg",` |
| L629 | photoLink | test_fixture | `photoLink: "https://instagram.example.com/legacy-video-10b-poster.jpg",` |
| L631 | photoLink | test_fixture | `photoLink: "https://instagram.example.com/legacy-video-10b-poster.jpg",` |
| L679 | displayPhotoLink | test_fixture | `displayPhotoLink: "https://cdn.example.com/video_11_0_poster.jpg",` |

### Locava-Native/src/features/media/playbackPostModel.ts

| L27 | post.assets | needs_migration | `const assets = post.assets as unknown[] \| undefined;` |
| L84 | post.assets | needs_migration | `const assets = post.assets as Record<string, unknown>[] \| undefined;` |
| L122 | post.assets | needs_migration | `const assets = post.assets as unknown[] \| undefined;` |
| L189 | thumbUrl | needs_migration | `asset.thumbUrl,` |
| L190 | displayPhotoLink | needs_migration | `asset.displayPhotoLink,` |
| L292 | profile grid | unknown | `* Merge per-asset 'variants' without letting a thinner layer (e.g. profile grid API row) drop` |
| L748 | photoLink | needs_migration | `* collapse survives comma-separated {@code photoLink} and profile grid shells.` |
| L748 | profile grid | unknown | `* collapse survives comma-separated {@code photoLink} and profile grid shells.` |
| L767 | displayPhotoLink | needs_migration | `ingest(post.displayPhotoLink);` |
| L768 | photoLink | needs_migration | `ingest(post.photoLink);` |
| L769 | thumbUrl | needs_migration | `ingest(post.thumbUrl);` |
| L770 | posterUrl | unknown | `ingest((post as { posterUrl?: unknown }).posterUrl);` |
| L771 | photoLinks2 | unknown | `ingest((post as { photoLinks2?: unknown }).photoLinks2);` |
| L772 | photoLinks3 | unknown | `ingest((post as { photoLinks3?: unknown }).photoLinks3);` |
| L778 | displayPhotoLink | needs_migration | `ingest(legacy.displayPhotoLink);` |
| L779 | photoLink | needs_migration | `ingest(legacy.photoLink);` |
| L780 | photoLinks2 | unknown | `ingest(legacy.photoLinks2);` |
| L781 | photoLinks3 | unknown | `ingest(legacy.photoLinks3);` |
| L1025 | post.assets | needs_migration | `const assets = post.assets as unknown[] \| undefined;` |

### Locava-Native/src/features/media/playbackReadyOpenGate.ts

| L264 | post.assets | needs_migration | `const assets = post.assets as unknown[] \| undefined;` |

### Locava-Native/src/features/media/reelsBootstrapAdapter.ts

| L7 | assets[0] | needs_migration | `* When 'getFullPost' has 'assets[0]' video, prefer that path in callers so startup MP4 fields apply.` |
| L18 | posterUrl | unknown | `posterUrl: boolean;` |
| L27 | posterUrl | unknown | `posterUrl:` |
| L28 | posterUrl | unknown | `typeof media.posterUrl === "string" && media.posterUrl.trim().length > 0,` |
| L49 | posterUrl | unknown | `poster: media.posterUrl,` |
| L50 | posterUrl | unknown | `thumbnail: media.posterUrl,` |
| L52 | posterUrl | unknown | `poster: media.posterUrl,` |

### Locava-Native/src/features/media/resolvePostMediaSource.test.ts

| L17 | fallbackVideoUrl | test_fixture | `fallbackVideoUrl: "https://cdn.example.com/staged-original.mp4",` |
| L18 | thumbUrl | test_fixture | `thumbUrl: "https://cdn.example.com/poster.jpg",` |
| L45 | thumbUrl | test_fixture | `thumbUrl: "file:///poster-local.jpg",` |
| L182 | fallbackVideoUrl | test_fixture | `fallbackVideoUrl: "https://cdn.example.com/avc-fallback.mp4",` |

### Locava-Native/src/features/media/resolvePostMediaSource.ts

| L30 | fallbackVideoUrl | unknown | `fallbackVideoUrl?: string;` |
| L89 | fallbackVideoUrl | unknown | `fallbackVideoUrl?: string;` |
| L90 | posterUrl | unknown | `posterUrl?: string;` |
| L98 | fallbackVideoUrl | unknown | `const fallbackVideoUrl = pickString(` |
| L99 | fallbackVideoUrl | unknown | `post?.fallbackVideoUrl,` |
| L100 | fallbackVideoUrl | unknown | `mediaReadiness?.fallbackVideoUrl,` |
| L103 | posterUrl | unknown | `const posterUrl = pickString(` |
| L104 | posterUrl | unknown | `post?.posterUrl,` |
| L105 | thumbUrl | needs_migration | `post?.thumbUrl,` |
| L106 | displayPhotoLink | needs_migration | `post?.displayPhotoLink,` |
| L125 | fallbackVideoUrl | unknown | `fallbackVideoUrl,` |
| L126 | posterUrl | unknown | `posterUrl,` |
| L196 | fallbackVideoUrl | unknown | `fallbackVideoUrl?: string,` |
| L201 | fallbackVideoUrl | unknown | `...(fallbackVideoUrl ? { fallbackVideoUrl } : {}),` |
| L207 | fallbackVideoUrl | unknown | `...(fallbackVideoUrl ? { original: fallbackVideoUrl } : { original: undefined }),` |
| L214 | fallbackVideoUrl | unknown | `__freshPostSourceKind: fallbackVideoUrl ? "remote_fallback" : "poster_processing",` |
| L271 | posterUrl | unknown | `const fallbackPoster = canonical.posterUrl ?? "";` |
| L292 | fallbackVideoUrl | unknown | `fallbackVideoUrlPresent: Boolean(canonical.fallbackVideoUrl),` |
| L295 | posterUrl | unknown | `posterUrlPresent: Boolean(canonical.posterUrl),` |
| L330 | fallbackVideoUrl | unknown | `fallbackVideoUrlPresent: Boolean(canonical.fallbackVideoUrl),` |
| L333 | posterUrl | unknown | `posterUrlPresent: Boolean(canonical.posterUrl),` |
| L341 | fallbackVideoUrl | unknown | `fallbackVideoUrl: canonical.fallbackVideoUrl,` |
| L346 | fallbackVideoUrl | unknown | `if (canonical.fallbackVideoUrl) {` |
| L356 | fallbackVideoUrl | unknown | `selectedVideoUrl: canonical.fallbackVideoUrl,` |
| L357 | posterUrl | unknown | `posterUrlPresent: Boolean(canonical.posterUrl),` |
| L362 | fallbackVideoUrl | unknown | `post: buildPosterOnlyProcessingPost(base, canonical.fallbackVideoUrl),` |
| L365 | fallbackVideoUrl | unknown | `fallbackVideoUrl: canonical.fallbackVideoUrl,` |
| L377 | fallbackVideoUrl | unknown | `fallbackVideoUrlPresent: Boolean(canonical.fallbackVideoUrl),` |
| L378 | posterUrl | unknown | `selectedVideoUrlKind: canonical.posterUrl ? "poster_only" : "missing",` |
| L380 | posterUrl | unknown | `posterUrlPresent: Boolean(canonical.posterUrl),` |
| L382 | posterUrl | unknown | `reason: canonical.posterUrl ? "poster_only_processing_or_failed" : "missing_media_urls",` |

### Locava-Native/src/features/mixes/ActivityMixDetailScreen.tsx

| L22 | PostTile | unknown | `import { PostTile } from '../liftable/PostTile';` |
| L324 | PostTile | unknown | `<PostTile` |

### Locava-Native/src/features/mixes/mixPlatform.api.ts

| L30 | thumbUrl | needs_migration | `thumbUrl?: string;` |
| L31 | displayPhotoLink | needs_migration | `displayPhotoLink?: string;` |

### Locava-Native/src/features/mixes/mixPostMedia.test.ts

| L19 | fallbackVideoUrl | test_fixture | `fallbackVideoUrl: "https://cdn.example.com/video_720_avc.mp4",` |
| L20 | posterUrl | test_fixture | `media: { posterUrl: "https://cdn.example.com/poster.jpg", aspectRatio: 1.7777 },` |
| L25 | posterUrl | test_fixture | `posterUrl: "https://cdn.example.com/poster.jpg",` |
| L47 | fallbackVideoUrl | test_fixture | `fallbackVideoUrl: "https://cdn.example.com/original.mp4",` |
| L48 | posterUrl | test_fixture | `media: { posterUrl: "https://cdn.example.com/poster-2.jpg" },` |
| L56 | fallbackVideoUrl | test_fixture | `"fallbackVideoUrl must remain playable after mix normalization",` |
| L63 | displayPhotoLink | test_fixture | `displayPhotoLink: "https://cdn.example.com/poster-3.jpg",` |
| L64 | photoLink | test_fixture | `photoLink: "https://legacy.example.com/photo-3.jpg",` |
| L65 | photoLink | test_fixture | `legacy: { photoLink: "https://legacy.example.com/photo-3.jpg" },` |
| L70 | posterUrl | test_fixture | `posterUrl: "https://cdn.example.com/poster-3.jpg",` |
| L96 | displayPhotoLink | test_fixture | `displayPhotoLink: "https://cdn.example.com/poster-4.jpg",` |
| L101 | posterUrl | test_fixture | `posterUrl: "https://cdn.example.com/poster-4.jpg",` |
| L123 | photoLink | test_fixture | `photoLink: "https://legacy.example.com/only-photo.jpg",` |
| L131 | photoLink | test_fixture | `assert(legacyAssets.length === 1, "legacy photoLink-only post should still yield one display asset");` |
| L132 | photoLink | test_fixture | `assert(legacyAssets[0]?.type === "image", "legacy photoLink-only should map to image asset");` |
| L147 | posterUrl | test_fixture | `posterUrl: "https://cdn.example.com/vp.jpg",` |
| L163 | displayPhotoLink | test_fixture | `displayPhotoLink: "https://cdn.example.com/poster-parity.jpg",` |
| L164 | photoLink | test_fixture | `photoLink: "https://legacy.example.com/legacy-parity.jpg",` |
| L165 | photoLink | test_fixture | `legacy: { photoLink: "https://legacy.example.com/legacy-parity.jpg" },` |
| L170 | posterUrl | test_fixture | `posterUrl: "https://cdn.example.com/poster-parity.jpg",` |

### Locava-Native/src/features/mixes/mixPostMedia.ts

| L45 | posterUrl | unknown | `const poster = pickString(asset.poster, asset.posterUrl, asset.thumbnail, posterFallback);` |
| L93 | posterUrl | unknown | `const poster = asset.video.posterHighUrl ?? asset.video.posterUrl ?? asset.video.thumbnailUrl ?? cover;` |
| L128 | displayPhotoLink | needs_migration | `displayPhotoLink: cover,` |
| L129 | thumbUrl | needs_migration | `thumbUrl: cover,` |
| L130 | photoLink | needs_migration | `photoLink: cover,` |
| L134 | fallbackVideoUrl | compatibility_alias_only | `fallbackVideoUrl: appPostV2.compatibility.fallbackVideoUrl ?? undefined,` |
| L135 | posterUrl | unknown | `posterUrl: cover \|\| undefined,` |
| L150 | post.assets | needs_migration | `assets: Array.isArray(post.assets)` |
| L151 | post.assets | needs_migration | `? (post.assets as AnyRecord[]).map((asset) => ({` |
| L154 | posterUrl | unknown | `poster: pickString(asset.poster, asset.posterUrl, asset.thumbnail),` |
| L155 | posterUrl | unknown | `thumbnail: pickString(asset.thumbnail, asset.poster, asset.posterUrl),` |
| L157 | post.assets | needs_migration | `: post.assets,` |
| L164 | assets[0] | needs_migration | `const first = asRecord(assets[0]);` |
| L169 | posterUrl | unknown | `media.posterUrl,` |
| L170 | thumbUrl | needs_migration | `sanitizedInput.thumbUrl,` |
| L171 | displayPhotoLink | needs_migration | `sanitizedInput.displayPhotoLink,` |
| L172 | photoLink | needs_migration | `sanitizedInput.photoLink,` |
| L173 | photoLink | needs_migration | `legacy.photoLink as string \| undefined,` |
| L189 | fallbackVideoUrl | unknown | `const fallbackVideoUrl = pickString(` |
| L190 | fallbackVideoUrl | unknown | `sanitizedInput.fallbackVideoUrl,` |
| L191 | fallbackVideoUrl | unknown | `asRecord(sanitizedInput.mediaReadiness).fallbackVideoUrl,` |
| L226 | fallbackVideoUrl | unknown | `fallbackVideoUrlPresent: Boolean(fallbackVideoUrl),` |
| L229 | fallbackVideoUrl | unknown | `: fallbackVideoUrl` |
| L234 | fallbackVideoUrl | unknown | `selectedVideoUrl: playbackUrl \|\| fallbackVideoUrl \|\| null,` |
| L240 | fallbackVideoUrl | unknown | `reason: !playbackUrl && !fallbackVideoUrl && !poster ? "missing_video_and_poster_urls" : null,` |
| L253 | displayPhotoLink | needs_migration | `displayPhotoLink: poster,` |
| L254 | thumbUrl | needs_migration | `thumbUrl: poster,` |
| L255 | photoLink | needs_migration | `photoLink: poster,` |
| L266 | fallbackVideoUrl | unknown | `fallbackVideoUrl: fallbackVideoUrl \|\| undefined,` |
| L267 | posterUrl | unknown | `posterUrl: poster \|\| undefined,` |

### Locava-Native/src/features/mixes/mixShelfSession.cache.ts

| L44 | thumbUrl | needs_migration | `(post as Record<string, unknown>)?.thumbUrl ??` |
| L45 | displayPhotoLink | needs_migration | `(post as Record<string, unknown>)?.displayPhotoLink ??` |
| L46 | photoLink | needs_migration | `(post as Record<string, unknown>)?.photoLink ??` |

### Locava-Native/src/features/mixes/mixShelfWarmPrefetch.ts

| L20 | thumbUrl | needs_migration | `thumbUrl?: string;` |
| L21 | displayPhotoLink | needs_migration | `displayPhotoLink?: string;` |
| L37 | thumbUrl | needs_migration | `thumbUrl: p.thumbUrl,` |
| L38 | displayPhotoLink | needs_migration | `displayPhotoLink: p.displayPhotoLink,` |

### Locava-Native/src/features/mixes/openActivityMixAsCollection.ts

| L37 | photoLink | needs_migration | `const u = String(o?.thumbUrl ?? o?.displayPhotoLink ?? o?.photoLink ?? o?.media?.posterUrl ?? '').trim();` |
| L37 | displayPhotoLink | needs_migration | `const u = String(o?.thumbUrl ?? o?.displayPhotoLink ?? o?.photoLink ?? o?.media?.posterUrl ?? '').trim();` |
| L37 | thumbUrl | needs_migration | `const u = String(o?.thumbUrl ?? o?.displayPhotoLink ?? o?.photoLink ?? o?.media?.posterUrl ?? '').trim();` |
| L37 | posterUrl | unknown | `const u = String(o?.thumbUrl ?? o?.displayPhotoLink ?? o?.photoLink ?? o?.media?.posterUrl ?? '').trim();` |
| L46 | photoLink | needs_migration | `const u = String(o?.thumbUrl ?? o?.displayPhotoLink ?? o?.photoLink ?? '').trim();` |
| L46 | displayPhotoLink | needs_migration | `const u = String(o?.thumbUrl ?? o?.displayPhotoLink ?? o?.photoLink ?? '').trim();` |
| L46 | thumbUrl | needs_migration | `const u = String(o?.thumbUrl ?? o?.displayPhotoLink ?? o?.photoLink ?? '').trim();` |
| L61 | photoLink | needs_migration | `o.thumbUrl ?? o.displayPhotoLink ?? o.photoLink ?? media?.posterUrl ?? '',` |
| L61 | displayPhotoLink | needs_migration | `o.thumbUrl ?? o.displayPhotoLink ?? o.photoLink ?? media?.posterUrl ?? '',` |
| L61 | thumbUrl | needs_migration | `o.thumbUrl ?? o.displayPhotoLink ?? o.photoLink ?? media?.posterUrl ?? '',` |
| L61 | posterUrl | unknown | `o.thumbUrl ?? o.displayPhotoLink ?? o.photoLink ?? media?.posterUrl ?? '',` |

### Locava-Native/src/features/mixes/ui/ActivityMixesGrid.tsx

| L97 | thumbUrl | needs_migration | `thumbUrl?: string;` |
| L108 | thumbUrl | needs_migration | `thumbUrl?: string;` |
| L391 | thumbUrl | needs_migration | `thumbUrl: p.thumbUrl,` |
| L392 | displayPhotoLink | needs_migration | `displayPhotoLink: p.displayPhotoLink,` |
| L537 | thumbUrl | needs_migration | `thumbUrl: p.thumbUrl,` |
| L538 | displayPhotoLink | needs_migration | `displayPhotoLink: p.displayPhotoLink,` |
| L809 | thumbUrl | needs_migration | `const thumbUrl = thumbUrlsFromPosts(posts as Record<string, unknown>[])[0];` |
| L817 | thumbUrl | needs_migration | `thumbUrl,` |
| L828 | thumbUrl | needs_migration | `thumbUrl: collectionThumbUrl(dailyCollection),` |
| L838 | thumbUrl | needs_migration | `thumbUrl: collectionThumbUrl(nearbyCollection),` |
| L867 | thumbUrl | needs_migration | `uri: card.thumbUrl ?? null,` |
| L1040 | thumbUrl | needs_migration | `{card.thumbUrl ? (` |
| L1042 | thumbUrl | needs_migration | `source={buildCachedCoverSource(card.thumbUrl, 'mix-grid:${card.id}') ?? { uri: card.thumbUrl }}` |

### Locava-Native/src/features/mixes/ui/ActivityMixesShelf.tsx

| L216 | thumbUrl | needs_migration | `thumbUrl: p.thumbUrl,` |
| L217 | displayPhotoLink | needs_migration | `displayPhotoLink: p.displayPhotoLink,` |
| L360 | thumbUrl | needs_migration | `thumbUrl: p.thumbUrl,` |
| L361 | displayPhotoLink | needs_migration | `displayPhotoLink: p.displayPhotoLink,` |

### Locava-Native/src/features/mixes/ui/AreaMixShelf.tsx

| L32 | thumbUrl | needs_migration | `thumbUrl?: string;` |
| L33 | displayPhotoLink | needs_migration | `displayPhotoLink?: string;` |
| L38 | thumbUrl | needs_migration | `(p as any).thumbUrl \|\|` |
| L39 | displayPhotoLink | needs_migration | `(p as any).displayPhotoLink \|\|` |
| L40 | photoLink | needs_migration | `(p as any).photoLink \|\|` |
| L41 | posterUrl | unknown | `(p as any).media?.posterUrl;` |

### Locava-Native/src/features/notifications/backendv2/notificationsRealtime.listener.ts

| L106 | notification | unknown | `message: item.message?.trim() \|\| 'Notification',` |

### Locava-Native/src/features/notifications/backendv2/notificationsSurfaceBridge.ts

| L6 | notification | unknown | `import { refreshNotificationsList } from '../state/notification.repository';` |

### Locava-Native/src/features/notifications/backendv2/notificationsV2.normalize.ts

| L2 | notification | legacy_fallback_inside_helper | `* Map Backendv2 notification summaries → legacy 'NotificationItem' for existing list UI.` |
| L23 | thumbUrl | needs_migration | `const thumb = row.preview?.thumbUrl?.trim() ?? '';` |

### Locava-Native/src/features/notifications/backendv2/notificationsV2.owner.ts

| L9 | notification | unknown | `import { commitNotificationsSnapshotToStores } from '../state/notification.repository';` |

### Locava-Native/src/features/notifications/backendv2/notificationsV2.types.ts

| L34 | thumbUrl | needs_migration | `preview: { text: string \| null; thumbUrl: string \| null };` |

### Locava-Native/src/features/notifications/notificationBanner.store.ts

| L2 | notification | unknown | `* Real-time notification banner store — queue + current item for in-app toast.` |
| L105 | notification | unknown | `/** Map expo push notification content (foreground received) to BannerNotificationItem. */` |
| L106 | notification | unknown | `export function buildBannerItemFromPushContent(notification: {` |
| L116 | notification | unknown | `const { identifier, content } = notification.request;` |
| L198 | notification | unknown | `system: 'Notification',` |
| L199 | notification | unknown | `route: 'Notification',` |
| L201 | notification | unknown | `return map[t] ?? 'Notification';` |

### Locava-Native/src/features/notifications/notificationBanner.tokens.ts

| L3 | notification | unknown | `* Notification banner (in-app toast) design tokens — match old NotifcationOverlay.jsx.` |

### Locava-Native/src/features/notifications/NotificationBanner.tsx

| L2 | notification | unknown | `* Real-time notification banner UI — slide-in toast, avatar, message, tap/swipe.` |
| L173 | notification | unknown | `variant="notification"` |

### Locava-Native/src/features/notifications/NotificationBannerGate.tsx

| L2 | notification | unknown | `* Notification banner gate — subscribes to banner store and modal state;` |

### Locava-Native/src/features/notifications/notifications.api.ts

| L110 | notification | unknown | `/** Fetch notification stats (includes unread count) for real-time badge. GET /api/notifications/stats */` |
| L129 | notification | unknown | `error: error instanceof Error ? error.message : 'Failed to fetch notification stats',` |

### Locava-Native/src/features/notifications/Notifications.heavy.tsx

| L41 | notification | unknown | `} from './state/notification.repository';` |
| L266 | notification | unknown | `variant="notification"` |

### Locava-Native/src/features/notifications/notificationsModal.store.ts

| L6 | notification | unknown | `import { hydrateNotificationStateFromCache } from './state/notification.repository';` |
| L19 | notification | unknown | `/** Legacy compatibility hook; now hydrates canonical notification domain state. */` |

### Locava-Native/src/features/notifications/NotificationsModalGate.tsx

| L18 | notification | unknown | `import { markAllNotificationsReadFromOpen } from './state/notification.repository';` |

### Locava-Native/src/features/notifications/openNotificationPost.ts

| L22 | notification | unknown | `/** Measured from notification row avatar; open ghost uses post media only — see closeHeroUri for dismiss. */` |
| L117 | notification | unknown | `openedFromSurface: 'notification',` |
| L122 | notification | unknown | `postEntityStore.upsert(postId, notificationPayload, { openedFromSurface: 'notification' });` |
| L180 | notification | unknown | `// Avoid awaiting token/network here — that was freezing notification → post behind auth + API.` |

### Locava-Native/src/features/notifications/openPostDiscoveryNotification.ts

| L45 | thumbUrl | needs_migration | `post.thumbUrl ??` |
| L46 | displayPhotoLink | needs_migration | `post.displayPhotoLink ??` |
| L47 | photoLink | needs_migration | `post.photoLink ??` |
| L48 | posterUrl | unknown | `media?.posterUrl ??` |
| L170 | post.assets | needs_migration | `hasAssets: Array.isArray(post.assets) ? post.assets.length : null,` |

### Locava-Native/src/features/notifications/pushNotifications.ts

| L171 | notification | unknown | `* Ask for notification permission if not already granted, then when allowed get Expo push token and sync to v2.` |

### Locava-Native/src/features/notifications/registerForegroundNotificationHandler.ts

| L2 | notification | unknown | `* Must run at app startup (before UI). Expo requires a notification handler for foreground` |

### Locava-Native/src/features/notifications/state/notification.repository.ts

| L87 | notification | unknown | `logCutoverStubEvent('hydrate-skip', 'notification.repository', 'hydrateNotificationStateFromCache');` |
| L124 | notification | unknown | `logCutoverStubEvent('bootstrap-skip', 'notification.repository', 'refreshNotificationsList');` |
| L222 | notification | unknown | `logCutoverStubEvent('polling-skip', 'notification.repository', 'refreshNotificationUnreadCount');` |
| L232 | notification | unknown | `return { success: false, error: result.error ?? 'Failed to fetch notification stats' };` |
| L269 | notification | unknown | `logCutoverStubEvent('api', 'notification.repository', 'markAllNotificationsReadFromOpen skip server');` |

### Locava-Native/src/features/onboarding/newFlow/components/NotificationPermissionPreview.tsx

| L34 | notification | unknown | `accessibilityLabel="Notification settings preview"` |

### Locava-Native/src/features/onboarding/newFlow/screens/ProfilePictureScreen.tsx

| L69 | assets[0] | needs_migration | `setSelectedUri(result.assets[0].uri);` |
| L96 | assets[0] | needs_migration | `setSelectedUri(result.assets[0].uri);` |

### Locava-Native/src/features/onboarding/newFlow/screens/WelcomePagerScreen.tsx

| L16 | notification | unknown | `/** Same asset as 'PostSignInNotificationPrompt' — notification settings preview. */` |
| L311 | notification | unknown | `if (__DEV__) console.warn('[WelcomePagerScreen] Notification permission request failed:', e);` |

### Locava-Native/src/features/onboarding/steps/ProfilePictureStep.tsx

| L106 | assets[0] | needs_migration | `setSelectedUri(result.assets[0].uri);` |
| L133 | assets[0] | needs_migration | `setSelectedUri(result.assets[0].uri);` |

### Locava-Native/src/features/onboarding/steps/WelcomeStep.tsx

| L127 | notification | unknown | `if (__DEV__) console.warn('[WelcomeStep] Notification permission request failed:', e);` |

### Locava-Native/src/features/post/drafts/savePostDraft.ts

| L47 | displayPhotoLink | needs_migration | `displayPhotoLink: thumbnails[0] \|\| photoLinks[0] \|\| null,` |

### Locava-Native/src/features/post/EditModal.heavy.tsx

| L61 | AssetCarouselOnly | unknown | `import { ASPECT_RATIO_TOO_SQUARE_THRESHOLD } from "../liftable/AssetCarouselOnly";` |

### Locava-Native/src/features/post/InfoModal.tsx

| L76 | thumbUrl | needs_migration | `thumbUrl?: string \| null;` |
| L77 | thumbUrl | needs_migration | `assetMarkers?: Array<{ latitude: number; longitude: number; thumbUrl: string \| null }>;` |
| L296 | thumbUrl | needs_migration | `return { latitude: la, longitude: ln, thumbUrl: thumb };` |
| L298 | thumbUrl | needs_migration | `.filter((m): m is { latitude: number; longitude: number; thumbUrl: string \| null } => m != null);` |
| L737 | thumbUrl | needs_migration | `thumbUrl={` |

### Locava-Native/src/features/post/layout/LayoutViewerSlide.tsx

| L12 | post.assets | needs_migration | `/** Same ordered list as AssetCarouselOnly 'list' (post.assets). */` |
| L12 | AssetCarouselOnly | unknown | `/** Same ordered list as AssetCarouselOnly 'list' (post.assets). */` |

### Locava-Native/src/features/post/photoMetadata.ts

| L4 | AssetCarouselOnly | unknown | `import { ASPECT_RATIO_TOO_SQUARE_THRESHOLD } from "../liftable/AssetCarouselOnly";` |

### Locava-Native/src/features/post/post.types.ts

| L8 | mediaItems | unknown | `/** Single selected asset for post flow — matches old app mediaItems contract. */` |

### Locava-Native/src/features/post/postAssets.store.ts

| L3 | mediaItems | unknown | `* Single source of truth; no heavy imports. Matches old app mediaItems contract.` |

### Locava-Native/src/features/post/PostFlowImageSlide.tsx

| L72 | LiftableViewerHost | unknown | `// Keep post-flow behavior aligned with LiftableViewerHost: fit mode always uses contain.` |

### Locava-Native/src/features/post/postFlowMediaFit.ts

| L4 | LiftableViewerHost | unknown | `* CAROUSEL_FIT_WIDTH_FOR_SQUARE_IMAGES in LiftableViewerHost.` |

### Locava-Native/src/features/post/PostLayoutLogic.tsx

| L1073 | assets[0] | needs_migration | `const asset = result.assets[0];` |

### Locava-Native/src/features/post/SetLocationModal.tsx

| L618 | map marker | unknown | `/** Fixed center reticle — map pans underneath (not a map Marker). */` |

### Locava-Native/src/features/post/upload/directPostUploadClient.ts

| L128 | displayPhotoLink | needs_migration | `* Used as the post tile thumbnail (displayPhotoLink). Uploaded separately from the video poster,` |
| L226 | posterUrl | unknown | `posterUrl?: string;` |
| L230 | fallbackVideoUrl | unknown | `fallbackVideoUrl?: string;` |
| L266 | posterUrl | unknown | `posterUrl?: string;` |
| L540 | posterUrl | unknown | `posterUrl?: string;` |
| L570 | displayPhotoLink | needs_migration | `* Raw base64 (no data-URL prefix required). Uploaded as displayPhoto so displayPhotoLink exists` |
| L630 | displayPhotoLink | needs_migration | `* Link previews (iMessage, etc.) need displayPhotoLink immediately; staged create has no multipart displayPhoto.` |

### Locava-Native/src/features/post/upload/localPostFallback.model.test.ts

| L12 | thumbUrl | test_fixture | `thumbUrl: "file:///thumb.jpg",` |
| L32 | assets[0] | test_fixture | `assert(assets[0]?.localUri === "file:///photo.jpg", "image local uri should be preserved");` |
| L41 | thumbUrl | test_fixture | `thumbUrl: "https://cdn.example.com/thumb.jpg",` |

### Locava-Native/src/features/post/upload/localPostFallback.model.ts

| L38 | thumbUrl | needs_migration | `thumbUrl: string;` |
| L155 | thumbUrl | needs_migration | `const thumbUrl =` |
| L156 | thumbUrl | needs_migration | `typeof entry.thumbUrl === "string" && entry.thumbUrl.trim()` |
| L157 | thumbUrl | needs_migration | `? entry.thumbUrl.trim()` |
| L169 | thumbUrl | needs_migration | `...(thumbUrl ? { thumbUrl } : {}),` |
| L170 | thumbUrl | needs_migration | `...(thumbUrl &&` |
| L171 | displayPhotoLink | needs_migration | `(typeof patch.displayPhotoLink !== "string" \|\| !patch.displayPhotoLink.trim())` |
| L172 | displayPhotoLink | needs_migration | `? { displayPhotoLink: thumbUrl }` |
| L172 | thumbUrl | needs_migration | `? { displayPhotoLink: thumbUrl }` |

### Locava-Native/src/features/post/upload/localPostFallback.store.ts

| L21 | thumbUrl | needs_migration | `thumbUrl: string;` |
| L146 | thumbUrl | needs_migration | `thumbUrl: string;` |
| L158 | thumbUrl | needs_migration | `thumbUrl: payload.thumbUrl,` |
| L252 | thumbUrl | needs_migration | `thumbUrl: existing.thumbUrl,` |

### Locava-Native/src/features/post/upload/localPostFallbackSanitizer.test.ts

| L26 | thumbUrl | test_fixture | `thumbUrl: "https://cdn.example.com/thumb.jpg",` |
| L67 | thumbUrl | test_fixture | `thumbUrl: "https://cdn.example.com/thumb.jpg",` |

### Locava-Native/src/features/post/upload/postPolling.model.test.ts

| L14 | displayPhotoLink | test_fixture | `displayPhotoLink: 'https://cdn.example.com/poster.jpg',` |

### Locava-Native/src/features/post/upload/postPolling.model.ts

| L25 | displayPhotoLink | needs_migration | `push(post.displayPhotoLink);` |
| L26 | photoLink | needs_migration | `push(post.photoLink);` |
| L27 | thumbUrl | needs_migration | `push(post.thumbUrl);` |
| L29 | post.assets | needs_migration | `const assets = Array.isArray(post.assets) ? post.assets : [];` |
| L56 | post.assets | needs_migration | `const assets = Array.isArray(post?.assets) ? post.assets : [];` |

### Locava-Native/src/features/post/upload/postPolling.ts

| L51 | post.assets | needs_migration | `const assetCount = Array.isArray(post.assets) ? post.assets.length : 0;` |
| L52 | post.assets | needs_migration | `const hasVideo = Array.isArray(post.assets)` |
| L53 | post.assets | needs_migration | `? post.assets.some(` |
| L186 | post.assets | needs_migration | `const assetsRaw = Array.isArray(post.assets) ? post.assets : [];` |

### Locava-Native/src/features/post/upload/postSessionStaging.ts

| L345 | posterUrl | unknown | `posterUrl?: string;` |
| L387 | posterUrl | unknown | `posterUrl?: string;` |
| L984 | posterUrl | unknown | `stagedPosterUrl: registry.completedSlot.posterUrl,` |
| L1073 | posterUrl | unknown | `posterUrl: u.posterUrl,` |
| L1146 | posterUrl | unknown | `stagedPosterUrl: presign.posterUrl,` |

### Locava-Native/src/features/post/upload/runPostUpload.ts

| L347 | imageUrl | unknown | `imageUrl: delta.weeklyCapture.imageUrl,` |
| L1441 | posterUrl | unknown | `posterUrl: stagedState?.stagedPosterUrl,` |
| L1721 | thumbUrl | needs_migration | `const thumbUrl = (() => {` |
| L1752 | thumbUrl | needs_migration | `markerImageUri: thumbUrl \|\| null,` |
| L1799 | thumbUrl | needs_migration | `useProfileStore.getState().setOptimisticPostFromUpload({ postId, thumbUrl });` |
| L1865 | thumbUrl | needs_migration | `thumbUrl,` |
| L1889 | thumbUrl | needs_migration | `if (!thumbUrl && firstIsVideo && firstMedia) {` |
| L1902 | thumbUrl | needs_migration | `thumbUrl: lateThumb,` |
| L1916 | thumbUrl | needs_migration | `useProfileStore.getState().setOptimisticPostFromUpload({ postId, thumbUrl: lateThumb });` |
| L2021 | thumbUrl | needs_migration | `let nextThumb = thumbUrl;` |
| L2026 | thumbUrl | needs_migration | `thumbUrl: nextThumb,` |
| L2041 | thumbUrl | needs_migration | `if (nextThumb && !thumbUrl) {` |
| L2043 | thumbUrl | needs_migration | `useProfileStore.getState().setOptimisticPostFromUpload({ postId, thumbUrl: nextThumb });` |
| L2055 | thumbUrl | needs_migration | `!thumbUrl` |
| L2064 | thumbUrl | needs_migration | `useProfileStore.getState().setOptimisticPostFromUpload({ postId, thumbUrl: lateThumb });` |
| L2070 | thumbUrl | needs_migration | `thumbUrl: lateThumb,` |
| L2209 | thumbUrl | needs_migration | `markerImageUri: thumbUrl \|\| null,` |

### Locava-Native/src/features/posts/appPostV2/AppPostMediaCarouselV2.tsx

| L11 | media.assets | migrated_appPostV2 | `/** Single carousel implementation for full post viewers — feeds ordered 'media.assets[]'. */` |

### Locava-Native/src/features/posts/appPostV2/AppPostVideoAssetV2.tsx

| L24 | posterUrl | migrated_appPostV2 | `posterUrl,` |
| L35 | posterUrl | migrated_appPostV2 | `posterUrl,` |

### Locava-Native/src/features/posts/appPostV2/assertAppPostV2.ts

| L27 | thumbUrl | migrated_appPostV2 | `const coverUri = post.media.cover.url ?? post.media.cover.thumbUrl ?? post.media.cover.posterUrl;` |
| L27 | posterUrl | migrated_appPostV2 | `const coverUri = post.media.cover.url ?? post.media.cover.thumbUrl ?? post.media.cover.posterUrl;` |

### Locava-Native/src/features/posts/appPostV2/getPostCover.ts

| L10 | photoLink | migrated_appPostV2 | `return c.url ?? c.posterUrl ?? c.thumbUrl ?? post.compatibility.displayPhotoLink ?? post.compatibility.photoLink ?? null;` |
| L10 | displayPhotoLink | migrated_appPostV2 | `return c.url ?? c.posterUrl ?? c.thumbUrl ?? post.compatibility.displayPhotoLink ?? post.compatibility.photoLink ?? null;` |
| L10 | thumbUrl | migrated_appPostV2 | `return c.url ?? c.posterUrl ?? c.thumbUrl ?? post.compatibility.displayPhotoLink ?? post.compatibility.photoLink ?? null;` |
| L10 | posterUrl | migrated_appPostV2 | `return c.url ?? c.posterUrl ?? c.thumbUrl ?? post.compatibility.displayPhotoLink ?? post.compatibility.photoLink ?? null;` |

### Locava-Native/src/features/posts/appPostV2/getPostMediaAssets.ts

| L5 | media.assets | migrated_appPostV2 | `return Array.isArray(post.media?.assets) ? post.media.assets.slice().sort((a, b) => a.index - b.index) : [];` |

### Locava-Native/src/features/posts/appPostV2/normalizeAppPostV2.ts

| L14 | media.assets | migrated_appPostV2 | `if (!isRecord(media) \|\| !Array.isArray(media.assets)) return null;` |

### Locava-Native/src/features/posts/postCanonical.test.ts

| L18 | displayPhotoLink | test_fixture | `displayPhotoLink:` |
| L96 | photoLink | test_fixture | `photoLink:` |
| L98 | displayPhotoLink | test_fixture | `displayPhotoLink:` |
| L112 | posterUrl | test_fixture | `posterUrl:` |
| L128 | posterUrl | test_fixture | `"expected posterUrl to normalize into poster",` |
| L133 | posterUrl | test_fixture | `"expected posterUrl to normalize into thumbnail fallback",` |
| L136 | photoLink | test_fixture | `washingtonMigratedPosterPost?.photoLink ===` |
| L138 | photoLink | test_fixture | `"expected canonical photoLink to preserve legacy poster url instead of collapsing to displayPhotoLink",` |
| L138 | displayPhotoLink | test_fixture | `"expected canonical photoLink to preserve legacy poster url instead of collapsing to displayPhotoLink",` |

### Locava-Native/src/features/posts/postCanonical.ts

| L191 | posterUrl | unknown | `asset.posterUrl,` |
| L193 | thumbUrl | needs_migration | `asset.thumbUrl,` |
| L201 | thumbUrl | needs_migration | `asset.thumbUrl,` |
| L203 | posterUrl | unknown | `asset.posterUrl,` |
| L294 | post.assets | needs_migration | `(Array.isArray(post.assets) &&` |
| L295 | post.assets | needs_migration | `post.assets.some(` |
| L300 | thumbUrl | needs_migration | `const thumbUrl =` |
| L302 | thumbUrl | needs_migration | `post.thumbUrl,` |
| L303 | displayPhotoLink | needs_migration | `post.displayPhotoLink,` |
| L304 | photoLink | needs_migration | `post.photoLink,` |
| L307 | photoLink | needs_migration | `if (typeof post.photoLink === "string" && post.photoLink.includes(",")) {` |
| L308 | photoLink | needs_migration | `return post.photoLink` |
| L316 | post.assets | needs_migration | `const normalizedAssets = Array.isArray(post.assets)` |
| L317 | post.assets | needs_migration | `? post.assets` |
| L321 | thumbUrl | needs_migration | `normalizeAsset(asset, index, postId, inferredMediaType, thumbUrl, playbackLab),` |
| L323 | thumbUrl | needs_migration | `: buildFallbackAssets(postId, inferredMediaType, thumbUrl);` |
| L350 | displayPhotoLink | needs_migration | `const resolvedDisplayPhotoLink = pickNonEmptyString(post.displayPhotoLink, thumbUrl);` |
| L350 | thumbUrl | needs_migration | `const resolvedDisplayPhotoLink = pickNonEmptyString(post.displayPhotoLink, thumbUrl);` |
| L351 | photoLink | needs_migration | `const resolvedPhotoLink = pickNonEmptyString(post.photoLink, thumbUrl);` |
| L351 | thumbUrl | needs_migration | `const resolvedPhotoLink = pickNonEmptyString(post.photoLink, thumbUrl);` |
| L358 | thumbUrl | needs_migration | `...(thumbUrl ? { thumbUrl } : {}),` |
| L359 | displayPhotoLink | needs_migration | `...(resolvedDisplayPhotoLink ? { displayPhotoLink: resolvedDisplayPhotoLink } : {}),` |
| L360 | photoLink | needs_migration | `...(resolvedPhotoLink ? { photoLink: resolvedPhotoLink } : {}),` |
| L439 | displayPhotoLink | needs_migration | `...(firstAsset?.poster && !pickNonEmptyString(post.displayPhotoLink)` |
| L440 | displayPhotoLink | needs_migration | `? { displayPhotoLink: firstAsset.poster }` |
| L442 | thumbUrl | needs_migration | `...(firstAsset?.poster && !pickNonEmptyString(post.thumbUrl)` |
| L443 | thumbUrl | needs_migration | `? { thumbUrl: firstAsset.poster }` |
| L445 | photoLink | needs_migration | `...(firstAsset?.poster && !pickNonEmptyString(post.photoLink)` |
| L446 | photoLink | needs_migration | `? { photoLink: firstAsset.poster }` |

### Locava-Native/src/features/posts/postEnvelope.test.ts

| L22 | displayPhotoLink | test_fixture | `displayPhotoLink: 'https://cdn.example.com/poster.jpg',` |
| L56 | displayPhotoLink | test_fixture | `displayPhotoLink: 'https://cdn.example.com/poster-thin.jpg',` |
| L59 | notification | test_fixture | `{ openedFromSurface: 'notification', hydrationWasBlocking: false },` |
| L62 | notification | test_fixture | `openedFromSurface: 'notification',` |
| L67 | notification | test_fixture | `'notification merge should keep richer cached playable video URL',` |
| L71 | notification | test_fixture | `'notification merge should keep embedded comment preview content',` |
| L79 | displayPhotoLink | test_fixture | `displayPhotoLink: 'https://cdn.example.com/chat-poster.jpg',` |
| L133 | displayPhotoLink | test_fixture | `displayPhotoLink: 'https://cdn.example.com/marker-poster.jpg',` |
| L146 | displayPhotoLink | test_fixture | `displayPhotoLink: 'https://cdn.example.com/poster-only.jpg',` |
| L172 | displayPhotoLink | test_fixture | `displayPhotoLink: 'https://cdn.example.com/only-thumb.jpg',` |
| L175 | notification | test_fixture | `{ openedFromSurface: 'notification' },` |
| L188 | displayPhotoLink | test_fixture | `displayPhotoLink: 'https://cdn.example.com/poster.jpg',` |
| L201 | fallbackVideoUrl | test_fixture | `fallbackVideoUrl: 'https://cdn.example.com/batch-original.mp4',` |
| L220 | fallbackVideoUrl | test_fixture | `(mergedPlaybackBatch as Record<string, unknown>)?.fallbackVideoUrl ===` |

### Locava-Native/src/features/posts/postEnvelope.ts

| L79 | fallbackVideoUrl | unknown | `/** Backend already picks 'playbackUrl' / 'fallbackVideoUrl'; HLS adaptive after faststart ladders. */` |
| L153 | fallbackVideoUrl | unknown | `const explicitFallbackVideoUrl = pickString(post.fallbackVideoUrl, mediaReadiness.fallbackVideoUrl);` |
| L165 | post.assets | needs_migration | `const assets = Array.isArray(post.assets) ? (post.assets as PostRecord[]) : [];` |
| L209 | post.assets | needs_migration | `const hasAssetsArray = Array.isArray(post.assets) && post.assets.length > 0;` |
| L278 | post.assets | needs_migration | `const assetsLen = Array.isArray(post.assets) ? post.assets.length : 0;` |

### Locava-Native/src/features/posts/postHydrationMerge.test.ts

| L118 | thumbUrl | test_fixture | `thumbUrl: "https://cdn.example.com/poster.jpg",` |

### Locava-Native/src/features/profile/backendv2/profileSurfaceBridge.ts

| L4 | profile grid | unknown | `* When 'isProfileV2Enabled()' is true, the Profile grid and pagination` |
| L41 | thumbUrl | needs_migration | `thumbUrl: i.thumbUrl,` |
| L155 | PostTile | unknown | `* Does not open the viewer — 'PostTile' still owns the transition.` |

### Locava-Native/src/features/profile/backendv2/profileV2.normalize.ts

| L7 | thumbUrl | needs_migration | `*    postId, thumbUrl, mediaType) are validated by the caller (the owner` |
| L91 | thumbUrl | needs_migration | `thumbUrl: item.thumbUrl,` |
| L92 | displayPhotoLink | needs_migration | `displayPhotoLink: item.thumbUrl,` |
| L92 | thumbUrl | needs_migration | `displayPhotoLink: item.thumbUrl,` |
| L101 | thumbUrl | needs_migration | `thumbUrl: item.thumbUrl,` |
| L123 | thumbUrl | needs_migration | `thumbUrl: view.thumbUrl,` |
| L250 | thumbUrl | needs_migration | `thumbUrl: post.thumbUrl,` |
| L270 | thumbUrl | needs_migration | `thumbUrl: post.thumbUrl,` |
| L274 | post.assets | needs_migration | `assets: Array.isArray(post.assets) ? post.assets.slice() : [],` |
| L297 | thumbUrl | needs_migration | `thumbUrl: post.thumbUrl,` |
| L298 | post.assets | needs_migration | `assets: Array.isArray(post.assets) ? post.assets.slice() : [],` |

### Locava-Native/src/features/profile/backendv2/profileV2.owner.ts

| L230 | thumbUrl | needs_migration | `thumbUrl: string;` |
| L273 | thumbUrl | needs_migration | `thumbUrl: String(canonical.thumbUrl ?? ''),` |

### Locava-Native/src/features/profile/backendv2/profileV2.store.model.test.ts

| L16 | thumbUrl | test_fixture | `thumbUrl: 'https://example.com/${postId}.jpg',` |

### Locava-Native/src/features/profile/backendv2/profileV2.types.ts

| L17 | thumbUrl | needs_migration | `thumbUrl: string;` |
| L257 | thumbUrl | needs_migration | `thumbUrl: string;` |
| L264 | posterUrl | unknown | `posterUrl?: string;` |
| L268 | fallbackVideoUrl | unknown | `fallbackVideoUrl?: string;` |
| L326 | thumbUrl | needs_migration | `thumbUrl: string;` |
| L377 | thumbUrl | needs_migration | `thumbUrl: string;` |

### Locava-Native/src/features/profile/profile.api.ts

| L21 | photoLink | needs_migration | `photoLink?: string;` |
| L22 | displayPhotoLink | needs_migration | `displayPhotoLink?: string;` |
| L23 | thumbUrl | needs_migration | `thumbUrl?: string;` |
| L64 | imageUrl | unknown | `imageUrl?: string;` |
| L74 | imageUrl | unknown | `imageUrl?: string;` |
| L235 | imageUrl | unknown | `imageUrl: typeof currentLeague.imageUrl === 'string' ? currentLeague.imageUrl : undefined,` |
| L247 | imageUrl | unknown | `imageUrl: typeof nextLeague.imageUrl === 'string' ? nextLeague.imageUrl : undefined,` |

### Locava-Native/src/features/profile/Profile.content.heavy.tsx

| L4 | profile grid | unknown | `* Subscribes to CREATED/UPDATED so profile grid refreshes when user's post is created/updated (real-time).` |

### Locava-Native/src/features/profile/Profile.heavy.tsx

| L52 | PostTile | unknown | `import { PostTile } from "../liftable/PostTile";` |
| L175 | PostTile | unknown | `/** Owner of the profile we're viewing (so PostTile can show Delete vs Report). */` |
| L206 | PostTile | unknown | `<PostTile` |
| L327 | thumbUrl | needs_migration | `thumbUrl: optimisticPost.thumbUrl,` |
| L336 | thumbUrl | needs_migration | `if (isUsableGridThumbUrl(it.thumbUrl)) return it;` |
| L338 | thumbUrl | needs_migration | `if (fb?.thumbUrl && isUsableGridThumbUrl(fb.thumbUrl)) return { ...it, thumbUrl: fb.thumbUrl };` |
| L343 | thumbUrl | needs_migration | `const thumbUrl = raw.startsWith("ph://") ? "" : raw;` |
| L346 | thumbUrl | needs_migration | `thumbUrl,` |
| L413 | thumbUrl | needs_migration | `.map((i) => i.thumbUrl)` |
| L676 | thumbUrl | needs_migration | `thumbUrl: it.thumbUrl,` |

### Locava-Native/src/features/profile/profile.store.ts

| L46 | thumbUrl | needs_migration | `export type OptimisticPost = { postId: string; thumbUrl: string; updatedAtMs: number };` |
| L353 | thumbUrl | needs_migration | `if ((a.thumbUrl ?? '') !== (b.thumbUrl ?? '')) return true;` |
| L371 | thumbUrl | needs_migration | `thumbUrl: item.thumbUrl,` |
| L372 | displayPhotoLink | needs_migration | `displayPhotoLink: item.thumbUrl,` |
| L372 | thumbUrl | needs_migration | `displayPhotoLink: item.thumbUrl,` |
| L373 | photoLink | needs_migration | `photoLink: item.thumbUrl,` |
| L373 | thumbUrl | needs_migration | `photoLink: item.thumbUrl,` |
| L427 | thumbUrl | needs_migration | `setOptimisticPostFromUpload: (payload: { postId: string; thumbUrl: string }) => void;` |
| L464 | thumbUrl | needs_migration | `let thumbUrl = payload.thumbUrl && !String(payload.thumbUrl).startsWith('ph://') ? payload.thumbUrl : '';` |
| L465 | thumbUrl | needs_migration | `if (!thumbUrl) {` |
| L470 | thumbUrl | needs_migration | `fallback?.thumbUrl &&` |
| L471 | thumbUrl | needs_migration | `typeof fallback.thumbUrl === 'string' &&` |
| L472 | thumbUrl | needs_migration | `!fallback.thumbUrl.startsWith('ph://')` |
| L474 | thumbUrl | needs_migration | `thumbUrl = fallback.thumbUrl;` |
| L482 | thumbUrl | needs_migration | `thumbUrl,` |

### Locava-Native/src/features/profile/profile.types.ts

| L15 | thumbUrl | needs_migration | `thumbUrl: string;` |

### Locava-Native/src/features/profile/ProfileLikes.heavy.tsx

| L10 | PostTile | unknown | `import { PostTile } from '../liftable/PostTile';` |
| L138 | PostTile | unknown | `<PostTile` |

### Locava-Native/src/features/profile/ProfileMap.heavy.tsx

| L4 | profile grid | unknown | `* ProfileMapContent mirrors the profile grid on MapSurface (same posts + coords from metadata / batch fetch).` |

### Locava-Native/src/features/profile/ProfileMapContent.heavy.tsx

| L2 | profile grid | unknown | `* Profile map content: same posts as the on-screen profile grid on MapSurface (native markers).` |
| L105 | thumbUrl | needs_migration | `thumbUrl: item.thumbUrl,` |
| L118 | thumbUrl | needs_migration | `(typeof o.thumbUrl === "string" && o.thumbUrl.trim()) \|\|` |
| L119 | displayPhotoLink | needs_migration | `(typeof o.displayPhotoLink === "string" && o.displayPhotoLink.trim()) \|\|` |
| L120 | photoLink | needs_migration | `(typeof o.photoLink === "string" && o.photoLink.trim()) \|\|` |
| L130 | thumbUrl | needs_migration | `thumbUrl: thumb \|\| "",` |
| L143 | thumbUrl | needs_migration | `let thumbUrl: string \| undefined = isUsableGridThumbUrl(item.thumbUrl) ? item.thumbUrl : undefined;` |
| L144 | thumbUrl | needs_migration | `if (!thumbUrl && meta) {` |
| L146 | thumbUrl | needs_migration | `if (h) thumbUrl = h;` |
| L154 | thumbUrl | needs_migration | `thumbUrl,` |

### Locava-Native/src/features/profile/profileOptimisticGrid.test.ts

| L10 | thumbUrl | test_fixture | `thumbUrl: "https://cdn.example.com/thumb.jpg",` |
| L17 | thumbUrl | test_fixture | `thumbUrl: "https://cdn.example.com/older.jpg",` |
| L38 | thumbUrl | test_fixture | `thumbUrl: "",` |
| L44 | thumbUrl | test_fixture | `thumbUrl: "https://cdn.example.com/older.jpg",` |
| L58 | thumbUrl | test_fixture | `echoedReconciled.items[0]?.thumbUrl === optimistic.thumbUrl,` |
| L69 | thumbUrl | test_fixture | `thumbUrl: "https://cdn.example.com/server-thumb.jpg",` |
| L75 | thumbUrl | test_fixture | `thumbUrl: "https://cdn.example.com/older.jpg",` |
| L85 | thumbUrl | test_fixture | `stableReconciled.items[0]?.thumbUrl === "https://cdn.example.com/server-thumb.jpg",` |

### Locava-Native/src/features/profile/profileOptimisticGrid.ts

| L6 | thumbUrl | needs_migration | `thumbUrl: string;` |
| L17 | thumbUrl | needs_migration | `if (isUsableGridThumbUrl(item.thumbUrl)) return item;` |
| L18 | thumbUrl | needs_migration | `if (!isUsableGridThumbUrl(optimisticPost.thumbUrl)) return item;` |
| L21 | thumbUrl | needs_migration | `thumbUrl: optimisticPost.thumbUrl,` |
| L35 | thumbUrl | needs_migration | `isUsableGridThumbUrl(item.thumbUrl),` |
| L62 | thumbUrl | needs_migration | `thumbUrl: optimisticPost.thumbUrl,` |

### Locava-Native/src/features/profile/ui/ProfileAchievementBadgeCard.tsx

| L16 | imageUrl | unknown | `imageUrl?: string;` |
| L33 | imageUrl | unknown | `imageUrl,` |
| L74 | imageUrl | unknown | `{imageUrl ? (` |
| L75 | imageUrl | unknown | `<Image source={{ uri: imageUrl }} style={styles.iconImage} contentFit="cover" />` |

### Locava-Native/src/features/search/autofillV2MixSuggestions.ts

| L370 | posterUrl | unknown | `previewThumbUrls: row.coverPost?.media?.posterUrl ? [row.coverPost.media.posterUrl] : [],` |

### Locava-Native/src/features/search/backendv2/openSearchV2MixAsCollection.ts

| L132 | displayPhotoLink | needs_migration | `.map((row) => (typeof row.displayPhotoLink === 'string' ? row.displayPhotoLink : ''))` |

### Locava-Native/src/features/search/backendv2/searchHomeMixes.api.ts

| L23 | posterUrl | unknown | `posterUrl: string;` |
| L34 | fallbackVideoUrl | unknown | `fallbackVideoUrl?: string \| null;` |
| L35 | posterUrl | unknown | `posterUrl?: string \| null;` |
| L46 | posterUrl | unknown | `posterUrl?: string \| null;` |

### Locava-Native/src/features/search/backendv2/searchV2.normalize.ts

| L25 | thumbUrl | needs_migration | `thumbUrl: post.media.posterUrl,` |
| L25 | posterUrl | unknown | `thumbUrl: post.media.posterUrl,` |
| L32 | thumbUrl | needs_migration | `thumbUrl: post.media.posterUrl,` |
| L32 | posterUrl | unknown | `thumbUrl: post.media.posterUrl,` |

### Locava-Native/src/features/search/backendv2/searchV2.store.test.ts

| L16 | thumbUrl | test_fixture | `thumbUrl: 'poster-1.jpg',` |
| L22 | thumbUrl | test_fixture | `thumbUrl: 'poster-2.jpg',` |

### Locava-Native/src/features/search/backendv2/searchV2.types.ts

| L27 | posterUrl | unknown | `posterUrl: string;` |

### Locava-Native/src/features/search/searchBootstrap.api.ts

| L15 | thumbUrl | needs_migration | `thumbUrl: string;` |

### Locava-Native/src/features/search/SearchContent.heavy.tsx

| L156 | posterUrl | unknown | `const fallback = media?.posterUrl;` |
| L474 | thumbUrl | needs_migration | `imageUrl: user.recentPost.thumbUrl,` |
| L474 | imageUrl | unknown | `imageUrl: user.recentPost.thumbUrl,` |
| L678 | thumbUrl | needs_migration | `isUsableRenderableMediaUrl(row.recentPost.thumbUrl) &&` |
| L1209 | thumbUrl | needs_migration | `{ postId: string; thumbUrl: string; userName?: string; userHandle?: string; userPic?: string }` |
| L1214 | thumbUrl | needs_migration | `const thumbUrl = renderableThumbUrlFromUnknownPost(row);` |
| L1215 | thumbUrl | needs_migration | `if (!thumbUrl) continue;` |
| L1220 | thumbUrl | needs_migration | `thumbUrl,` |
| L1245 | thumbUrl | needs_migration | `thumbUrl: post.thumbUrl,` |
| L2565 | thumbUrl | needs_migration | `thumbUrl: null,` |
| L2576 | thumbUrl | needs_migration | `thumbUrl: first ? renderableThumbUrlFromUnknownPost(first) \|\| null : null,` |
| L2584 | thumbUrl | needs_migration | `hiking && hiking.ok && typeof hiking.thumbUrl === "string"` |
| L2585 | thumbUrl | needs_migration | `? hiking.thumbUrl.trim()` |
| L3068 | thumbUrl | needs_migration | `(posts[0] as { thumbUrl?: string })?.thumbUrl ??` |
| L3069 | displayPhotoLink | needs_migration | `(posts[0] as { displayPhotoLink?: string })?.displayPhotoLink ??` |
| L3179 | posterUrl | unknown | `typeof row.coverPost?.media?.posterUrl === "string"` |
| L3180 | posterUrl | unknown | `? row.coverPost.media.posterUrl` |
| L3377 | thumbUrl | needs_migration | `thumbUrl: row.recentPost.thumbUrl,` |
| L3378 | displayPhotoLink | needs_migration | `displayPhotoLink: row.recentPost.thumbUrl,` |
| L3378 | thumbUrl | needs_migration | `displayPhotoLink: row.recentPost.thumbUrl,` |
| L3647 | thumbUrl | needs_migration | `item: Record<string, unknown> & { postId?: string; id?: string; imageUrl?: string; thumbUrl?: string },` |
| L3647 | imageUrl | unknown | `item: Record<string, unknown> & { postId?: string; id?: string; imageUrl?: string; thumbUrl?: string },` |
| L3655 | imageUrl | unknown | `const imageUrl =` |
| L3656 | imageUrl | unknown | `typeof item.imageUrl === "string" && item.imageUrl.trim().length > 0` |
| L3657 | imageUrl | unknown | `? item.imageUrl` |
| L3658 | thumbUrl | needs_migration | `: typeof item.thumbUrl === "string" && item.thumbUrl.trim().length > 0` |
| L3659 | thumbUrl | needs_migration | `? item.thumbUrl` |
| L3660 | displayPhotoLink | needs_migration | `: typeof item.displayPhotoLink === "string" && item.displayPhotoLink.trim().length > 0` |
| L3661 | displayPhotoLink | needs_migration | `? item.displayPhotoLink` |
| L3662 | photoLink | needs_migration | `: typeof item.photoLink === "string" && item.photoLink.trim().length > 0` |
| L3663 | photoLink | needs_migration | `? item.photoLink` |
| L3665 | imageUrl | unknown | `if (!imageUrl) return;` |
| L3686 | thumbUrl | needs_migration | `thumbUrl: imageUrl,` |
| L3686 | imageUrl | unknown | `thumbUrl: imageUrl,` |
| L3711 | thumbUrl | needs_migration | `thumbUrl: row.thumbUrl,` |
| L3733 | thumbUrl | needs_migration | `imageUrl: row.thumbUrl,` |
| L3733 | imageUrl | unknown | `imageUrl: row.thumbUrl,` |
| L3734 | imageUrl | unknown | `} as Record<string, unknown> & { postId: string; imageUrl: string },` |
| L3764 | displayPhotoLink | needs_migration | `displayPhotoLink: recentPost.thumbUrl,` |
| L3764 | thumbUrl | needs_migration | `displayPhotoLink: recentPost.thumbUrl,` |
| L3765 | thumbUrl | needs_migration | `thumbUrl: recentPost.thumbUrl,` |
| L3777 | thumbUrl | needs_migration | `thumbUrl: recentPost.thumbUrl,` |
| L3907 | thumbUrl | needs_migration | `{isUsableRenderableMediaUrl(item.recentPost.thumbUrl) ? (` |
| L3909 | thumbUrl | needs_migration | `source={{ uri: item.recentPost.thumbUrl }}` |
| L4000 | imageUrl | unknown | `{ postId: friend.postId, imageUrl: friend.imageUrl },` |
| L4050 | imageUrl | unknown | `source={{ uri: friend.imageUrl }}` |
| L4091 | imageUrl | unknown | `source={{ uri: activity.imageUrl }}` |
| L4165 | thumbUrl | needs_migration | `thumbUrl: post.imageUrl,` |
| L4165 | imageUrl | unknown | `thumbUrl: post.imageUrl,` |
| L4197 | imageUrl | unknown | `source={{ uri: post.imageUrl }}` |
| L4212 | thumbUrl | needs_migration | `thumbUrl: post.imageUrl,` |
| L4212 | imageUrl | unknown | `thumbUrl: post.imageUrl,` |
| L4244 | imageUrl | unknown | `source={{ uri: post.imageUrl }}` |
| L4747 | imageUrl | unknown | `imageUri={post.imageUrl}` |

### Locava-Native/src/features/search/searchDiscovery.mock.ts

| L32 | imageUrl | unknown | `imageUrl: string;` |
| L69 | imageUrl | unknown | `imageUrl: string;` |
| L78 | imageUrl | unknown | `imageUrl: string;` |
| L88 | imageUrl | unknown | `imageUrl: string;` |
| L223 | imageUrl | unknown | `imageUrl: 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?auto=format&fit=crop&w=1200&q=80',` |
| L235 | imageUrl | unknown | `imageUrl: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1200&q=80',` |
| L247 | imageUrl | unknown | `imageUrl: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=1200&q=80',` |
| L259 | imageUrl | unknown | `imageUrl: 'https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=1200&q=80',` |
| L373 | imageUrl | unknown | `imageUrl: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1000&q=80',` |
| L385 | imageUrl | unknown | `imageUrl: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1000&q=80',` |
| L397 | imageUrl | unknown | `imageUrl: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=1000&q=80',` |
| L408 | imageUrl | unknown | `imageUrl: 'https://images.unsplash.com/photo-1501555088652-021faa106b9b?auto=format&fit=crop&w=900&q=80',` |
| L416 | imageUrl | unknown | `imageUrl: 'https://images.unsplash.com/photo-1432405972618-c60b0225b8f9?auto=format&fit=crop&w=900&q=80',` |
| L424 | imageUrl | unknown | `imageUrl: 'https://images.unsplash.com/photo-1447933601403-0c6688de566e?auto=format&fit=crop&w=900&q=80',` |
| L432 | imageUrl | unknown | `imageUrl: 'https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=900&q=80',` |
| L444 | imageUrl | unknown | `imageUrl: 'https://images.unsplash.com/photo-1449844908441-8829872d2607?auto=format&fit=crop&w=1000&q=80',` |
| L456 | imageUrl | unknown | `imageUrl: 'https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=1000&q=80',` |
| L468 | imageUrl | unknown | `imageUrl: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1000&q=80',` |
| L480 | imageUrl | unknown | `imageUrl: 'https://images.unsplash.com/photo-1501555088652-021faa106b9b?auto=format&fit=crop&w=1000&q=80',` |
| L492 | imageUrl | unknown | `imageUrl: 'https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?auto=format&fit=crop&w=1000&q=80',` |
| L504 | imageUrl | unknown | `imageUrl: 'https://images.unsplash.com/photo-1473448912268-2022ce9509d8?auto=format&fit=crop&w=1000&q=80',` |
| L516 | imageUrl | unknown | `imageUrl: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1000&q=80',` |
| L528 | imageUrl | unknown | `imageUrl: 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&w=1000&q=80',` |
| L540 | imageUrl | unknown | `imageUrl: 'https://images.unsplash.com/photo-1501612780327-45045538702b?auto=format&fit=crop&w=1000&q=80',` |
| L552 | imageUrl | unknown | `imageUrl: 'https://images.unsplash.com/photo-1482192505345-5655af888cc4?auto=format&fit=crop&w=1000&q=80',` |

### Locava-Native/src/features/search/SearchExploreModal.tsx

| L65 | displayPhotoLink | needs_migration | `displayPhotoLink: post.imageUrl,` |
| L65 | imageUrl | unknown | `displayPhotoLink: post.imageUrl,` |
| L66 | thumbUrl | needs_migration | `thumbUrl: post.imageUrl,` |
| L66 | imageUrl | unknown | `thumbUrl: post.imageUrl,` |
| L74 | thumbUrl | needs_migration | `thumbUrl: post.imageUrl,` |
| L74 | imageUrl | unknown | `thumbUrl: post.imageUrl,` |
| L233 | imageUrl | unknown | `<Image source={{ uri: hero.imageUrl }} style={StyleSheet.absoluteFillObject} contentFit="cover" />` |
| L262 | imageUrl | unknown | `<Image source={{ uri: post.imageUrl }} style={StyleSheet.absoluteFillObject} contentFit="cover" />` |

### Locava-Native/src/features/search/searchHomeMixes.store.ts

| L216 | posterUrl | unknown | `((prev!.posts[0] as any).media?.posterUrl \|\|` |
| L217 | posterUrl | unknown | `(prev!.posts[0] as any).posterUrl \|\|` |
| L218 | thumbUrl | needs_migration | `(prev!.posts[0] as any).thumbUrl),` |
| L285 | posterUrl | unknown | `((next.posts[0] as any).media?.posterUrl \|\|` |
| L286 | posterUrl | unknown | `(next.posts[0] as any).posterUrl \|\|` |
| L287 | thumbUrl | needs_migration | `(next.posts[0] as any).thumbUrl),` |

### Locava-Native/src/features/search/SearchHomeSurface.tsx

| L57 | posterUrl | unknown | `? (post as { media?: { posterUrl?: string; previewUrl?: string } }).media` |
| L61 | posterUrl | unknown | `media?.posterUrl ??` |
| L63 | posterUrl | unknown | `(typeof row.posterUrl === 'string' ? row.posterUrl : null) ??` |
| L66 | thumbUrl | needs_migration | `(typeof row.thumbUrl === 'string' ? row.thumbUrl : null) ??` |
| L67 | displayPhotoLink | needs_migration | `(typeof row.displayPhotoLink === 'string' ? row.displayPhotoLink : null) ??` |
| L92 | thumbUrl | needs_migration | `thumbUrl: thumb,` |
| L119 | thumbUrl | needs_migration | `function latestCachedPostForUser(userId: string): { postId: string; thumbUrl: string } \| null {` |
| L134 | thumbUrl | needs_migration | `row.thumbUrl ??` |
| L135 | displayPhotoLink | needs_migration | `row.displayPhotoLink ??` |
| L136 | photoLink | needs_migration | `row.photoLink ??` |
| L137 | posterUrl | unknown | `((row.media as { posterUrl?: string; previewUrl?: string } \| undefined)?.posterUrl ?? '') ??` |
| L142 | thumbUrl | needs_migration | `return { postId, thumbUrl: thumb };` |
| L214 | thumbUrl | needs_migration | `const thumb = thumbUri(first?.thumbUrl ?? null);` |
| L226 | thumbUrl | needs_migration | `thumbUrl: thumb,` |
| L227 | displayPhotoLink | needs_migration | `displayPhotoLink: thumb,` |
| L228 | photoLink | needs_migration | `photoLink: thumb,` |
| L241 | thumbUrl | needs_migration | `thumbUrl: thumb,` |
| L512 | displayPhotoLink | needs_migration | `displayPhotoLink: item.recentPost.thumbUrl,` |
| L512 | thumbUrl | needs_migration | `displayPhotoLink: item.recentPost.thumbUrl,` |
| L513 | thumbUrl | needs_migration | `thumbUrl: item.recentPost.thumbUrl,` |
| L520 | thumbUrl | needs_migration | `thumbUrl: item.recentPost.thumbUrl,` |
| L625 | thumbUrl | needs_migration | `{thumbUri(item.recentPost.thumbUrl ?? null) ? (` |
| L626 | thumbUrl | needs_migration | `<Image source={{ uri: item.recentPost.thumbUrl }} style={styles.storyFill} contentFit="cover" />` |

### Locava-Native/src/features/search/searchLiftableOpen.ts

| L2 | PostTile | unknown | `* Search / explore open path parity with profile PostTile:` |
| L33 | thumbUrl | needs_migration | `thumbUrl: string;` |
| L43 | thumbUrl | needs_migration | `const { postId, thumbUrl, originRect, originBorderRadius, source, entry, basePost } = params;` |
| L49 | displayPhotoLink | needs_migration | `displayPhotoLink: thumbUrl,` |
| L49 | thumbUrl | needs_migration | `displayPhotoLink: thumbUrl,` |
| L50 | thumbUrl | needs_migration | `thumbUrl,` |
| L59 | thumbUrl | needs_migration | `const heroUri = getRenderableThumbUrlFromPost(merged) ?? thumbUrl;` |

### Locava-Native/src/features/search/searchLiftablePressInWarm.ts

| L2 | PostTile | unknown | `* Press-in warmup for search rows — mirrors PostTile throttledBoostLiftableOnPressIn +` |
| L30 | thumbUrl | needs_migration | `thumbUrl: string,` |
| L37 | displayPhotoLink | needs_migration | `displayPhotoLink: thumbUrl,` |
| L37 | thumbUrl | needs_migration | `displayPhotoLink: thumbUrl,` |
| L38 | thumbUrl | needs_migration | `thumbUrl,` |
| L47 | thumbUrl | needs_migration | `thumbUrl: string;` |
| L51 | thumbUrl | needs_migration | `const { postId, thumbUrl, source, basePost } = params;` |
| L55 | thumbUrl | needs_migration | `const thin = buildThinPost(postId, thumbUrl, basePost);` |
| L60 | assets[0] | needs_migration | `const first = assets[0] as { type?: string } \| undefined;` |

### Locava-Native/src/features/search/searchLiveOpen.contract.test.ts

| L8 | thumbUrl | test_fixture | `thumbUrl: string;` |
| L29 | thumbUrl | test_fixture | `imageUrl: row.thumbUrl,` |
| L29 | imageUrl | test_fixture | `imageUrl: row.thumbUrl,` |
| L37 | thumbUrl | test_fixture | `thumbUrl:` |
| L80 | thumbUrl | test_fixture | `assert(payload.imageUrl === row.thumbUrl, "expected imageUrl to fall back to thumbUrl");` |
| L80 | imageUrl | test_fixture | `assert(payload.imageUrl === row.thumbUrl, "expected imageUrl to fall back to thumbUrl");` |

### Locava-Native/src/features/search/searchLiveSurface.tsx

| L79 | PostTile | unknown | `/** Warm liftable on touch start (post rows) — profile PostTile parity. */` |
| L300 | thumbUrl | needs_migration | `imageUri={item.thumbUrl}` |

### Locava-Native/src/features/search/searchResultsSurface.tsx

| L21 | PostTile | unknown | `import { PostTile } from "../liftable/PostTile";` |
| L502 | PostTile | unknown | `<PostTile` |

### Locava-Native/src/features/search/searchStoryRow.cache.ts

| L16 | thumbUrl | needs_migration | `recentPost: { postId: string; thumbUrl: string };` |

### Locava-Native/src/features/search/searchStoryUsers.store.ts

| L99 | thumbUrl | needs_migration | `thumbUrl: row.recentPost?.thumbUrl,` |
| L100 | displayPhotoLink | needs_migration | `displayPhotoLink: row.recentPost?.thumbUrl,` |
| L100 | thumbUrl | needs_migration | `displayPhotoLink: row.recentPost?.thumbUrl,` |
| L101 | photoLink | needs_migration | `photoLink: row.recentPost?.thumbUrl,` |
| L101 | thumbUrl | needs_migration | `photoLink: row.recentPost?.thumbUrl,` |
| L115 | thumbUrl | needs_migration | `const incomingThumbUrl = row.recentPost?.thumbUrl;` |
| L136 | thumbUrl | needs_migration | `previousThumbByPostId.set(postId, row.recentPost?.thumbUrl ?? '');` |
| L144 | thumbUrl | needs_migration | `thumbUrl: resolveStoryThumbUrl(row, previousThumbByPostId.get(postId)),` |

### Locava-Native/src/features/search/useLiveSearch.ts

| L45 | thumbUrl | needs_migration | `thumbUrl: string;` |

### Locava-Native/src/features/search/useSearchBootstrapPosts.ts

| L26 | thumbUrl | needs_migration | `* Reliability/perf: this is intentionally allowed to be "lite" rows (thumbUrl + postId) so` |
| L146 | displayPhotoLink | needs_migration | `thumbUrl: String((row as any).thumbUrl ?? (row as any).displayPhotoLink ?? ''),` |
| L146 | thumbUrl | needs_migration | `thumbUrl: String((row as any).thumbUrl ?? (row as any).displayPhotoLink ?? ''),` |
| L232 | thumbUrl | needs_migration | `thumbUrl: r.thumbUrl,` |

### Locava-Native/src/features/share/instagramShareMedia.ts

| L3 | displayPhotoLink | needs_migration | `* Matches old app logic: new assets array (with variants) or legacy photoLinks/displayPhotoLink.` |
| L72 | photoLink | needs_migration | `* Supports post.assets (new) and legacy photoLink/displayPhotoLink.` |
| L72 | displayPhotoLink | needs_migration | `* Supports post.assets (new) and legacy photoLink/displayPhotoLink.` |
| L72 | post.assets | needs_migration | `* Supports post.assets (new) and legacy photoLink/displayPhotoLink.` |
| L86 | displayPhotoLink | needs_migration | `const displayPhotoLink = ensureString(post.displayPhotoLink ?? post.displayPhotoLinkParam);` |
| L87 | photoLink | needs_migration | `const photoLinkRaw = ensureString(post.photoLink);` |
| L93 | post.assets | needs_migration | `const assets = (post.assets as AssetLike[] \| undefined) ?? [];` |
| L98 | displayPhotoLink | needs_migration | `displayPhotoLink \|\|` |
| L104 | assets[0] | needs_migration | `const activeAsset = assets[safeIndex] ?? assets[0];` |

### Locava-Native/src/features/slideInOverlay/SlideInOverlayGate.tsx

| L437 | profile grid | unknown | `{/* Same stacking as SearchModalGate / notifications: viewer above profile grid. */}` |

### Locava-Native/src/features/togo/backendv2/collectionsV2.normalize.ts

| L16 | thumbUrl | needs_migration | `thumbUrl: item.media.posterUrl,` |
| L16 | posterUrl | unknown | `thumbUrl: item.media.posterUrl,` |

### Locava-Native/src/features/togo/backendv2/collectionsV2.types.ts

| L10 | posterUrl | unknown | `posterUrl: string;` |
| L51 | thumbUrl | needs_migration | `thumbUrl: string;` |

### Locava-Native/src/features/togo/CollectionDetail.heavy.tsx

| L82 | PostTile | unknown | `import { PostTile } from "../liftable/PostTile";` |
| L152 | posterUrl | unknown | `poster: asset.video.posterHighUrl ?? asset.video.posterUrl ?? asset.video.thumbnailUrl ?? cover,` |
| L153 | posterUrl | unknown | `thumbnail: asset.video.thumbnailUrl ?? asset.video.posterUrl ?? cover,` |
| L180 | displayPhotoLink | needs_migration | `displayPhotoLink: cover,` |
| L181 | thumbUrl | needs_migration | `thumbUrl: cover,` |
| L182 | photoLink | needs_migration | `photoLink: cover,` |
| L191 | posterUrl | unknown | `const poster = typeof media.posterUrl === "string" ? media.posterUrl : "";` |
| L203 | displayPhotoLink | needs_migration | `displayPhotoLink: poster,` |
| L204 | thumbUrl | needs_migration | `thumbUrl: poster,` |
| L205 | photoLink | needs_migration | `photoLink: poster,` |
| L1133 | photoLink | needs_migration | `row.thumbUrl ?? row.displayPhotoLink ?? row.photoLink ?? "",` |
| L1133 | displayPhotoLink | needs_migration | `row.thumbUrl ?? row.displayPhotoLink ?? row.photoLink ?? "",` |
| L1133 | thumbUrl | needs_migration | `row.thumbUrl ?? row.displayPhotoLink ?? row.photoLink ?? "",` |
| L1142 | thumbUrl | needs_migration | `(post as Record<string, unknown>).thumbUrl ??` |
| L1143 | displayPhotoLink | needs_migration | `(post as Record<string, unknown>).displayPhotoLink ??` |
| L1144 | photoLink | needs_migration | `(post as Record<string, unknown>).photoLink ??` |
| L2969 | PostTile | unknown | `<PostTile` |
| L3141 | PostTile | unknown | `<PostTile` |
| L3226 | photoLink | needs_migration | `thumbUrl: (raw.displayPhotoLink ?? raw.thumbUrl ?? raw.photoLink) as` |
| L3226 | displayPhotoLink | needs_migration | `thumbUrl: (raw.displayPhotoLink ?? raw.thumbUrl ?? raw.photoLink) as` |
| L3226 | thumbUrl | needs_migration | `thumbUrl: (raw.displayPhotoLink ?? raw.thumbUrl ?? raw.photoLink) as` |
| L3234 | photoLink | needs_migration | `thumbUrl: (raw.displayPhotoLink ?? raw.thumbUrl ?? raw.photoLink) as` |
| L3234 | displayPhotoLink | needs_migration | `thumbUrl: (raw.displayPhotoLink ?? raw.thumbUrl ?? raw.photoLink) as` |
| L3234 | thumbUrl | needs_migration | `thumbUrl: (raw.displayPhotoLink ?? raw.thumbUrl ?? raw.photoLink) as` |
| L3245 | PostTile | unknown | `<PostTile` |

### Locava-Native/src/features/togo/NewCollectionSheet.heavy.tsx

| L58 | assets[0] | needs_migration | `setImageUri(result.assets[0].uri);` |

### Locava-Native/src/features/userDisplay/backendv2/userDisplayV2.store.model.test.ts

| L36 | thumbUrl | test_fixture | `thumbUrl: 'https://cdn.example.com/p1.jpg',` |

### Locava-Native/src/features/userDisplay/backendv2/userProfilePrefetch.ts

| L64 | thumbUrl | needs_migration | `thumbUrl: item.thumbUrl,` |
| L65 | displayPhotoLink | needs_migration | `displayPhotoLink: item.thumbUrl,` |
| L65 | thumbUrl | needs_migration | `displayPhotoLink: item.thumbUrl,` |
| L66 | photoLink | needs_migration | `photoLink: item.thumbUrl,` |
| L66 | thumbUrl | needs_migration | `photoLink: item.thumbUrl,` |

### Locava-Native/src/features/userDisplay/ui/globalUserRow.tokens.ts

| L41 | notification | unknown | `/** Subtitle (notification message, chat preview) */` |

### Locava-Native/src/features/userDisplay/ui/GlobalUserRow.tsx

| L23 | notification | unknown | `export type GlobalUserRowVariant = 'row' \| 'compact' \| 'notification' \| 'chat' \| 'comment' \| 'post' \| 'threadHeader';` |
| L45 | notification | unknown | `/** Optional second line (notification message, chat preview). */` |
| L59 | notification | unknown | `/** Override container style (e.g. for notification row padding). */` |
| L89 | notification | unknown | `notification: T.avatarSize.large,` |
| L193 | notification | unknown | `(variant === 'notification' \|\| variant === 'chat' \|\| variant === 'row' \|\| variant === 'threadHeader');` |
| L278 | notification | unknown | `if (variant === 'notification') {` |
| L474 | notification | unknown | `variant === 'notification' && styles.rowNotification,` |
| L640 | notification | unknown | `/** Notification handle row: width-bound for ellipsis only — no flex grow in the text column */` |

### Locava-Native/src/features/userDisplay/userDisplay.api.ts

| L113 | photoLink | needs_migration | `photoLink?: string;` |
| L114 | displayPhotoLink | needs_migration | `displayPhotoLink?: string;` |

### Locava-Native/src/features/userDisplay/userDisplay.gridHydrate.ts

| L20 | displayPhotoLink | needs_migration | `(p.displayPhotoLink as string \| undefined) ??` |
| L21 | thumbUrl | needs_migration | `(p.thumbUrl as string \| undefined) ??` |
| L22 | photoLink | needs_migration | `(p.photoLink as string \| undefined);` |
| L55 | displayPhotoLink | needs_migration | `displayPhotoLink: hero,` |
| L56 | thumbUrl | needs_migration | `thumbUrl: hero,` |
| L57 | photoLink | needs_migration | `photoLink: hero,` |

### Locava-Native/src/features/userDisplay/userDisplay.store.ts

| L80 | notification | unknown | `* Push / notification taps: open full-screen user display in the main tab tree (UserDisplayModalGate).` |

### Locava-Native/src/features/userDisplay/UserDisplayContent.heavy.tsx

| L55 | PostTile | unknown | `import { PostTile } from '../liftable/PostTile';` |
| L129 | thumbUrl | needs_migration | `thumbUrl: grid.thumbUrl,` |
| L130 | displayPhotoLink | needs_migration | `displayPhotoLink: grid.thumbUrl,` |
| L130 | thumbUrl | needs_migration | `displayPhotoLink: grid.thumbUrl,` |
| L131 | photoLink | needs_migration | `photoLink: grid.thumbUrl,` |
| L131 | thumbUrl | needs_migration | `photoLink: grid.thumbUrl,` |
| L168 | imageUrl | unknown | `imageUrl: item.iconUrl ?? undefined,` |
| L803 | thumbUrl | needs_migration | `const thumbUrl = (p as UserPostItem & { thumbUrl?: string }).thumbUrl ?? '';` |
| L804 | displayPhotoLink | needs_migration | `return '${p.displayPhotoLink ?? ''}\|${thumbUrl}';` |
| L804 | thumbUrl | needs_migration | `return '${p.displayPhotoLink ?? ''}\|${thumbUrl}';` |
| L809 | thumbUrl | needs_migration | `const thumbUrl = (p as UserPostItem & { thumbUrl?: string }).thumbUrl ?? '';` |
| L810 | displayPhotoLink | needs_migration | `return '${p.displayPhotoLink ?? ''}\|${thumbUrl}';` |
| L810 | thumbUrl | needs_migration | `return '${p.displayPhotoLink ?? ''}\|${thumbUrl}';` |
| L901 | displayPhotoLink | needs_migration | `const before = '${item.displayPhotoLink ?? ''}\|${item.thumbUrl ?? ''}';` |
| L901 | thumbUrl | needs_migration | `const before = '${item.displayPhotoLink ?? ''}\|${item.thumbUrl ?? ''}';` |
| L902 | displayPhotoLink | needs_migration | `const after = '${hydrated.displayPhotoLink ?? ''}\|${hydrated.thumbUrl ?? ''}';` |
| L902 | thumbUrl | needs_migration | `const after = '${hydrated.displayPhotoLink ?? ''}\|${hydrated.thumbUrl ?? ''}';` |
| L1177 | thumbUrl | needs_migration | `const thumbUrl =` |
| L1178 | displayPhotoLink | needs_migration | `(item.displayPhotoLink as string) ??` |
| L1179 | thumbUrl | needs_migration | `(item.thumbUrl as string) ??` |
| L1180 | photoLink | needs_migration | `(item.photoLink as string);` |
| L1183 | PostTile | unknown | `<PostTile` |
| L1188 | thumbUrl | needs_migration | `thumbUrl,` |
| L1189 | displayPhotoLink | needs_migration | `displayPhotoLink: thumbUrl,` |
| L1189 | thumbUrl | needs_migration | `displayPhotoLink: thumbUrl,` |
| L1190 | photoLink | needs_migration | `photoLink: thumbUrl,` |
| L1190 | thumbUrl | needs_migration | `photoLink: thumbUrl,` |

### Locava-Native/src/native/LocavaPostsMapView.tsx

| L20 | thumbUrl | unknown | `thumbUrl?: string;` |

### Locava-Native/src/nav/TopNavBar.tsx

| L271 | notification | unknown | `testID="topnav-notification"` |

### Locava-Native/src/nav/TopNavBarConnector.tsx

| L34 | notification | unknown | `} from '../features/notifications/state/notification.repository';` |
| L98 | notification | unknown | `// Refresh notification unread count when app is in foreground so the dot updates in near real-time.` |
| L103 | notification | unknown | `logCutoverStubEvent('polling-skip', 'TopNavBarConnector', 'notification unread polling');` |
| L107 | notification | unknown | `logCutoverStubEvent('polling-skip', 'TopNavBarConnector', 'notification unread polling (v2 surface)');` |

### Locava-Native/src/recommendation/postedActivityAffinity.ts

| L52 | profile grid | unknown | `* @param posts — typically profile grid / 'fetchUserPosts' items for the viewer only.` |

### Locava-Native/src/sheets/GlobalOverlayRootLazy.tsx

| L16 | notification | unknown | `// (e.g. cold start + push notification → chat slide-in). Let touches pass through until content mounts.` |

### Locava-Native/src/state/entities/entityStore.ts

| L34 | thumbUrl | unknown | `thumbUrl?: string;` |

### Locava-Native/src/ui/contracts/layoutContracts.ts

| L48 | profile grid | unknown | `* Profile grid / other-user photos tab: distance from tab row to empty-state content.` |

### Locava-Native/src/utils/postMediaNormalizer.test.ts

| L30 | displayPhotoLink | test_fixture | `displayPhotoLink: "https://cdn/hero.jpg",` |
| L56 | assets[0] | test_fixture | `expect(r.assets[0].posterUri ?? "").toContain("poster");` |
| L57 | assets[0] | test_fixture | `expect(r.assets[0].displayUri).toMatch(/\.m3u8\|\.mp4$/);` |
| L58 | assets[0] | test_fixture | `expect(r.assets[0].displayUri).not.toContain("poster");` |
| L64 | photoLinks2 | test_fixture | `photoLinks2: "https://one.jpg,https://two.jpg",` |
| L88 | displayPhotoLink | test_fixture | `displayPhotoLink: "https://same.jpg",` |
| L98 | photoLink | test_fixture | `photoLink: "",` |
| L99 | photoLinks2 | test_fixture | `photoLinks2: "https://aa.jpg,https://bb.jpg",` |

### Locava-Native/src/utils/postMediaNormalizer.ts

| L36 | photoLink | unknown | `...commaUrls(post.photoLink),` |
| L37 | photoLink | legacy_fallback_inside_helper | `...(legacy ? commaUrls(legacy.photoLink) : []),` |
| L38 | photoLinks2 | unknown | `...commaUrls(post.photoLinks2),` |
| L39 | photoLinks2 | legacy_fallback_inside_helper | `...(legacy ? commaUrls(legacy.photoLinks2) : []),` |
| L40 | photoLinks3 | unknown | `...commaUrls(post.photoLinks3),` |
| L41 | photoLinks3 | legacy_fallback_inside_helper | `...(legacy ? commaUrls(legacy.photoLinks3) : []),` |
| L91 | assets[0] | unknown | `if (new Set(uris).size === 1 && result.assets[0]?.type !== "video") {` |
| L233 | post.assets | unknown | `const rawAssets = Array.isArray(post.assets) ? post.assets : [];` |
| L246 | posterUrl | unknown | `posterUrl?: unknown;` |
| L262 | posterUrl | unknown | `asset.posterUrl,` |
| L291 | displayPhotoLink | unknown | `post.displayPhotoLink as string \| undefined,` |
| L292 | photoLink | unknown | `post.photoLink as string \| undefined,` |
| L324 | displayPhotoLink | unknown | `post.displayPhotoLink as string \| undefined,` |
| L325 | photoLink | unknown | `post.photoLink as string \| undefined,` |
| L326 | thumbUrl | unknown | `post.thumbUrl as string \| undefined,` |
| L358 | AssetCarouselOnly | unknown | `* Build list items consumed by AssetCarouselOnly / CarouselVideoSlide, with stable viewer keys.` |
