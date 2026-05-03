/**
 * Mirror of `Locava-Native/src/profile/mergeProfilePreviewWithBootstrap.ts` for backend tests
 * and optional shared use; keep in sync when updating merge rules.
 */
export type ProfilePreviewLike = {
  userId?: string | null;
  handle?: string | null;
  name?: string | null;
  displayName?: string | null;
  profilePic?: string | null;
  photoURL?: string | null;
  avatarUrl?: string | null;
  followersCount?: number | null;
  followingCount?: number | null;
  postsCount?: number | null;
  postCount?: number | null;
};

export type ProfileBootstrapHeaderLike = {
  userId?: string | null;
  handle?: string | null;
  name?: string | null;
  profilePic?: string | null;
  photoURL?: string | null;
  avatarUrl?: string | null;
  followersCount?: number | null;
  followingCount?: number | null;
  postCount?: number | null;
  postsCount?: number | null;
};

function firstNonEmptyString(...candidates: Array<string | null | undefined>): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return null;
}

function mergeCount(
  bootstrap: number | null | undefined,
  preview: number | null | undefined
): number | undefined {
  const b =
    typeof bootstrap === "number" && Number.isFinite(bootstrap) && bootstrap >= 0 ? Math.floor(bootstrap) : undefined;
  const p =
    typeof preview === "number" && Number.isFinite(preview) && preview >= 0 ? Math.floor(preview) : undefined;
  if (b !== undefined) {
    if (p === undefined || p === 0) return b;
    return b;
  }
  return p;
}

export function mergeProfilePreviewWithBootstrap(
  preview: ProfilePreviewLike | null | undefined,
  bootstrap: ProfileBootstrapHeaderLike | null | undefined
): ProfilePreviewLike {
  const base = { ...(preview ?? {}) };
  const bs = bootstrap ?? {};
  const uid = firstNonEmptyString(bs.userId ?? undefined, base.userId ?? undefined);
  return {
    ...base,
    ...bs,
    userId: uid ?? base.userId ?? bs.userId ?? null,
    profilePic: firstNonEmptyString(
      bs.profilePic ?? undefined,
      bs.photoURL ?? undefined,
      bs.avatarUrl ?? undefined,
      base.profilePic ?? undefined,
      base.photoURL ?? undefined,
      base.avatarUrl ?? undefined
    ),
    followersCount: mergeCount(bs.followersCount ?? undefined, base.followersCount ?? undefined),
    followingCount: mergeCount(bs.followingCount ?? undefined, base.followingCount ?? undefined),
    postsCount: mergeCount(
      bs.postsCount ?? bs.postCount ?? undefined,
      base.postsCount ?? base.postCount ?? undefined
    ),
    postCount: mergeCount(
      bs.postCount ?? bs.postsCount ?? undefined,
      base.postCount ?? base.postsCount ?? undefined
    ),
  };
}
