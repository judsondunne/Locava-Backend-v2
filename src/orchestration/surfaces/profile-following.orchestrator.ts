import type { ViewerContext } from "../../auth/viewer-context.js";
import type { ProfileService } from "../../services/surfaces/profile.service.js";

export class ProfileFollowingOrchestrator {
  constructor(private readonly service: ProfileService) {}

  async run(input: {
    viewer: ViewerContext;
    userId: string;
    cursor: string | null;
    limit: number;
  }) {
    const page = await this.service.loadFollowing({
      viewerId: input.viewer.viewerId,
      userId: input.userId,
      cursor: input.cursor,
      limit: input.limit
    });
    return {
      routeName: "profile.following.get" as const,
      userId: input.userId,
      totalCount: page.totalCount,
      items: page.items,
      page: { nextCursor: page.nextCursor }
    };
  }
}

