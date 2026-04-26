import { createHash } from "node:crypto";
import { entityCacheKeys } from "../../cache/entity-cache.js";
import { globalCache } from "../../cache/global-cache.js";
import { incrementDbOps } from "../../observability/request-context.js";
import { getFirestoreSourceClient } from "../source-of-truth/firestore-client.js";
import { mutationStateRepository } from "../mutations/mutation-state.repository.js";

export type UserSuggestionSummary = {
  userId: string;
  handle: string | null;
  name: string | null;
  profilePic: string | null;
  reason: "contacts" | "suggested" | "mutuals" | "popular" | "nearby" | "new_user_seed";
  mutualCount?: number;
  isFollowing: boolean;
  followerCount?: number;
  score?: number;
};

export type SuggestedFriendsOptions = {
  limit?: number;
  includeContacts?: boolean;
  includeMutuals?: boolean;
  includePopular?: boolean;
  includeNearby?: boolean;
  excludeAlreadyFollowing?: boolean;
  excludeBlocked?: boolean;
  surface?: "onboarding" | "profile" | "search" | "home" | "notifications" | "generic";
};

type ViewerGraph = {
  following: Set<string>;
  blocked: Set<string>;
  contactUsers: string[];
  contactUserSummaries: UserSuggestionSummary[];
  phoneContacts: string[];
};

const DEFAULT_LIMIT = 20;

