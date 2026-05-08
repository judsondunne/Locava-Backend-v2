import { getFirebaseAdminAuth } from "../lib/firebase-admin.js";

export type VerifiedViewerAuth = {
  uid: string;
  claims: Record<string, unknown>;
  source: "firebase" | "test";
};

function normalizeAdminUid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .replace(/^["'`[\]{}()]+/, "")
    .replace(/["'`[\]{}()]+$/, "")
    .trim();
  return normalized || null;
}

export function parseAdminUidList(rawValue: string | undefined | null): string[] {
  const raw = (rawValue || "").trim();
  if (!raw) return [];

  if (raw.startsWith("[") && raw.endsWith("]")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return Array.from(
          new Set(
            parsed
              .map((item) => normalizeAdminUid(item))
              .filter((item): item is string => Boolean(item)),
          ),
        );
      }
    } catch {
      // Fall through to delimiter parsing.
    }
  }

  const normalizedRaw = raw.replace(/\\n/g, "\n");
  const tokens = normalizedRaw.split(/[\s,;]+/);
  return Array.from(
    new Set(
      tokens
        .map((token) => normalizeAdminUid(token))
        .filter((token): token is string => Boolean(token)),
    ),
  );
}

export function getAdminUidListFromEnv(): string[] {
  return parseAdminUidList(
    process.env.ANALYTICS_ADMIN_UIDS || process.env.ADMIN_UIDS || "",
  );
}

export function getAdminUidSetFromEnv(): Set<string> {
  return new Set(getAdminUidListFromEnv());
}

export function hasAdminAccess(input: {
  uid: string | null | undefined;
  claims?: Record<string, unknown> | null;
}): boolean {
  const uid = typeof input.uid === "string" ? input.uid.trim() : "";
  if (!uid) return false;

  const claims = input.claims ?? {};
  if (claims.admin === true) return true;
  if (typeof claims.role === "string" && claims.role.trim().toLowerCase() === "admin") {
    return true;
  }
  if (Array.isArray(claims.roles)) {
    const hasRole = claims.roles.some(
      (role) => typeof role === "string" && role.trim().toLowerCase() === "admin",
    );
    if (hasRole) return true;
  }

  return getAdminUidSetFromEnv().has(uid);
}

function parseTestAuthorizationHeader(
  authorizationHeader: string | undefined,
): VerifiedViewerAuth | null {
  if (process.env.NODE_ENV !== "test" || !authorizationHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorizationHeader.slice("Bearer ".length).trim();
  if (token.startsWith("test-admin:")) {
    const uid = token.slice("test-admin:".length).trim();
    if (!uid) return null;
    return {
      uid,
      claims: { admin: true, role: "admin", roles: ["admin"] },
      source: "test",
    };
  }
  if (token.startsWith("test-user:")) {
    const uid = token.slice("test-user:".length).trim();
    if (!uid) return null;
    return {
      uid,
      claims: {},
      source: "test",
    };
  }
  return null;
}

export async function verifyViewerAuthHeader(
  authorizationHeader: string | undefined,
): Promise<VerifiedViewerAuth | null> {
  const testAuth = parseTestAuthorizationHeader(authorizationHeader);
  if (testAuth) return testAuth;

  if (!authorizationHeader?.startsWith("Bearer ")) {
    return null;
  }
  const token = authorizationHeader.slice("Bearer ".length).trim();
  if (!token) return null;

  const decoded = (await getFirebaseAdminAuth().verifyIdToken(token, false)) as Record<
    string,
    unknown
  >;
  const uid = typeof decoded.uid === "string" ? decoded.uid.trim() : "";
  if (!uid) return null;
  return {
    uid,
    claims: decoded,
    source: "firebase",
  };
}
