import { mergeSearchFieldsIntoUserWritePayload } from "../../lib/user-search-fields.js";
import { mergePhoneSearchFieldsIntoUserWritePayload } from "../../lib/phone-search-fields.js";

/**
 * Firestore `users/{userId}` write helpers.
 * Backendv2 currently relies on clients/cloud functions for most user mutations; when server-side
 * code persists `handle` / `name`, route the payload through this helper so `searchHandle` /
 * `searchName` stay in sync with indexed search queries.
 */
export function mergeUserDocumentWritePayload(fields: Record<string, unknown>): Record<string, unknown> {
  const next = { ...fields };
  const rawProfilePic = next.profilePic;
  const normalizedProfilePic = typeof rawProfilePic === "string" ? rawProfilePic.trim() : "";
  if (normalizedProfilePic.length > 0) {
    next.profilePic = normalizedProfilePic;
    // Keep legacy aliases in sync so mixed readers (old/new/native/web) resolve the same photo.
    next.profilePicture = normalizedProfilePic;
    next.photoURL = normalizedProfilePic;
    next.avatarUrl = normalizedProfilePic;
    next.photo = normalizedProfilePic;
  } else {
    delete next.profilePic;
  }
  return mergePhoneSearchFieldsIntoUserWritePayload(mergeSearchFieldsIntoUserWritePayload(next));
}
