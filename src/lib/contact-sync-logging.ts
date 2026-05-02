import { loadEnv } from "../config/env.js";

/**
 * Raw phones, emails, user ids, and match samples must never appear in production logs.
 */
export function allowContactSyncVerboseDiagnostics(): boolean {
  const env = loadEnv();
  return env.CONTACT_SYNC_VERBOSE_DIAGNOSTICS === true && env.NODE_ENV !== "production";
}

export function redactContactSyncLogPayload<T extends Record<string, unknown>>(payload: T): T {
  if (allowContactSyncVerboseDiagnostics()) return payload;
  const next = { ...payload } as Record<string, unknown>;
  for (const key of Object.keys(next)) {
    if (
      /phone|email|userId|matchedUsers|sample|addressBook|contact/i.test(key) &&
      key !== "matchedCount" &&
      key !== "totalContactsReceived"
    ) {
      delete next[key];
    }
  }
  next.redacted = true;
  return next as T;
}
