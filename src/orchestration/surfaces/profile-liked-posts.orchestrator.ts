import { z } from "zod";
import type { ProfileService } from "../../services/surfaces/profile.service.js";

const ProfileLikedPostsOutputSchema = z.object({
  routeName: z.literal("profile.liked_posts.get"),
  success: z.literal(true),
  posts: z.array(z.record(z.unknown())),
  nextCursor: z.string().nullable(),
  totalCount: z.number().int().nonnegative(),
  serverTsMs: z.number().int().nonnegative()
});

type ProfileLikedPostsOutput = z.infer<typeof ProfileLikedPostsOutputSchema>;

export class ProfileLikedPostsOrchestrator {
  constructor(private readonly service: ProfileService) {}

  async run(input: { viewerId: string; cursor: string | null; limit: number }): Promise<ProfileLikedPostsOutput> {
    const page = await this.service.loadMyLikedPosts({
      viewerId: input.viewerId,
      cursor: input.cursor,
      limit: input.limit
    });
    return ProfileLikedPostsOutputSchema.parse({
      routeName: "profile.liked_posts.get",
      success: true,
      posts: page.posts,
      nextCursor: page.nextCursor,
      totalCount: page.totalCount,
      serverTsMs: page.serverTsMs
    });
  }
}

