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
  includeContacts?: boolean;
  includeMutuals?: boolean;
  includePopular?: boolean;
  includeNearby?: boolean;
  includeGroups?: boolean;
  includeReferral?: boolean;
  includeAllUsersFallback?: boolean;
  excludeAlreadyFollowing?: boolean;
  excludeBlocked?: boolean;
  surface?: "onboarding" | "profile" | "search" | "home" | "notifications" | "generic";
  /** Skip globalCache read/write (e.g. Search Home `bypassCache=1`). */
  bypassCache?: boolean;
};

export type ContactSyncDiagnostics = {
  totalContactsReceived: number;
  rawPhoneNumbers: string[];
  rawEmails: string[];
  normalizedPhoneCandidates: string[];
  /** One canonical string per contact phone written to `addressBookPhoneNumbers` (not query variants). */
  canonicalAddressBookPhonesWritten: string[];
  normalizedEmails: string[];
  phoneQueryChunks: Array<{
    chunk: string[];
    matchedCount: number;
    matchedUserIds: string[];
    matchedPhoneNumbers: string[];
  }>;
  emailQueryChunks: Array<{
    chunk: string[];
    matchedCount: number;
    matchedUserIds: string[];
    matchedEmails: string[];
  }>;
  phoneMatchedUserIds: string[];
  emailMatchedUserIds: string[];
  uniqueMatchedUserIds: string[];
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

const CONTACT_REASON_LABEL = "In your contacts";

/** Loose NANP national number check (NXX-NXX-XXXX, N = 2–9). */
function isPlausibleNanpNational10(ten: string): boolean {
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(ten);
}

/**
 * Derive a 10-digit NANP national number from digit-only input when reasonable.
 * Handles: 10-digit national, 11-digit 1+NXX…, longer strings starting with 1 (paste/junk).
 */
function extractNanpNational10Digits(digits: string): string | null {
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length >= 12 && digits.length <= 15 && digits.startsWith("1")) {
    const head11 = digits.slice(0, 11);
    const fromHead = head11.slice(1);
    if (isPlausibleNanpNational10(fromHead)) return fromHead;
    const tail11 = digits.slice(-11);
    if (tail11.startsWith("1")) {
      const fromTail = tail11.slice(1);
      if (isPlausibleNanpNational10(fromTail)) return fromTail;
    }
  }
  return null;
}

/**
 * Phone normalization for matching contacts against stored `users.phoneNumber`.
 *
 * Firestore `phoneNumber` equality is exact: user docs may store `+16507046433`, `16507046433`,
 * or `6507046433`. Contacts / `addressBookPhoneNumbers` often store 10-digit only — we must
 * query every stored shape. For NANP we emit national, `1`+national, and `+1`+national; we avoid
 * using bare `+digits` for plausible NANP (that produces wrong strings like `+6507046433`).
 */
function normalizePhoneCandidates(raw: string): string[] {
  let digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return [];

  if (digits.length > 10 && digits.startsWith("00")) {
    digits = digits.replace(/^00+/, "");
  }

  const out = new Set<string>();
  const push = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    out.add(trimmed);
  };

  push(digits);

  const national10 = extractNanpNational10Digits(digits);
  if (national10 && isPlausibleNanpNational10(national10)) {
    push(national10);
    push(`1${national10}`);
    push(`+1${national10}`);
    const full11 = `1${national10}`;
    push(full11);
    push(`+${full11}`);
    // Legacy monolith often stores NANP in `users.number` as display text, not E.164.
    push(`(${national10.slice(0, 3)}) ${national10.slice(3, 6)}-${national10.slice(6)}`);
    push(`${national10.slice(0, 3)}-${national10.slice(3, 6)}-${national10.slice(6)}`);
    push(`${national10.slice(0, 3)}.${national10.slice(3, 6)}.${national10.slice(6)}`);
    return [...out];
  }

  // Non-NANP or unknown shape: still match international / odd stored literals.
  push(`+${digits}`);
  if (digits.length === 11 && digits.startsWith("1")) {
    push(digits.slice(1));
    push(`+1${digits.slice(1)}`);
  }
  return [...out];
}

/** Legacy user docs (monolith) use `number`; Backendv2 uses `phoneNumber`. */
function pickStoredPhoneFromUserDoc(data: Record<string, unknown>): string {
  const phoneNumber = typeof data.phoneNumber === "string" ? data.phoneNumber.trim() : "";
  if (phoneNumber.length > 0) return phoneNumber;
  const number = typeof data.number === "string" ? data.number.trim() : "";
  return number;
}

/**
 * Single value to persist on `users.addressBookPhoneNumbers` per logical phone.
 * Query-time variants are derived in memory via {@link normalizePhoneCandidates}; do not persist those.
 */
