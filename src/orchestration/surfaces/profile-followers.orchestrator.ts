import type { ViewerContext } from "../../auth/viewer-context.js";
import type { ProfileService } from "../../services/surfaces/profile.service.js";

export class ProfileFollowersOrchestrator {
  constructor(private readonly service: ProfileService) {}

  async run(input: {
    viewer: ViewerContext;
    userId: string;
    cursor: string | null;
    limit: number;
  }) {
    const page = await this.service.loadFollowers({
      viewerId: input.viewer.viewerId,
      userId: input.userId,
      cursor: input.cursor,
      limit: input.limit
    });
    return {
      routeName: "profile.followers.get" as const,
      userId: input.userId,
      totalCount: page.totalCount,
      items: page.items,
      page: { nextCursor: page.nextCursor }
    };
  }
}

