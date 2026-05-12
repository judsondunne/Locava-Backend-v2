import type { Firestore } from "firebase-admin/firestore";
import {
  LIKE_BOOSTER_SETTINGS_COLLECTION,
  LIKE_BOOSTER_SETTINGS_DOC_ID,
  OLD_WEB_SEED_LIKER_IDS
} from "./oldWebSeedLikers.constants.js";

export type SeedLikerProfile = {
  userId: string;
  userHandle: string | null;
  userName: string | null;
  userPic: string | null;
};

export type SeedLikerPoolResolution = {
  ids: string[];
  source: "firestore" | "snapshot" | "disabled";
  firestoreCount: number;
  snapshotCount: number;
};

function uniqueIds(ids: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = String(raw ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function oldWebSeedLikerIdsFallback(): string[] {
  return uniqueIds(OLD_WEB_SEED_LIKER_IDS);
}

export async function resolveSeedLikerPool(
  db: Firestore | null,
  useOldWebLikers: boolean
): Promise<SeedLikerPoolResolution> {
  const snapshotCount = oldWebSeedLikerIdsFallback().length;
  if (!useOldWebLikers) {
    return { ids: [], source: "disabled", firestoreCount: 0, snapshotCount };
  }
  if (!db) {
    return {
      ids: oldWebSeedLikerIdsFallback(),
      source: "snapshot",
      firestoreCount: 0,
      snapshotCount
    };
  }

  try {
    const snap = await db.collection(LIKE_BOOSTER_SETTINGS_COLLECTION).doc(LIKE_BOOSTER_SETTINGS_DOC_ID).get();
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    const fromDoc = Array.isArray(data.likers) ? data.likers.filter((v): v is string => typeof v === "string") : [];
    const ids = uniqueIds(fromDoc);
    if (ids.length > 0) {
      return { ids, source: "firestore", firestoreCount: ids.length, snapshotCount };
    }
  } catch {
    // Fall through to snapshot.
  }

  return {
    ids: oldWebSeedLikerIdsFallback(),
    source: "snapshot",
    firestoreCount: 0,
    snapshotCount
  };
}

export async function loadOldWebSeedLikerIds(db: Firestore | null, useOldWebLikers: boolean): Promise<string[]> {
  const pool = await resolveSeedLikerPool(db, useOldWebLikers);
  return pool.ids;
}

function readProfileField(data: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export async function hydrateSeedLikerProfiles(
  db: Firestore | null,
  userIds: string[]
): Promise<Map<string, SeedLikerProfile>> {
  const map = new Map<string, SeedLikerProfile>();
  const fallbackProfile: SeedLikerProfile = {
    userId: "",
    userHandle: null,
    userName: "Unknown User",
    userPic: "https://via.placeholder.com/150"
  };
  if (!db) {
    for (const userId of userIds) {
      map.set(userId, { ...fallbackProfile, userId });
    }
    return map;
  }

  const chunks: string[][] = [];
  for (let i = 0; i < userIds.length; i += 100) {
    chunks.push(userIds.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    const refs = chunk.map((userId) => db.collection("users").doc(userId));
    const snaps = await db.getAll(...refs);
    for (let i = 0; i < chunk.length; i += 1) {
      const userId = chunk[i]!;
      const snap = snaps[i];
      if (!snap?.exists) {
        map.set(userId, { ...fallbackProfile, userId });
        continue;
      }
      const data = (snap.data() ?? {}) as Record<string, unknown>;
      map.set(userId, {
        userId,
        userHandle: readProfileField(data, ["handle", "userHandle", "username"]),
        userName: readProfileField(data, ["name", "displayName", "userName"]),
        userPic: readProfileField(data, ["pic", "profilePic", "profilePicture", "photo", "photoURL", "userPic"])
      });
    }
  }

  return map;
}