function canonicalizePhoneForAddressBookStorage(raw: string): string | null {
  let digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return null;
  if (digits.length > 10 && digits.startsWith("00")) {
    digits = digits.replace(/^00+/, "");
  }
  const national10 = extractNanpNational10Digits(digits);
  if (national10 && isPlausibleNanpNational10(national10)) {
    return national10;
  }
  return digits;
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
            for (const candidate of normalizePhoneCandidates(value)) {
              set.add(candidate);
            }
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
    const phoneSet = new Set<string>();
    const addressBookPhonesCanonical = new Set<string>();
    const emailSet = new Set<string>();
    const rawPhoneNumbers: string[] = [];
    const rawEmails: string[] = [];
    for (const contact of input.contacts) {
      for (const phone of contact.phoneNumbers ?? []) {
        if (typeof phone === "string" && phone.trim().length > 0) {
          rawPhoneNumbers.push(phone.trim());
        }
        const canonicalStored = canonicalizePhoneForAddressBookStorage(phone);
        if (canonicalStored) addressBookPhonesCanonical.add(canonicalStored);
        for (const candidate of normalizePhoneCandidates(phone)) {
          phoneSet.add(candidate);
        }
      }
      for (const email of contact.emails ?? []) {
        if (typeof email === "string" && email.trim().length > 0) {
          rawEmails.push(email.trim());
        }
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
          rawPhoneNumbers,
          rawEmails,
          normalizedPhoneCandidates: [...phoneSet].sort(),
          canonicalAddressBookPhonesWritten: [...addressBookPhonesCanonical].sort(),
          normalizedEmails: [...emailSet].sort(),
          phoneQueryChunks: [],
          emailQueryChunks: [],
          phoneMatchedUserIds: [],
          emailMatchedUserIds: [],
          uniqueMatchedUserIds: []
        }
      };
    }

    const matchesByUser = new Map<string, UserSuggestionSummary>();
    const phoneQueryChunks: ContactSyncDiagnostics["phoneQueryChunks"] = [];
    const emailQueryChunks: ContactSyncDiagnostics["emailQueryChunks"] = [];
    const phoneMatchedUserIds = new Set<string>();
    const emailMatchedUserIds = new Set<string>();
    const phoneList = [...phoneSet];
    const emailList = [...emailSet];
    const phoneSelectFields = ["handle", "name", "displayName", "profilePic", "followers", "phoneNumber", "number"] as const;

    const phoneChunks: string[][] = [];
    for (let i = 0; i < phoneList.length; i += 10) {
      const chunk = phoneList.slice(i, i + 10);
      if (chunk.length > 0) phoneChunks.push(chunk);
    }
    const emailChunks: string[][] = [];
    for (let i = 0; i < emailList.length; i += 10) {
      const chunk = emailList.slice(i, i + 10);
      if (chunk.length > 0) emailChunks.push(chunk);
    }

    const runPhoneChunk = async (
      chunk: string[]
    ): Promise<{
      chunk: string[];
      matchedCount: number;
      matchedUserIds: string[];
      matchedPhoneNumbers: string[];
    }> => {
      const [qPhoneNumber, qNumber] = await Promise.all([
        this.db!.collection("users").where("phoneNumber", "in", chunk).select(...phoneSelectFields).get(),
        this.db!.collection("users").where("number", "in", chunk).select(...phoneSelectFields).get()
      ]);
      incrementDbOps("queries", 2);
      incrementDbOps("reads", qPhoneNumber.size + qNumber.size);
      const matchedUserIdsForChunk: string[] = [];
      const matchedPhoneNumbersForChunk: string[] = [];
      const seenUserIds = new Set<string>();
      const ingestContactDoc = (doc: (typeof qPhoneNumber.docs)[number]) => {
        if (doc.id === input.viewerId) return;
        if (seenUserIds.has(doc.id)) return;
        seenUserIds.add(doc.id);
        const docData = doc.data() as Record<string, unknown>;
        const docPhone = pickStoredPhoneFromUserDoc(docData);
        if (docPhone.length > 0) matchedPhoneNumbersForChunk.push(docPhone);
        matchedUserIdsForChunk.push(doc.id);
        phoneMatchedUserIds.add(doc.id);
        const summary = {
          ...toSummary(
            doc.id,
            docData,
            "contacts",
            viewerGraph.following.has(doc.id) || mutationStateRepository.isFollowing(input.viewerId, doc.id),
            1200
          ),
          reasonLabel: CONTACT_REASON_LABEL
        };
        matchesByUser.set(doc.id, summary);
      };
      qPhoneNumber.docs.forEach(ingestContactDoc);
      qNumber.docs.forEach(ingestContactDoc);
      return {
        chunk,
        matchedCount: matchedUserIdsForChunk.length,
        matchedUserIds: matchedUserIdsForChunk,
        matchedPhoneNumbers: [...new Set(matchedPhoneNumbersForChunk)].sort()
      };
    };

    const runEmailChunk = async (
      chunk: string[]
    ): Promise<{
      chunk: string[];
      matchedCount: number;
      matchedUserIds: string[];
      matchedEmails: string[];
    }> => {
      const q = await this.db!
        .collection("users")
        .where("email", "in", chunk)
        .select("handle", "name", "displayName", "profilePic", "followers", "email")
        .get();
      incrementDbOps("queries", 1);
      incrementDbOps("reads", q.size);
      const matchedUserIdsForChunk: string[] = [];
      const matchedEmailsForChunk: string[] = [];
      q.docs.forEach((doc) => {
        if (doc.id === input.viewerId) return;
        const docData = doc.data() as Record<string, unknown>;
        const docEmail = typeof docData.email === "string" ? docData.email.trim().toLowerCase() : "";
        if (docEmail.length > 0) matchedEmailsForChunk.push(docEmail);
        matchedUserIdsForChunk.push(doc.id);
        emailMatchedUserIds.add(doc.id);
        const summary = {
          ...toSummary(
            doc.id,
            docData,
            "contacts",
            viewerGraph.following.has(doc.id) || mutationStateRepository.isFollowing(input.viewerId, doc.id),
            1200
          ),
          reasonLabel: CONTACT_REASON_LABEL
        };
        matchesByUser.set(doc.id, summary);
      });
      return {
        chunk,
        matchedCount: matchedUserIdsForChunk.length,
        matchedUserIds: matchedUserIdsForChunk,
        matchedEmails: [...new Set(matchedEmailsForChunk)].sort()
      };
    };

    // Run every Firestore chunk in parallel (still capped at 10 values per `in` query).
    // Phone + email waves run concurrently so latency ~= max(phones, emails), not sum.
    const [phoneRows, emailRows] = await Promise.all([
      Promise.all(phoneChunks.map((c) => runPhoneChunk(c))),
      Promise.all(emailChunks.map((c) => runEmailChunk(c)))
    ]);
    phoneRows.forEach((row) => phoneQueryChunks.push(row));
    emailRows.forEach((row) => emailQueryChunks.push(row));

    const matchedUsers = [...matchesByUser.values()].sort((a, b) => a.userId.localeCompare(b.userId));
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
        rawPhoneNumbers,
        rawEmails,
        normalizedPhoneCandidates: phoneList.sort(),
        canonicalAddressBookPhonesWritten: [...addressBookPhonesCanonical].sort(),
        normalizedEmails: emailList.sort(),
        phoneQueryChunks,
        emailQueryChunks,
        phoneMatchedUserIds: [...phoneMatchedUserIds].sort(),
        emailMatchedUserIds: [...emailMatchedUserIds].sort(),
        uniqueMatchedUserIds
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
    // Must load viewer graph from Firestore (cached) for correct filtering and referrals.
    const viewer = await this.loadViewerGraph(viewerId, { allowFirestore: true });

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
    const addHardFallback = (items: UserSuggestionSummary[]) => {
      for (const user of items) {
        if (user.userId === viewerId) continue;
        if (excludeBlocked && viewer.blocked.has(user.userId)) continue;
        const existing = out.get(user.userId);
        if (!existing || (user.score ?? 0) > (existing.score ?? 0)) out.set(user.userId, user);
      }
    };

    if (includeReferral && viewer.branchCandidateUserIds.length > 0) {
      // Hydrate a tiny number of deep-link/referral candidates; these should always be prioritized.
      const ids = viewer.branchCandidateUserIds.slice(0, 6).filter((id) => id !== viewerId);
      if (this.db && ids.length > 0) {
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
        ? this.db.getAll(
            ...viewer.contactUsers.slice(0, Math.min(Math.max(safeLimit, 4), 6)).map((id) => this.db!.collection("users").doc(id))
          )
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
          })()
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
      // Shared communities/groups: suggest other members from groups the viewer is in.
      const groupSnap = await this.db
        .collection("product_groups")
        .where("memberIds", "array-contains", viewerId)
        .limit(10)
        .get();
      incrementDbOps("queries", 1);
      incrementDbOps("reads", groupSnap.size);
      const candidateIds: string[] = [];
      const labelsByUser = new Map<string, string>();
      for (const g of groupSnap.docs) {
        const gd = g.data() as Record<string, unknown>;
        const name = typeof gd.name === "string" ? gd.name.trim() : "a group";
        const members = Array.isArray(gd.memberIds) ? gd.memberIds.filter((x): x is string => typeof x === "string") : [];
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
    }

    // Hard floor: always return at least a few real users, even if viewer follows everyone in the normal pool.
    if (this.db && out.size === 0) {
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

function extractCandidateUserIdsFromBranchData(
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
