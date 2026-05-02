import { normalizeActivityTagForSearchHome } from "../../services/surfaces/search-home-v1.activity-aliases.js";

export type CanonicalUserDocument = Record<string, unknown> & {
  uid: string;
  userId: string;
  id: string;
  handle: string;
  name: string;
  email?: string;
  activityProfile: Record<string, number>;
};

type BuildCanonicalNewUserInput = {
  uid: string;
  email?: string | null;
  name: string;
  handle: string;
  age?: number;
  explorerLevel?: string;
  selectedActivities?: unknown;
  profilePic?: string | null;
  phoneNumber?: string | null;
  relationshipRef?: string | null;
  branchData?: Record<string, unknown> | null;
  school?: string | null;
  oauthInfo?: Record<string, unknown> | null;
  nowMs?: number;
};

const DEFAULT_ACTIVITY_WEIGHT = 4;

function asNonEmptyString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function normalizeActivityProfile(input: unknown): Record<string, number> {
  if (Array.isArray(input)) {
    const fromArray: Record<string, number> = {};
    for (const raw of input) {
      const canonical = normalizeActivityTagForSearchHome(String(raw ?? ""));
      if (!canonical) continue;
      fromArray[canonical] = DEFAULT_ACTIVITY_WEIGHT;
    }
    return fromArray;
  }
  if (!input || typeof input !== "object") return {};
  const out: Record<string, number> = {};
  for (const [rawKey, rawWeight] of Object.entries(input as Record<string, unknown>)) {
    const canonical = normalizeActivityTagForSearchHome(rawKey);
    if (!canonical) continue;
    out[canonical] = numberOrDefault(rawWeight, DEFAULT_ACTIVITY_WEIGHT);
  }
  return out;
}

export function normalizeCanonicalUserDocument(rawDoc: Record<string, unknown>): CanonicalUserDocument {
  const uid = asNonEmptyString(rawDoc.uid) || asNonEmptyString(rawDoc.userId) || asNonEmptyString(rawDoc.id);
  const handle = asNonEmptyString(rawDoc.handle).replace(/^@+/, "").toLowerCase();
  const name = asNonEmptyString(rawDoc.name) || asNonEmptyString(rawDoc.displayName) || "Locava User";
  const email = asNonEmptyString(rawDoc.email).toLowerCase();
  const normalizedProfilePic =
    asNonEmptyString(rawDoc.profilePic) ||
    asNonEmptyString(rawDoc.profilePicture) ||
    asNonEmptyString(rawDoc.photoURL) ||
    asNonEmptyString(rawDoc.photo) ||
    asNonEmptyString(rawDoc.avatarUrl);
  const activityProfile = normalizeActivityProfile(rawDoc.activityProfile);
  const selectedActivities = Array.isArray(rawDoc.selectedActivities)
    ? rawDoc.selectedActivities
    : Array.isArray(rawDoc.activityProfile)
      ? rawDoc.activityProfile
      : Object.keys(activityProfile);
  const createdAt = rawDoc.createdAt ?? Date.now();
  const lastSeen = rawDoc.lastSeen ?? rawDoc.lastLoginAt ?? Date.now();

  const next: CanonicalUserDocument = {
    ...rawDoc,
    uid,
    userId: uid,
    id: uid,
    handle,
    name,
    displayName: asNonEmptyString(rawDoc.displayName) || name,
    activityProfile,
    selectedActivities,
    searchHandle: asNonEmptyString(rawDoc.searchHandle) || handle,
    searchName: asNonEmptyString(rawDoc.searchName) || name.toLowerCase(),
    profilePic: normalizedProfilePic,
    profilePicture: asNonEmptyString(rawDoc.profilePicture) || normalizedProfilePic,
    photoURL: asNonEmptyString(rawDoc.photoURL) || normalizedProfilePic,
    photo: asNonEmptyString(rawDoc.photo) || normalizedProfilePic,
    avatarUrl: asNonEmptyString(rawDoc.avatarUrl) || normalizedProfilePic,
    bio: asNonEmptyString(rawDoc.bio),
    followers: Array.isArray(rawDoc.followers) ? rawDoc.followers : [],
    following: Array.isArray(rawDoc.following) ? rawDoc.following : [],
    likedPosts: Array.isArray(rawDoc.likedPosts) ? rawDoc.likedPosts : [],
    savedPosts: Array.isArray(rawDoc.savedPosts) ? rawDoc.savedPosts : [],
    collections: Array.isArray(rawDoc.collections) ? rawDoc.collections : [],
    collectionsV2Index:
      rawDoc.collectionsV2Index && typeof rawDoc.collectionsV2Index === "object" ? rawDoc.collectionsV2Index : {},
    notifications: Array.isArray(rawDoc.notifications) ? rawDoc.notifications : [],
    blockedUsers: Array.isArray(rawDoc.blockedUsers) ? rawDoc.blockedUsers : [],
    numFollowers: numberOrDefault(rawDoc.numFollowers, numberOrDefault(rawDoc.followersCount, 0)),
    followersCount: numberOrDefault(rawDoc.followersCount, numberOrDefault(rawDoc.numFollowers, 0)),
    numFollowing: numberOrDefault(rawDoc.numFollowing, numberOrDefault(rawDoc.followingCount, 0)),
    followingCount: numberOrDefault(rawDoc.followingCount, numberOrDefault(rawDoc.numFollowing, 0)),
    numPosts: numberOrDefault(rawDoc.numPosts, numberOrDefault(rawDoc.postCount, 0)),
    postCount: numberOrDefault(rawDoc.postCount, numberOrDefault(rawDoc.numPosts, 0)),
    postsCount: numberOrDefault(rawDoc.postsCount, numberOrDefault(rawDoc.postCount, 0)),
    onboardingComplete: rawDoc.onboardingComplete !== false,
    profileComplete: rawDoc.profileComplete !== false,
    notifUnread: numberOrDefault(rawDoc.notifUnread, numberOrDefault(rawDoc.notificationUnreadCount, 0)),
    notificationUnreadCount: numberOrDefault(rawDoc.notificationUnreadCount, numberOrDefault(rawDoc.notifUnread, 0)),
    createdAt,
    lastSeen,
    lastLoginAt: rawDoc.lastLoginAt ?? lastSeen,
  };
  if (email) next.email = email;
  return next;
}

