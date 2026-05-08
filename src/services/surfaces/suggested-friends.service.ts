import { globalCache } from "../../cache/global-cache.js";
import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import {
  SuggestedFriendsRepository,
  type ContactSyncDiagnostics,
  type SuggestedFriendsOptions,
  type SuggestedFriendsSourceDiagnostic,
  type UserSuggestionSummary,
  buildSuggestedFriendsCacheKey
} from "../../repositories/surfaces/suggested-friends.repository.js";
import { recordCacheHit, recordCacheMiss, getRequestContext } from "../../observability/request-context.js";

const TTL_MS = 10 * 60_000;

export class SuggestedFriendsService {
  constructor(private readonly repository: SuggestedFriendsRepository = new SuggestedFriendsRepository()) {}

  async syncContacts(input: {
    viewerId: string;
    contacts: Array<{ name?: string | null; phoneNumbers?: string[]; emails?: string[] }>;
  }): Promise<{ matchedUsers: UserSuggestionSummary[]; matchedCount: number; syncedAt: number; diagnostics: ContactSyncDiagnostics }> {
    const signature = `${input.viewerId}:${input.contacts.length}`;
    const result = await dedupeInFlight(`social:contacts-sync:${signature}`, () =>
      this.repository.syncContacts({ viewerId: input.viewerId, contacts: input.contacts })
    );
    await this.invalidateViewerCaches(input.viewerId);
    return result;
  }

  async getSuggestionsForUser(
    viewerId: string,
    options: SuggestedFriendsOptions
  ): Promise<{
    users: UserSuggestionSummary[];
    sourceBreakdown: Record<string, number>;
    generatedAt: number;
    etag?: string;
    sourceDiagnostics: SuggestedFriendsSourceDiagnostic[];
  }> {
    const limit = Math.max(1, Math.min(options.limit ?? 20, 50));
    const surface = options.surface ?? "generic";
    const hasDynamicFilters = Boolean(options.excludeUserIds?.length) || options.sortBy === "postCount";
    const cacheKey = `${buildSuggestedFriendsCacheKey(viewerId, surface, limit)}:${options.sortBy ?? "default"}:${hasDynamicFilters ? "dynamic" : "static"}`;
    if (!options.bypassCache && !hasDynamicFilters) {
      const cached = await globalCache.get<{
        users: UserSuggestionSummary[];
        sourceBreakdown: Record<string, number>;
        generatedAt: number;
        etag: string;
        sourceDiagnostics: SuggestedFriendsSourceDiagnostic[];
      }>(cacheKey);
      if (cached) {
        recordCacheHit();
        return cached;
      }
    }
    recordCacheMiss();
    const readsBefore = getRequestContext()?.dbOps.reads ?? 0;
    const computed = await dedupeInFlight(
      `social:suggested:${viewerId}:${surface}:${limit}:${options.excludeAlreadyFollowing !== false ? 1 : 0}:${options.excludeBlocked !== false ? 1 : 0}:${options.sortBy ?? "default"}:${(options.excludeUserIds ?? []).slice(0, 8).join(",")}`,
      () => this.repository.getSuggestionsForUser(viewerId, { ...options, limit, surface })
    );
    const readsAfter = getRequestContext()?.dbOps.reads ?? 0;
    const readDelta = Math.max(0, readsAfter - readsBefore);
    if (readDelta > 24) {
      // eslint-disable-next-line no-console
      console.warn(
        JSON.stringify({
          event: "SUGGESTED_FRIENDS_READ_BUDGET_CAPPED",
          viewerId,
          surface,
          readDelta,
          limit,
        }),
      );
    }
    if (!options.bypassCache && !hasDynamicFilters) {
      await globalCache.set(cacheKey, computed, TTL_MS);
    }
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
      for (const limit of [12, 20, 50]) {
        for (const sortBy of ["default", "postCount"] as const) {
          keys.push(`${buildSuggestedFriendsCacheKey(viewerId, surface, limit)}:${sortBy}:static`);
        }
      }
    }
    await Promise.all(keys.map((key) => globalCache.del(key)));
  }
}
