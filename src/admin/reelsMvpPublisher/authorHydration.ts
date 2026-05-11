import type { Firestore } from "firebase-admin/firestore";
import type { NativePostUserSnapshot } from "../../services/posting/buildPostDocument.js";

function trimField(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function loadAuthorSnapshotForPosterUid(input: {
  db: Firestore;
  posterUid: string;
}): Promise<NativePostUserSnapshot | null> {
  const uid = input.posterUid.trim();
  if (!uid) return null;
  const snap = await input.db.collection("users").doc(uid).get();
  if (!snap.exists) return null;
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  const handle = trimField(data.handle).replace(/^@+/, "");
  const name =
    trimField(data.name) ||
    trimField(data.displayName) ||
    trimField(data.userName) ||
    trimField(data.username) ||
    "";
  let profilePic = "";
  for (const k of ["profilePic", "profilePicSmall", "profilePicLarge", "profilePicUrl", "profilePicture", "photo", "photoURL", "userPic"] as const) {
    const s = trimField(data[k]);
    if (s) {
      profilePic = s;
      break;
    }
  }
  if (!name && !handle && !profilePic) return null;
  return { handle: handle || uid, name: name || handle || uid, profilePic };
}
