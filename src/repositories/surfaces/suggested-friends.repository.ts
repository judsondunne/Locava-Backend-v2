import { createHash } from "node:crypto";
import { entityCacheKeys } from "../../cache/entity-cache.js";
import { globalCache } from "../../cache/global-cache.js";
import { incrementDbOps } from "../../observability/request-context.js";
import { getFirestoreSourceClient } from "../source-of-truth/firestore-client.js";
import { mutationStateRepository } from "../mutations/mutation-state.repository.js";
import { loadEnv } from "../../config/env.js";
import {
  derivePhoneLast10,
  digitsOnly,
  normalizePhoneForSearch,
} from "../../lib/phone-search-fields.js";

export type UserSuggestionSummary = {
  userId: string;
  handle: string | null;
  name: string | null;
  profilePic: string | null;
  reason: "contacts" | "referral" | "groups" | "mutuals" | "popular" | "nearby" | "all_users";
  reasonLabel?: string | null;
  mutualCount?: number;
  mutualPreview?: Array<{ userId: string; handle?: string | null }>;
  isFollowing: boolean;
  followerCount?: number;
  postCount?: number;
  score?: number;
};

export type SuggestedFriendsOptions = {
  limit?: number;
  excludeUserIds?: string[];
  includeContacts?: boolean;
  includeMutuals?: boolean;
  includePopular?: boolean;
  includeNearby?: boolean;
  includeGroups?: boolean;
  includeReferral?: boolean;
  includeAllUsersFallback?: boolean;
  excludeAlreadyFollowing?: boolean;
  excludeBlocked?: boolean;
  sortBy?: "default" | "postCount";
  surface?: "onboarding" | "profile" | "search" | "home" | "notifications" | "generic";
  /** Skip globalCache read/write (e.g. Search Home `bypassCache=1`). */
  bypassCache?: boolean;
};

export type ContactSyncDiagnostics = {
  totalContactsReceived: number;
  uniqueRawPhones: number;
  uniquePhoneLast10Candidates: number;
  uniqueEmails: number;
  phoneLast10QueryChunksCount: number;
  phoneSearchKeysQueryChunksCount: number;
  emailQueryChunksCount: number;
  matchedByPhoneLast10Count: number;
  matchedByPhoneSearchKeysCount: number;
  matchedByEmailCount: number;
  finalMatchedUserIds: string[];
  unmatchedContactPhonesSample: string[];
  matchedUsers: Array<{
    userId: string;
    displayName: string | null;
    storedPhoneFields: {
      phoneNumber: string | null;
      phone: string | null;
      phone_number: string | null;
      number: string | null;
      phoneLast10: string | null;
      phoneE164: string | null;
      phoneDigits: string | null;
    };
    matchedKey: string;
  }>;
  redactedForProduction: boolean;
};

type ViewerGraph = {
  following: Set<string>;
  blocked: Set<string>;
  contactUsers: string[];
  contactUserSummaries: UserSuggestionSummary[];
  phoneContacts: string[];
  branchCandidateUserIds: string[];
};

const DEFAULT_LIMIT = 20;
const MAX_CONTACT_SYNC_PHONE_CHUNKS = 12;
const MAX_CONTACT_SYNC_EMAIL_CHUNKS = 8; // 8 queries max

const CONTACT_REASON_LABEL = "In your contacts";

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function redactPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = digitsOnly(value);
  if (!digits) return null;
  return `***${digits.slice(-4)}`;
}

const runtimeEnv = loadEnv();
const allowVerboseContactSyncDiagnostics = runtimeEnv.NODE_ENV !== "production" && runtimeEnv.ENABLE_DEV_DIAGNOSTICS;

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
    postCount:
      typeof data.postCount === "number" && Number.isFinite(data.postCount)
        ? Math.max(0, Math.floor(data.postCount))
        : undefined,
    score
  };
}

export function buildSuggestedFriendsCacheKey(viewerId: string, surface: string, limit: number): string {
  return `social:suggested_friends:${viewerId}:${surface}:${limit}`;
}

export class SuggestedFriendsRepository {
  constructor(private readonly db = getFirestoreSourceClient()) {}

