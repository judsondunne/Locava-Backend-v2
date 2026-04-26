import { globalCache } from "../../cache/global-cache.js";
import {
  SuggestedFriendsRepository,
  type SuggestedFriendsOptions,
  type UserSuggestionSummary,
  buildSuggestedFriendsCacheKey
} from "../../repositories/surfaces/suggested-friends.repository.js";
import { recordCacheHit, recordCacheMiss } from "../../observability/request-context.js";

const TTL_MS = 30_000;

export class SuggestedFriendsService {
  constructor(private readonly repository: SuggestedFriendsRepository = new SuggestedFriendsRepository()) {}

  async syncContacts(input: {
    viewerId: string;
    contacts: Array<{ name?: string | null; phoneNumbers?: string[]; emails?: string[] }>;
  }): Promise<{ matchedUsers: UserSuggestionSummary[]; matchedCount: number; syncedAt: number }> {
    const result = await this.repository.syncContacts({ viewerId: input.viewerId, contacts: input.contacts });
    await this.invalidateViewerCaches(input.viewerId);
    return result;
  }

  async getSuggestionsForUser(
    viewerId: string,
    options: SuggestedFriendsOptions
  ): Promise<{ users: UserSuggestionSummary[]; sourceBreakdown: Record<string, number>; generatedAt: number; etag?: string }> {
    const limit = Math.max(1, Math.min(options.limit ?? 20, 50));
    const surface = options.surface ?? "generic";
    const cacheKey = buildSuggestedFriendsCacheKey(viewerId, surface, limit);
    const cached = await globalCache.get<{ users: UserSuggestionSummary[]; sourceBreakdown: Record<string, number>; generatedAt: number; etag: string }>(
      cacheKey
    );
    if (cached) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();
    const computed = await this.repository.getSuggestionsForUser(viewerId, { ...options, limit, surface });
    await globalCache.set(cacheKey, computed, TTL_MS);
    return computed;
  }

  async invalidateViewerCaches(viewerId: string): Promise<void> {
    const surfaces: Array<NonNullable<SuggestedFriendsOptions["surface"]>> = [
      "onboarding",
      "profile",
      "search",
      "home",
      "notifications",
      "generic"
    ];
    const keys: string[] = [];
    for (const surface of surfaces) {
      keys.push(buildSuggestedFriendsCacheKey(viewerId, surface, 20));
      keys.push(buildSuggestedFriendsCacheKey(viewerId, surface, 12));
      keys.push(buildSuggestedFriendsCacheKey(viewerId, surface, 50));
    }
    await Promise.all(keys.map((key) => globalCache.del(key)));
  }
}
