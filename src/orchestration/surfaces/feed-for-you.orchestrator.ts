import type { FeedForYouResponse } from "../../contracts/surfaces/feed-for-you.contract.js";
import { recordSurfaceTimings } from "../../observability/request-context.js";
import type { FeedForYouService } from "../../services/surfaces/feed-for-you.service.js";

export class FeedForYouOrchestrator {
  constructor(private readonly service: FeedForYouService) {}

  async run(input: {
    viewerId: string;
    limit: number;
    cursor: string | null;
    debug: boolean;
  }): Promise<FeedForYouResponse> {
    const t0 = Date.now();
    const page = await this.service.getForYouPage(input);
    recordSurfaceTimings({ forYouOrchestrationMs: Date.now() - t0 });
    return {
      routeName: "feed.for_you.get",
      requestId: page.requestId,
      items: page.items,
      nextCursor: page.nextCursor,
      exhausted: page.exhausted,
      feedState: page.feedState,
      debug: page.debug
    };
  }
}
