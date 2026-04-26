import { getFirestoreAdminIdentity } from "./firestore-client.js";

function isVerboseEnabled(): boolean {
  const raw = process.env.FIRESTORE_DEBUG_VERBOSE;
  if (!raw) return false;
  return raw === "1" || raw.toLowerCase() === "true";
}

export function logFirestoreDebug(event: string, details: Record<string, unknown>): void {
  if (!isVerboseEnabled()) return;
  const identity = getFirestoreAdminIdentity();
  const payload = {
    event,
    projectId: identity.projectId,
    clientEmail: identity.serviceAccountEmail,
    credentialType: identity.credentialType,
    ...details
  };
  console.info("[FIRESTORE_DEBUG_VERBOSE]", JSON.stringify(payload));
}

