import type { Auth } from "firebase-admin/auth";
import { getFirebaseAdminAuth } from "../../lib/firebase-admin.js";

export function getFirebaseAuthClient(): Auth | null {
  try {
    return getFirebaseAdminAuth();
  } catch {
    return null;
  }
}