  async loadViewerGraph(viewerId: string, options: { allowFirestore?: boolean } = {}): Promise<ViewerGraph> {
    const allowFirestore = options.allowFirestore ?? true;
    if (!this.db) {
      return {
        following: new Set(),
        blocked: new Set(),
        contactUsers: [],
        contactUserSummaries: [],
        phoneContacts: [],
        branchCandidateUserIds: []
      };
    }
    let data = await globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(viewerId));
    if (data === undefined && allowFirestore) {
      const doc = await this.db.collection("users").doc(viewerId).get();
      incrementDbOps("queries", 1);
      incrementDbOps("reads", doc.exists ? 1 : 0);
      data = (doc.data() ?? {}) as Record<string, unknown>;
      await globalCache.set(entityCacheKeys.userFirestoreDoc(viewerId), data, 25_000);
    }
    if (data === undefined) {
      return {
        following: new Set(),
        blocked: new Set(),
        contactUsers: [],
        contactUserSummaries: [],
        phoneContacts: [],
        branchCandidateUserIds: []
      };
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
            reasonLabel: CONTACT_REASON_LABEL,
            isFollowing: following.has(String(row.userId ?? "").trim()) || mutationStateRepository.isFollowing(viewerId, String(row.userId ?? "").trim()),
            score: 1200
          }))
          .filter((row) => row.userId.length > 0)
      : [];
    const phoneContacts = Array.isArray(data.addressBookPhoneNumbers)
      ? (() => {
          const set = new Set<string>();
          for (const value of data.addressBookPhoneNumbers) {
            if (typeof value !== "string") continue;
            const normalized = normalizePhoneForSearch(value);
            normalized.queryKeys.forEach((candidate) => set.add(candidate));
          }
          return [...set];
        })()
      : [];

    const branchCandidateUserIds = extractCandidateUserIdsFromBranchData((data.branchData ?? null) as unknown, { viewerId });
    return { following, blocked, contactUsers, contactUserSummaries, phoneContacts, branchCandidateUserIds };
  }

  async syncContacts(input: {
    viewerId: string;
    contacts: Array<{ phoneNumbers?: string[]; emails?: string[] }>;
  }): Promise<{ matchedUsers: UserSuggestionSummary[]; matchedCount: number; syncedAt: number; diagnostics: ContactSyncDiagnostics }> {
    const viewerGraph = await this.loadViewerGraph(input.viewerId);
    const phoneLast10Set = new Set<string>();
    const phoneSearchKeysSet = new Set<string>();
    const addressBookPhonesCanonical = new Set<string>();
    const emailSet = new Set<string>();
    const rawPhoneSet = new Set<string>();
    for (const contact of input.contacts) {
      for (const phone of contact.phoneNumbers ?? []) {
        const normalized = normalizePhoneForSearch(phone);
        if (!normalized.raw) continue;
        rawPhoneSet.add(normalized.raw);
        normalized.queryKeys.forEach((key) => phoneSearchKeysSet.add(key));
        if (normalized.phoneLast10) {
          phoneLast10Set.add(normalized.phoneLast10);
          addressBookPhonesCanonical.add(normalized.phoneLast10);
        } else if (normalized.digits) {
          addressBookPhonesCanonical.add(normalized.digits);
        }
      }
      for (const email of contact.emails ?? []) {
        const normalized = normalizeEmail(email);
        if (normalized.includes("@")) emailSet.add(normalized);
      }
    }
    const now = Date.now();
    if (!this.db) {
      // No fake users when Firestore isn't available.
      return {
        matchedUsers: [],
        matchedCount: 0,
        syncedAt: now,
        diagnostics: {
          totalContactsReceived: input.contacts.length,
          uniqueRawPhones: rawPhoneSet.size,
          uniquePhoneLast10Candidates: phoneLast10Set.size,
          uniqueEmails: emailSet.size,
          phoneLast10QueryChunksCount: 0,
          phoneSearchKeysQueryChunksCount: 0,
          emailQueryChunksCount: 0,
          matchedByPhoneLast10Count: 0,
          matchedByPhoneSearchKeysCount: 0,
          matchedByEmailCount: 0,
          finalMatchedUserIds: [],
          unmatchedContactPhonesSample: [],
          matchedUsers: [],
          redactedForProduction: true,
        }
      };
    }

    const matchesByUser = new Map<string, UserSuggestionSummary>();
    const matchedByPhoneLast10 = new Set<string>();
    const matchedByPhoneSearchKeys = new Set<string>();
    const emailMatchedUserIds = new Set<string>();
    const phoneLast10List = [...phoneLast10Set];
    const phoneSearchKeysList = [...phoneSearchKeysSet];
    const emailList = [...emailSet];
    const phoneSelectFields = [
      "handle",
      "name",
      "displayName",
      "profilePic",
      "followers",
      "phoneNumber",
      "phone",
      "phone_number",
      "number",
      "phoneLast10",
      "phoneE164",
      "phoneDigits",
      "phoneSearchKeys",
      "email",
    ] as const;

    const phoneLast10Chunks: string[][] = [];
    for (let i = 0; i < phoneLast10List.length; i += 10) {
      const chunk = phoneLast10List.slice(i, i + 10);
      if (chunk.length > 0) phoneLast10Chunks.push(chunk);
    }
    const phoneSearchKeysChunks: string[][] = [];
    for (let i = 0; i < phoneSearchKeysList.length; i += 10) {
      const chunk = phoneSearchKeysList.slice(i, i + 10);
      if (chunk.length > 0) phoneSearchKeysChunks.push(chunk);
    }
    const emailChunks: string[][] = [];
    for (let i = 0; i < emailList.length; i += 10) {
      const chunk = emailList.slice(i, i + 10);
      if (chunk.length > 0) emailChunks.push(chunk);
    }

    const matchedDetails = new Map<
      string,
      {
        matchedKey: string;
        displayName: string | null;
        storedPhoneFields: ContactSyncDiagnostics["matchedUsers"][number]["storedPhoneFields"];
      }
    >();
    const matchedPhonesFromUsers = new Set<string>();

    const ingestMatchedDoc = (
      doc: { id: string; data: () => Record<string, unknown> },
      matchedKey: string,
      source: "phoneLast10" | "phoneSearchKeys" | "email"
    ): void => {
      if (doc.id === input.viewerId) return;
      const docData = doc.data() as Record<string, unknown>;
      const summary = {
        ...toSummary(
          doc.id,
          docData,
          "contacts",
          viewerGraph.following.has(doc.id) || mutationStateRepository.isFollowing(input.viewerId, doc.id),
          1200
        ),
        reasonLabel: CONTACT_REASON_LABEL,
      };
      matchesByUser.set(doc.id, summary);
      const displayName =
        summary.name ??
        (typeof docData.displayName === "string" ? docData.displayName.trim() || null : null);
      const storedPhoneFields = {
        phoneNumber: typeof docData.phoneNumber === "string" ? docData.phoneNumber : null,
        phone: typeof docData.phone === "string" ? docData.phone : null,
        phone_number: typeof docData.phone_number === "string" ? docData.phone_number : null,
        number: typeof docData.number === "string" ? docData.number : null,
        phoneLast10: typeof docData.phoneLast10 === "string" ? docData.phoneLast10 : null,
        phoneE164: typeof docData.phoneE164 === "string" ? docData.phoneE164 : null,
        phoneDigits: typeof docData.phoneDigits === "string" ? docData.phoneDigits : null,
      };
      matchedDetails.set(doc.id, { matchedKey, displayName, storedPhoneFields });

      if (source === "phoneLast10") matchedByPhoneLast10.add(doc.id);
      if (source === "phoneSearchKeys") matchedByPhoneSearchKeys.add(doc.id);
      if (source === "email") emailMatchedUserIds.add(doc.id);

      for (const raw of Object.values(storedPhoneFields)) {
        const digits = typeof raw === "string" ? digitsOnly(raw) : "";
        const matchable = derivePhoneLast10(digits) ?? digits;
        if (matchable) matchedPhonesFromUsers.add(matchable);
      }
    };

    const runPhoneLast10Chunk = async (
      chunk: string[]
    ): Promise<void> => {
      const q = await this.db!.collection("users").where("phoneLast10", "in", chunk).select(...phoneSelectFields).get();
      incrementDbOps("queries", 1);
      incrementDbOps("reads", q.size);
      q.docs.forEach((doc) => ingestMatchedDoc(doc, `phoneLast10:${chunk.join(",")}`, "phoneLast10"));
    };

    const runPhoneSearchKeysChunk = async (chunk: string[]): Promise<void> => {
      const q = await this.db!.collection("users").where("phoneSearchKeys", "array-contains-any", chunk).select(...phoneSelectFields).get();
      incrementDbOps("queries", 1);
      incrementDbOps("reads", q.size);
      q.docs.forEach((doc) => ingestMatchedDoc(doc, `phoneSearchKeys:${chunk.join(",")}`, "phoneSearchKeys"));
    };

    const runEmailChunk = async (
      chunk: string[]
    ): Promise<void> => {
      const q = await this.db!
        .collection("users")
        .where("email", "in", chunk)
        .select(...phoneSelectFields)
        .get();
      incrementDbOps("queries", 1);
      incrementDbOps("reads", q.size);
      q.docs.forEach((doc) => {
        if (doc.id === input.viewerId) return;
        ingestMatchedDoc(doc, `email:${chunk.join(",")}`, "email");
      });
    };

    const boundedPhoneLast10Chunks = phoneLast10Chunks.slice(0, MAX_CONTACT_SYNC_PHONE_CHUNKS);
    const boundedPhoneSearchKeysChunks = phoneSearchKeysChunks.slice(0, MAX_CONTACT_SYNC_PHONE_CHUNKS);
    const boundedEmailChunks = emailChunks.slice(0, MAX_CONTACT_SYNC_EMAIL_CHUNKS);
    // Keep contact sync bounded so it never overloads launch-critical routes.
    await Promise.all([
      Promise.all(boundedPhoneLast10Chunks.map((c) => runPhoneLast10Chunk(c))),
      Promise.all(boundedPhoneSearchKeysChunks.map((c) => runPhoneSearchKeysChunk(c))),
      Promise.all(boundedEmailChunks.map((c) => runEmailChunk(c)))
    ]);

    const matchedUsers = [...matchesByUser.values()].sort((a, b) => a.userId.localeCompare(b.userId));
    const unmatchedContactPhonesSample = [...rawPhoneSet]
      .map((raw) => normalizePhoneForSearch(raw))
      .filter((row) => {
        if (!row.digits) return false;
        const key = row.phoneLast10 ?? row.digits;
        return !matchedPhonesFromUsers.has(key);
      })
      .slice(0, 20)
      .map((row) => row.raw);

    const diagnosticsMatchedUsers = [...matchedDetails.entries()].map(([userId, detail]) => ({
      userId,
      displayName: detail.displayName,
      storedPhoneFields: allowVerboseContactSyncDiagnostics
        ? detail.storedPhoneFields
        : {
            phoneNumber: redactPhone(detail.storedPhoneFields.phoneNumber),
            phone: redactPhone(detail.storedPhoneFields.phone),
            phone_number: redactPhone(detail.storedPhoneFields.phone_number),
            number: redactPhone(detail.storedPhoneFields.number),
            phoneLast10: redactPhone(detail.storedPhoneFields.phoneLast10),
            phoneE164: redactPhone(detail.storedPhoneFields.phoneE164),
            phoneDigits: redactPhone(detail.storedPhoneFields.phoneDigits),
          },
      matchedKey: detail.matchedKey,
    }));

    await this.db.collection("users").doc(input.viewerId).set(
      {
        addressBookSyncedAt: now,
        addressBookUsers: matchedUsers.map((user) => user.userId),
        addressBookUserSummaries: matchedUsers.map((user) => ({
          userId: user.userId,
          handle: user.handle,
          name: user.name,
          profilePic: user.profilePic,
          reasonLabel: CONTACT_REASON_LABEL
        })),
        addressBookPhoneNumbers: [...addressBookPhonesCanonical].sort()
      },
      { merge: true }
    );
    incrementDbOps("writes", 1);
    await globalCache.del(entityCacheKeys.userFirestoreDoc(input.viewerId));
    const uniqueMatchedUserIds = matchedUsers.map((row) => row.userId);
    return {
      matchedUsers,
      matchedCount: matchedUsers.length,
      syncedAt: now,
      diagnostics: {
        totalContactsReceived: input.contacts.length,
        uniqueRawPhones: rawPhoneSet.size,
        uniquePhoneLast10Candidates: phoneLast10List.length,
        uniqueEmails: emailList.length,
        phoneLast10QueryChunksCount: boundedPhoneLast10Chunks.length,
        phoneSearchKeysQueryChunksCount: boundedPhoneSearchKeysChunks.length,
        emailQueryChunksCount: boundedEmailChunks.length,
        matchedByPhoneLast10Count: matchedByPhoneLast10.size,
        matchedByPhoneSearchKeysCount: matchedByPhoneSearchKeys.size,
        matchedByEmailCount: emailMatchedUserIds.size,
        finalMatchedUserIds: uniqueMatchedUserIds,
        unmatchedContactPhonesSample: allowVerboseContactSyncDiagnostics
          ? unmatchedContactPhonesSample
          : unmatchedContactPhonesSample.map((value) => redactPhone(value) ?? value),
        matchedUsers: diagnosticsMatchedUsers,
        redactedForProduction: !allowVerboseContactSyncDiagnostics,
      }
    };
  }

  async getSuggestionsForUser(viewerId: string, options: SuggestedFriendsOptions): Promise<{ users: UserSuggestionSummary[]; sourceBreakdown: Record<string, number>; generatedAt: number; etag: string }> {
    const safeLimit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, 50));
    const surface = options.surface ?? "generic";
    const includeContacts = options.includeContacts ?? true;
    const includeMutuals = options.includeMutuals ?? true;
    const includePopular = options.includePopular ?? true;
    const includeNearby = options.includeNearby ?? false;
    const includeGroups = options.includeGroups ?? true;
    const includeReferral = options.includeReferral ?? true;
    const includeAllUsersFallback = options.includeAllUsersFallback ?? true;
    const excludeFollowing = options.excludeAlreadyFollowing ?? true;
    const excludeBlocked = options.excludeBlocked ?? true;
    const excludedIds = new Set((options.excludeUserIds ?? []).map((id) => id.trim()).filter(Boolean));
    const sortBy = options.sortBy ?? "default";
    // Must load viewer graph from Firestore (cached) for correct filtering and referrals.
    const viewer = await this.loadViewerGraph(viewerId, { allowFirestore: true });

    const out = new Map<string, UserSuggestionSummary>();
    const warnSourceFailure = (source: string, error: unknown): void => {
      const message = error instanceof Error ? error.message : String(error);
      const code = message.includes("FAILED_PRECONDITION") ? "FAILED_PRECONDITION" : "unknown";
      console.warn("[suggested-friends] source query failed", {
        source,
        viewerId,
        surface,
        errorCode: code,
        error: message,
      });
    };
    const add = (items: UserSuggestionSummary[]) => {
      for (const user of items) {
        if (user.userId === viewerId) continue;
        if (excludedIds.has(user.userId)) continue;
        if (excludeFollowing && (viewer.following.has(user.userId) || mutationStateRepository.isFollowing(viewerId, user.userId))) continue;
        if (excludeBlocked && viewer.blocked.has(user.userId)) continue;
        const existing = out.get(user.userId);
        if (!existing || (user.score ?? 0) > (existing.score ?? 0)) out.set(user.userId, user);
      }
    };
    const addHardFallback = (items: UserSuggestionSummary[]) => {
      for (const user of items) {
        if (user.userId === viewerId) continue;
        if (excludedIds.has(user.userId)) continue;
        if (excludeBlocked && viewer.blocked.has(user.userId)) continue;
        const existing = out.get(user.userId);
        if (!existing || (user.score ?? 0) > (existing.score ?? 0)) out.set(user.userId, user);
      }
    };

    if (includeReferral && viewer.branchCandidateUserIds.length > 0) {
      // Hydrate a tiny number of deep-link/referral candidates; these should always be prioritized.
      const ids = viewer.branchCandidateUserIds.slice(0, 6).filter((id) => id !== viewerId);
      if (this.db && ids.length > 0) {
        try {
          const docs = await this.db.getAll(...ids.map((id) => this.db!.collection("users").doc(id)));
          incrementDbOps("reads", docs.length);
          add(
            docs
              .filter((doc) => doc.exists)
              .map((doc) =>
                ({
                  ...toSummary(doc.id, (doc.data() ?? {}) as Record<string, unknown>, "referral", viewer.following.has(doc.id), 1400),
                  reasonLabel: "From an invite"
                }) satisfies UserSuggestionSummary
              )
          );
        } catch (error) {
          warnSourceFailure("referral", error);
        }
      }
    }

    if (includeContacts && viewer.contactUserSummaries.length > 0) {
      add(
        viewer.contactUserSummaries.map((row) => ({
          ...row,
          isFollowing: viewer.following.has(row.userId),
          reasonLabel: row.reason === "contacts" ? (row.reasonLabel ?? CONTACT_REASON_LABEL) : row.reasonLabel
        }))
      );
    }

    const contactsPromise =
      this.db && includeContacts && viewer.contactUserSummaries.length === 0 && viewer.contactUsers.length > 0
        ? this.db
            .getAll(...viewer.contactUsers.slice(0, Math.min(Math.max(safeLimit, 4), 6)).map((id) => this.db!.collection("users").doc(id)))
            .catch((error) => {
              warnSourceFailure("contacts", error);
              return null;
            })
        : null;
    // Mutuals: bounded + cheap. Read a few of the viewer's following docs and derive mutual candidates from their `following` arrays.
    const mutualsPromise =
      this.db && includeMutuals && viewer.following.size > 0
        ? (async () => {
            const seeds = [...viewer.following].slice(0, 6);
            if (seeds.length === 0) return { counts: new Map<string, number>(), previewByCandidate: new Map<string, string[]>() };
            const seedDocs = await this.db!.getAll(...seeds.map((id) => this.db!.collection("users").doc(id)));
            incrementDbOps("reads", seedDocs.length);
            const counts = new Map<string, number>();
            const previewByCandidate = new Map<string, string[]>();
            for (const doc of seedDocs) {
              if (!doc.exists) continue;
              const data = (doc.data() ?? {}) as Record<string, unknown>;
              const followingArr = Array.isArray(data.following) ? data.following.filter((v): v is string => typeof v === "string") : [];
              for (const cand of followingArr.slice(0, 80)) {
                if (!cand || cand === viewerId) continue;
                if (viewer.following.has(cand)) continue;
                if (excludeBlocked && viewer.blocked.has(cand)) continue;
                counts.set(cand, (counts.get(cand) ?? 0) + 1);
                const prev = previewByCandidate.get(cand) ?? [];
                if (prev.length < 5 && doc.id !== viewerId) {
                  prev.push(doc.id);
                  previewByCandidate.set(cand, prev);
                }
              }
            }
            return { counts, previewByCandidate };
          })().catch((error) => {
            warnSourceFailure("mutuals", error);
            return null;
          })
        : null;

    const [contactDocs, mutualDerived] = await Promise.all([contactsPromise, mutualsPromise]);

    if (contactDocs) {
      incrementDbOps("reads", contactDocs.length);
      const contactSummaries = contactDocs
        .filter((doc) => doc.exists)
        .map((doc) => ({
          ...toSummary(doc.id, (doc.data() ?? {}) as Record<string, unknown>, "contacts", viewer.following.has(doc.id), 1200),
          reasonLabel: CONTACT_REASON_LABEL
        }));
      add(contactSummaries);
      void (async () => {
        const cachedUserDoc = (await globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(viewerId))) ?? {};
        await globalCache.set(
          entityCacheKeys.userFirestoreDoc(viewerId),
          {
            ...cachedUserDoc,
            addressBookUserSummaries: contactSummaries.map((user) => ({
              userId: user.userId,
              handle: user.handle,
              name: user.name,
              profilePic: user.profilePic,
              reasonLabel: user.reasonLabel ?? CONTACT_REASON_LABEL
            }))
          },
          25_000
        );
      })().catch(() => undefined);
    }

    if (mutualDerived && this.db) {
      const sortedCandidates = [...mutualDerived.counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 30);
      const candidateIds = sortedCandidates.map(([id]) => id);
      if (candidateIds.length > 0) {
        const docs = await this.db.getAll(...candidateIds.map((id) => this.db!.collection("users").doc(id)));
        incrementDbOps("reads", docs.length);
        const previewIds = [...new Set(sortedCandidates.flatMap(([id]) => mutualDerived.previewByCandidate.get(id) ?? []))].slice(0, 20);
        const previewProfiles =
          previewIds.length > 0
            ? await this.db
                .getAll(...previewIds.map((id) => this.db!.collection("users").doc(id)))
                .then((snaps) => {
                  incrementDbOps("reads", snaps.length);
                  const map = new Map<string, { handle: string | null }>();
                  snaps.forEach((s) => {
                    const d = (s.data() ?? {}) as Record<string, unknown>;
                    const h = typeof d.handle === "string" ? d.handle.replace(/^@+/, "").trim() : null;
                    map.set(s.id, { handle: h || null });
                  });
                  return map;
                })
                .catch(() => new Map<string, { handle: string | null }>())
            : new Map<string, { handle: string | null }>();
        const byId = new Map(docs.filter((d) => d.exists).map((d) => [d.id, d.data() as Record<string, unknown>]));
        const mutualSummaries: UserSuggestionSummary[] = [];
        for (const [id, count] of sortedCandidates) {
          const data = byId.get(id);
          if (!data) continue;
          const preview = (mutualDerived.previewByCandidate.get(id) ?? []).slice(0, 3).map((uid) => ({
            userId: uid,
            handle: previewProfiles.get(uid)?.handle ?? null
          }));
          mutualSummaries.push({
            ...toSummary(id, data, "mutuals", viewer.following.has(id), 1100 + count),
            mutualCount: count,
            mutualPreview: preview,
            reasonLabel: count === 1 ? "1 mutual" : `${count} mutuals`
          });
        }
        add(mutualSummaries);
      }
    }

    if (includeGroups && this.db && out.size < safeLimit) {
      try {
        // Shared communities/groups: suggest other members from groups the viewer is in.
        const membershipSnap = await this.db.collectionGroup("members").where("userId", "==", viewerId).limit(10).get();
        incrementDbOps("queries", 1);
        incrementDbOps("reads", membershipSnap.size);
        const groupIds = membershipSnap.docs
          .map((doc) => doc.ref.parent.parent?.id ?? "")
          .filter((id) => id.length > 0)
          .slice(0, 10);
        const groupSnap = groupIds.length > 0
          ? await Promise.all(groupIds.map((groupId) => this.db!.collection("groups").doc(groupId).get()))
          : [];
        incrementDbOps("reads", groupSnap.length);
        const candidateIds: string[] = [];
        const labelsByUser = new Map<string, string>();
        for (const g of groupSnap) {
          if (!g.exists) continue;
          const gd = g.data() as Record<string, unknown>;
          const name = typeof gd.name === "string" ? gd.name.trim() : "a group";
          const membersSnap = await this.db.collection("groups").doc(g.id).collection("members").limit(100).get();
          incrementDbOps("reads", membersSnap.size);
          const members = membersSnap.docs
            .map((doc) => String((doc.data() ?? {}).userId ?? doc.id).trim())
            .filter((id) => id.length > 0);
          for (const uid of members) {
            if (!uid || uid === viewerId) continue;
            if (viewer.following.has(uid)) continue;
            if (excludeBlocked && viewer.blocked.has(uid)) continue;
            candidateIds.push(uid);
            if (!labelsByUser.has(uid)) labelsByUser.set(uid, `In ${name}`);
          }
        }
        const unique = [...new Set(candidateIds)].slice(0, 30);
        if (unique.length > 0) {
          const docs = await this.db.getAll(...unique.map((id) => this.db!.collection("users").doc(id)));
          incrementDbOps("reads", docs.length);
          add(
            docs
              .filter((doc) => doc.exists)
              .map((doc) => ({
                ...toSummary(doc.id, (doc.data() ?? {}) as Record<string, unknown>, "groups", viewer.following.has(doc.id), 1000),
                reasonLabel: labelsByUser.get(doc.id) ?? "In your communities"
              }))
          );
        }
      } catch (error) {
        warnSourceFailure("groups", error);
      }
    }

    const needPopular = includePopular && out.size < safeLimit;
    const needNearby = includeNearby && out.size < safeLimit;
    const popularPromise =
      this.db && needPopular
        ? this.db
            .collection("users")
            .orderBy("postCount", "desc")
            .select("handle", "name", "displayName", "profilePic", "profilePicPath", "profilePicLarge", "profilePicSmall", "photoURL", "followers", "postCount")
            .limit(Math.min(Math.max(safeLimit - out.size, 4), 12))
            .get()
            .catch((error) => {
              warnSourceFailure("popular", error);
              return null;
            })
        : null;
    const nearbyPromise =
      this.db && needNearby
        ? this.db
            .collection("users")
            .orderBy("updatedAt", "desc")
            .select("handle", "name", "displayName", "profilePic", "profilePicPath", "profilePicLarge", "profilePicSmall", "photoURL", "followers")
            .limit(1)
            .get()
            .catch((error) => {
              warnSourceFailure("nearby", error);
              return null;
            })
        : null;
    const [popularSnap, nearbySnap] = await Promise.all([popularPromise, nearbyPromise]);

    if (popularSnap) {
      incrementDbOps("queries", 1);
      incrementDbOps("reads", popularSnap.size);
      add(
        popularSnap.docs.map((doc) =>
          ({
            ...toSummary(doc.id, doc.data() as Record<string, unknown>, "popular", viewer.following.has(doc.id), 500),
            reasonLabel: "Popular on Locava"
          })
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

    // Final fallback: return real eligible users when every signal is empty.
    if (this.db && includeAllUsersFallback && out.size < safeLimit) {
      try {
        const fallbackSnap = await this.db
          .collection("users")
          .orderBy("postCount", "desc")
          .select("handle", "name", "displayName", "profilePic", "profilePicPath", "profilePicLarge", "profilePicSmall", "photoURL", "followers", "postCount")
          .limit(Math.min(60, Math.max(safeLimit * 2, 20)))
          .get();
        incrementDbOps("queries", 1);
        incrementDbOps("reads", fallbackSnap.size);
        add(
          fallbackSnap.docs.map((doc) => ({
            ...toSummary(doc.id, doc.data() as Record<string, unknown>, "all_users", viewer.following.has(doc.id), 200),
            reasonLabel: "Suggested for you"
          }))
        );
      } catch (error) {
        warnSourceFailure("all_users_fallback", error);
      }
    }

    // Hard floor: always return at least a few real users, even if viewer follows everyone in the normal pool.
    if (this.db && out.size === 0) {
      try {
        const hardFallbackSnap = await this.db
          .collection("users")
          .orderBy("postCount", "desc")
          .select("handle", "name", "displayName", "profilePic", "profilePicPath", "profilePicLarge", "profilePicSmall", "photoURL", "followers", "postCount")
          .limit(12)
          .get();
        incrementDbOps("queries", 1);
        incrementDbOps("reads", hardFallbackSnap.size);
        addHardFallback(
          hardFallbackSnap.docs.map((doc) => ({
            ...toSummary(doc.id, doc.data() as Record<string, unknown>, "popular", viewer.following.has(doc.id), 100),
            reasonLabel: "Popular on Locava"
          }))
        );
      } catch (error) {
        warnSourceFailure("hard_floor", error);
      }
    }

    const users = [...out.values()]
      .sort((a, b) => {
        if (sortBy === "postCount") {
          const postDelta = (b.postCount ?? 0) - (a.postCount ?? 0);
          if (postDelta !== 0) return postDelta;
        }
        return (b.score ?? 0) - (a.score ?? 0) || a.userId.localeCompare(b.userId);
      })
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

export function extractCandidateUserIdsFromBranchData(
  branchData: unknown,
  options: { viewerId: string }
): string[] {
  if (!branchData || typeof branchData !== "object") return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: unknown) => {
    if (typeof value !== "string") return;
    const id = value.trim();
    if (!id || id === options.viewerId) return;
    // Firebase auth uids are typically >= 10 chars; keep heuristic loose but avoid obvious garbage.
    if (id.length < 8 || id.length > 128) return;
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  const walk = (obj: Record<string, unknown>, depth: number) => {
    if (depth > 3) return;
    for (const [k, v] of Object.entries(obj)) {
      const key = k.toLowerCase();
      if (key.includes("referr") || key.includes("inviter") || key.includes("sender") || key.endsWith("userid") || key.endsWith("user_id")) {
        push(v);
      }
      if (v && typeof v === "object" && !Array.isArray(v)) {
        walk(v as Record<string, unknown>, depth + 1);
      }
      if (Array.isArray(v)) {
        for (const item of v.slice(0, 10)) {
          if (typeof item === "string") push(item);
          else if (item && typeof item === "object") walk(item as Record<string, unknown>, depth + 1);
        }
      }
    }
  };
  walk(branchData as Record<string, unknown>, 0);
  return out.slice(0, 10);
}
