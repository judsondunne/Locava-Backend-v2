import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import { withConcurrencyLimit } from "../../lib/concurrency-limit.js";
import type { CollectionsRepository } from "../../repositories/surfaces/collections.repository.js";
import type { FeedService } from "./feed.service.js";

export class CollectionsService {
  constructor(
    private readonly repository: CollectionsRepository,
    private readonly feedService: FeedService
  ) {}

  async loadSavedPage(input: { viewerId: string; cursor: string | null; limit: number }) {
    const cursorPart = input.cursor ?? "start";
    return dedupeInFlight(`collections-saved:${input.viewerId}:${cursorPart}:${input.limit}`, () =>
      withConcurrencyLimit("collections-saved-repo", 8, async () => {
        const page = await this.repository.listSavedPosts(input);
        const cards = await this.feedService.loadPostCardSummaryBatch(
          input.viewerId,
          page.items.map((item) => item.postId)
        );
        const savedAtByPostId = new Map(page.items.map((item) => [item.postId, item.savedAtMs] as const));
        const items = cards.map((card) => {
          const { assets: _assets, ...lean } = card;
          return {
            ...lean,
            rankToken: `saved-rank-${savedAtByPostId.get(card.postId) ?? 0}`
          };
        });
        return { ...page, items };
      })
    );
  }
}
