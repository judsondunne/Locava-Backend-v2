export type SurfaceName =
  | "auth"
  | "bootstrap"
  | "profile"
  | "homeFeed"
  | "postViewer"
  | "search"
  | "notifications"
  | "chat"
  | "comments"
  | "collections"
  | "achievements"
  | "map"
  | "directory"
  | "groups"
  | "posting";

export type SurfaceCutoverConfig = {
  enabled: boolean;
  internalOnly: boolean;
};

const defaultConfig: Record<SurfaceName, SurfaceCutoverConfig> = {
  /** Signed-in clients use JWT + x-viewer-id; internal-only would block real users on /v2/auth and /v2/profiles. */
  auth: { enabled: true, internalOnly: false },
  bootstrap: { enabled: true, internalOnly: false },
  profile: { enabled: true, internalOnly: false },
  homeFeed: { enabled: true, internalOnly: true },
  postViewer: { enabled: true, internalOnly: true },
  search: { enabled: true, internalOnly: true },
  notifications: { enabled: true, internalOnly: true },
  /** Real signed-in users use JWT + x-viewer-id; inbox must not 403 in production. */
  chat: { enabled: true, internalOnly: false },
  comments: { enabled: true, internalOnly: true },
  collections: { enabled: true, internalOnly: true },
  achievements: { enabled: true, internalOnly: true },
  map: { enabled: true, internalOnly: true },
  directory: { enabled: true, internalOnly: true },
  groups: { enabled: false, internalOnly: true },
  posting: { enabled: true, internalOnly: true }
};

export function canUseV2Surface(surface: SurfaceName, viewerRoles: readonly string[]): boolean {
  const devChatOpen = process.env.NODE_ENV !== "production" && surface === "chat";
  if (devChatOpen) {
    return true;
  }
  const devDirectoryOpen = process.env.NODE_ENV !== "production" && surface === "directory";
  if (devDirectoryOpen) {
    return true;
  }
  const devAchievementsOpen = process.env.NODE_ENV !== "production" && surface === "achievements";
  if (devAchievementsOpen) {
    return true;
  }
  const config = defaultConfig[surface];
  if (!config.enabled) {
    return false;
  }

  if (!config.internalOnly) {
    return true;
  }

  return viewerRoles.includes("internal");
}

export function getCutoverConfig(): Record<SurfaceName, SurfaceCutoverConfig> {
  return { ...defaultConfig };
}