function normalizePhone(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(-10);
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function pickProfilePic(data: Record<string, unknown>): string | null {
  const raw = data.profilePic ?? data.profilePicPath ?? data.profilePicLarge ?? data.profilePicSmall ?? data.photoURL;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (/via\.placeholder\.com/i.test(trimmed) || /placeholder/i.test(trimmed)) return null;
  return trimmed.length > 0 ? trimmed : null;
}

function toSummary(
  userId: string,
  data: Record<string, unknown>,
  reason: UserSuggestionSummary["reason"],
  isFollowing: boolean,
  score: number
): UserSuggestionSummary {
  const handleRaw = typeof data.handle === "string" ? data.handle.replace(/^@+/, "").trim() : "";
  const nameRaw = typeof data.name === "string" ? data.name.trim() : typeof data.displayName === "string" ? data.displayName.trim() : "";
  return {
    userId,
    handle: handleRaw || null,
    name: nameRaw || null,
    profilePic: pickProfilePic(data),
    reason,
    isFollowing,
    followerCount: Array.isArray(data.followers) ? data.followers.length : undefined,
    score
  };
}

export function buildSuggestedFriendsCacheKey(viewerId: string, surface: string, limit: number): string {
  return `social:suggested_friends:${viewerId}:${surface}:${limit}`;
}

export class SuggestedFriendsRepository {
  constructor(private readonly db = getFirestoreSourceClient()) {}

  async loadViewerGraph(viewerId: string): Promise<ViewerGraph> {
    if (!this.db) {
      return { following: new Set(), blocked: new Set(), contactUsers: [], contactUserSummaries: [], phoneContacts: [] };
    }
    let data = await globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(viewerId));
    if (data === undefined) {
      const doc = await this.db.collection("users").doc(viewerId).get();
      incrementDbOps("reads", doc.exists ? 1 : 0);
      data = (doc.data() ?? {}) as Record<string, unknown>;
      await globalCache.set(entityCacheKeys.userFirestoreDoc(viewerId), data, 25_000);
    }
    const following = new Set<string>(Array.isArray(data.following) ? data.following.filter((v): v is string => typeof v === "string") : []);
    const blocked = new Set<string>(Array.isArray(data.blockedUsers) ? data.blockedUsers.filter((v): v is string => typeof v === "string") : []);
    const contactUsers = Array.isArray(data.addressBookUsers) ? data.addressBookUsers.filter((v): v is string => typeof v === "string") : [];
    const contactUserSummaries = Array.isArray(data.addressBookUserSummaries)
      ? data.addressBookUserSummaries
          .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"))
          .map((row) => ({
            userId: String(row.userId ?? "").trim(),
            handle: typeof row.handle === "string" ? row.handle : null,
            name: typeof row.name === "string" ? row.name : null,
            profilePic: typeof row.profilePic === "string" ? row.profilePic : null,
            reason: "contacts" as const,
            isFollowing: following.has(String(row.userId ?? "").trim()) || mutationStateRepository.isFollowing(viewerId, String(row.userId ?? "").trim()),
            score: 1200
          }))
          .filter((row) => row.userId.length > 0)
      : [];
    const phoneContacts = Array.isArray(data.addressBookPhoneNumbers)
      ? data.addressBookPhoneNumbers
          .map((value) => (typeof value === "string" ? normalizePhone(value) : ""))
          .filter((value) => value.length === 10)
      : [];
    return { following, blocked, contactUsers, contactUserSummaries, phoneContacts };
  }

  async syncContacts(input: {
    viewerId: string;
    contacts: Array<{ phoneNumbers?: string[]; emails?: string[] }>;
  }): Promise<{ matchedUsers: UserSuggestionSummary[]; matchedCount: number; syncedAt: number }> {
    const viewerGraph = await this.loadViewerGraph(input.viewerId);
    const phoneSet = new Set<string>();
    const emailSet = new Set<string>();
    for (const contact of input.contacts) {
      for (const phone of contact.phoneNumbers ?? []) {
        const normalized = normalizePhone(phone);
        if (normalized.length === 10) phoneSet.add(normalized);
      }
      for (const email of contact.emails ?? []) {
        const normalized = normalizeEmail(email);
        if (normalized.includes("@")) emailSet.add(normalized);
      }
    }
    const now = Date.now();
    if (!this.db) {
      const localMatches: UserSuggestionSummary[] = [];
      if (phoneSet.has("6507046433")) {
        localMatches.push({
          userId: "seed-contact-1",
          handle: "testuser",
          name: "Test User",
          profilePic: null,
          reason: "contacts",
          isFollowing: false,
          score: 1000
        });
      }
      if (emailSet.has("test@example.com")) {
        localMatches.push({
          userId: "seed-email-1",
          handle: "emailmatch",
          name: "Email Match",
          profilePic: null,
          reason: "contacts",
          isFollowing: false,
          score: 1000
        });
      }
      return { matchedUsers: localMatches, matchedCount: localMatches.length, syncedAt: now };
    }

    const matchesByUser = new Map<string, UserSuggestionSummary>();
    const phoneList = [...phoneSet];
    for (let i = 0; i < phoneList.length; i += 10) {
      const chunk = phoneList.slice(i, i + 10);
      if (chunk.length === 0) continue;
      const q = await this.db.collection("users").where("phoneNumber", "in", chunk).select("handle", "name", "displayName", "profilePic", "followers").get();
      incrementDbOps("queries", 1);
      incrementDbOps("reads", q.size);
      q.docs.forEach((doc) => {
        if (doc.id === input.viewerId) return;
        const summary = toSummary(
          doc.id,
          doc.data() as Record<string, unknown>,
          "contacts",
          viewerGraph.following.has(doc.id) || mutationStateRepository.isFollowing(input.viewerId, doc.id),
          1000
        );
        matchesByUser.set(doc.id, summary);
      });
    }
    const emailList = [...emailSet];
    for (let i = 0; i < emailList.length; i += 10) {
      const chunk = emailList.slice(i, i + 10);
      if (chunk.length === 0) continue;
      const q = await this.db.collection("users").where("email", "in", chunk).select("handle", "name", "displayName", "profilePic", "followers").get();
      incrementDbOps("queries", 1);
      incrementDbOps("reads", q.size);
      q.docs.forEach((doc) => {
        if (doc.id === input.viewerId) return;
        const summary = toSummary(
          doc.id,
          doc.data() as Record<string, unknown>,
          "contacts",
          viewerGraph.following.has(doc.id) || mutationStateRepository.isFollowing(input.viewerId, doc.id),
          1000
        );
        matchesByUser.set(doc.id, summary);
      });
    }

    const matchedUsers = [...matchesByUser.values()].sort((a, b) => a.userId.localeCompare(b.userId));
    await this.db.collection("users").doc(input.viewerId).set(
      {
        addressBookSyncedAt: now,
        addressBookUsers: matchedUsers.map((user) => user.userId),
        addressBookUserSummaries: matchedUsers.map((user) => ({
          userId: user.userId,
          handle: user.handle,
          name: user.name,
          profilePic: user.profilePic
        })),
        addressBookPhoneNumbers: [...phoneSet]
      },
      { merge: true }
    );
    incrementDbOps("writes", 1);
    return { matchedUsers, matchedCount: matchedUsers.length, syncedAt: now };
  }

  async getSuggestionsForUser(viewerId: string, options: SuggestedFriendsOptions): Promise<{ users: UserSuggestionSummary[]; sourceBreakdown: Record<string, number>; generatedAt: number; etag: string }> {
    const safeLimit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, 50));
    const surface = options.surface ?? "generic";
    const includeContacts = options.includeContacts ?? true;
    const includeMutuals = options.includeMutuals ?? true;
    const includePopular = options.includePopular ?? true;
    const includeNearby = options.includeNearby ?? (surface === "onboarding");
    const excludeFollowing = options.excludeAlreadyFollowing ?? true;
    const excludeBlocked = options.excludeBlocked ?? true;
    const viewer = await this.loadViewerGraph(viewerId);

    const out = new Map<string, UserSuggestionSummary>();
    const add = (items: UserSuggestionSummary[]) => {
      for (const user of items) {
        if (user.userId === viewerId) continue;
        if (excludeFollowing && (viewer.following.has(user.userId) || mutationStateRepository.isFollowing(viewerId, user.userId))) continue;
        if (excludeBlocked && viewer.blocked.has(user.userId)) continue;
        const existing = out.get(user.userId);
        if (!existing || (user.score ?? 0) > (existing.score ?? 0)) out.set(user.userId, user);
      }
    };

    if (includeContacts && viewer.contactUserSummaries.length > 0) {
      add(viewer.contactUserSummaries.map((row) => ({ ...row, isFollowing: viewer.following.has(row.userId) })));
    }

    const contactsPromise =
      this.db && includeContacts && viewer.contactUserSummaries.length === 0 && viewer.contactUsers.length > 0
        ? this.db.getAll(
            ...viewer.contactUsers.slice(0, Math.min(Math.max(safeLimit, 4), 6)).map((id) => this.db!.collection("users").doc(id))
          )
        : null;
    const mutualsPromise =
      this.db && includeMutuals && viewer.following.size > 0
        ? Promise.all(
            [...viewer.following]
              .slice(0, 1)
              .map((fid) => this.db!.collection("users").doc(fid).collection("following").limit(2).get())
          )
        : null;

    const [contactDocs, mutualSnaps] = await Promise.all([contactsPromise, mutualsPromise]);

    if (contactDocs) {
      incrementDbOps("reads", contactDocs.length);
      const contactSummaries = contactDocs
        .filter((doc) => doc.exists)
        .map((doc) => toSummary(doc.id, (doc.data() ?? {}) as Record<string, unknown>, "contacts", viewer.following.has(doc.id), 1200));
      add(contactSummaries);
      void this.db!
        .collection("users")
        .doc(viewerId)
        .set(
          {
            addressBookUserSummaries: contactSummaries.map((user) => ({
              userId: user.userId,
              handle: user.handle,
              name: user.name,
              profilePic: user.profilePic
            }))
          },
          { merge: true }
        )
        .then(async () => {
          const cachedUserDoc = (await globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(viewerId))) ?? {};
          await globalCache.set(
            entityCacheKeys.userFirestoreDoc(viewerId),
            {
              ...cachedUserDoc,
              addressBookUserSummaries: contactSummaries.map((user) => ({
                userId: user.userId,
                handle: user.handle,
                name: user.name,
                profilePic: user.profilePic
              }))
            },
            25_000
          );
        })
        .catch(() => undefined);
    }

    if (mutualSnaps) {
      incrementDbOps("queries", mutualSnaps.length);
      mutualSnaps.forEach((snap) => incrementDbOps("reads", snap.size));
      mutualSnaps.forEach((q) => {
        q.docs.forEach((doc) => {
          const current = out.get(doc.id);
          const mutual = (current?.mutualCount ?? 0) + 1;
          out.set(doc.id, {
            userId: doc.id,
            handle: current?.handle ?? null,
            name: current?.name ?? null,
            profilePic: current?.profilePic ?? null,
            reason: "mutuals",
            mutualCount: mutual,
            isFollowing: viewer.following.has(doc.id),
            score: 900 + mutual
          });
        });
      });
    }

    const needPopular = includePopular && out.size < safeLimit;
    const needNearby = includeNearby && out.size < safeLimit;
    const popularPromise =
      this.db && needPopular
        ? this.db
            .collection("users")
            .orderBy("postCount", "desc")
            .select("handle", "name", "displayName", "profilePic", "profilePicPath", "profilePicLarge", "profilePicSmall", "photoURL", "followers")
            .limit(Math.min(Math.max(safeLimit - out.size, 2), 3))
            .get()
        : null;
    const nearbyPromise =
      this.db && needNearby
        ? this.db
            .collection("users")
            .orderBy("updatedAt", "desc")
            .select("handle", "name", "displayName", "profilePic", "profilePicPath", "profilePicLarge", "profilePicSmall", "photoURL", "followers")
            .limit(1)
            .get()
        : null;
    const [popularSnap, nearbySnap] = await Promise.all([popularPromise, nearbyPromise]);

    if (popularSnap) {
      incrementDbOps("queries", 1);
      incrementDbOps("reads", popularSnap.size);
      add(
        popularSnap.docs.map((doc) =>
          toSummary(doc.id, doc.data() as Record<string, unknown>, "popular", viewer.following.has(doc.id), 500)
        )
      );
    }

    if (nearbySnap) {
      incrementDbOps("queries", 1);
      incrementDbOps("reads", nearbySnap.size);
      add(
        nearbySnap.docs.map((doc) =>
          toSummary(doc.id, doc.data() as Record<string, unknown>, "nearby", viewer.following.has(doc.id), 600)
        )
      );
    }

    const users = [...out.values()]
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.userId.localeCompare(b.userId))
      .slice(0, safeLimit);
    const sourceBreakdown: Record<string, number> = {};
    users.forEach((user) => {
      sourceBreakdown[user.reason] = (sourceBreakdown[user.reason] ?? 0) + 1;
    });
    const generatedAt = Date.now();
    const etag = createHash("sha1")
      .update(`${viewerId}:${surface}:${users.map((u) => `${u.userId}:${u.reason}:${u.isFollowing ? 1 : 0}`).join("|")}`)
      .digest("hex");
    return { users, sourceBreakdown, generatedAt, etag };
  }
}