export function buildCanonicalNewUserDocument(input: BuildCanonicalNewUserInput): CanonicalUserDocument {
  const nowMs = input.nowMs ?? Date.now();
  return normalizeCanonicalUserDocument({
    uid: input.uid,
    userId: input.uid,
    id: input.uid,
    email: asNonEmptyString(input.email).toLowerCase(),
    name: input.name,
    displayName: input.name,
    handle: input.handle,
    searchName: input.name.toLowerCase(),
    searchHandle: input.handle.toLowerCase(),
    age: typeof input.age === "number" ? input.age : null,
    explorerLevel: input.explorerLevel ?? "",
    activityProfile: input.selectedActivities ?? [],
    selectedActivities: Array.isArray(input.selectedActivities) ? input.selectedActivities : [],
    profilePic: asNonEmptyString(input.profilePic),
    phoneNumber: input.phoneNumber ?? "",
    number: input.phoneNumber ?? "",
    school: input.school ?? "",
    relationshipRef: input.relationshipRef ?? null,
    branchData: input.branchData ?? null,
    oauthInfo: input.oauthInfo ?? null,
    settings: {},
    profileComplete: true,
    onboardingComplete: true,
    accountCreatedTracked: false,
    createdAt: nowMs,
    updatedAt: nowMs,
    lastSeen: nowMs,
    lastLoginAt: nowMs,
  });
}

export function validateCanonicalUserDocument(doc: Record<string, unknown>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!asNonEmptyString(doc.uid) && !asNonEmptyString(doc.userId) && !asNonEmptyString(doc.id)) {
    errors.push("missing_uid");
  }
  if (!asNonEmptyString(doc.handle)) errors.push("missing_handle");
  if (!asNonEmptyString(doc.name) && !asNonEmptyString(doc.displayName)) errors.push("missing_name");
  if (!doc.activityProfile || typeof doc.activityProfile !== "object" || Array.isArray(doc.activityProfile)) {
    errors.push("activity_profile_must_be_object");
  }
  return { valid: errors.length === 0, errors };
}
