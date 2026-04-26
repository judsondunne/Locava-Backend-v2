const LOCAL_DEV_FALLBACK_VIEWER_ID = "aXngoh9jeqW35FNM3fq1w9aXdEh1";

function isNonEmpty(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isLocalDevRuntime(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv !== "production";
}

export function isLocalDevIdentityModeEnabled(): boolean {
  return isLocalDevRuntime() && process.env.ENABLE_LOCAL_DEV_IDENTITY === "1";
}

export function resolveLocalDebugViewerId(explicitViewerId?: string | null): string {
  if (isNonEmpty(explicitViewerId)) return explicitViewerId.trim();
  if (isNonEmpty(process.env.DEBUG_VIEWER_ID)) return process.env.DEBUG_VIEWER_ID.trim();
  if (isLocalDevRuntime()) return LOCAL_DEV_FALLBACK_VIEWER_ID;
  throw new Error("local_debug_viewer_id_missing");
}

export function resolveLocalDevIdentityContext(explicitViewerId?: string | null): {
  viewerId: string;
  localDevIdentityModeEnabled: boolean;
  usedDefaultViewerId: boolean;
} {
  const modeEnabled = isLocalDevIdentityModeEnabled();
  const viewerId = resolveLocalDebugViewerId(explicitViewerId);
  const usedDefaultViewerId = !isNonEmpty(explicitViewerId);
  return {
    viewerId,
    localDevIdentityModeEnabled: modeEnabled,
    usedDefaultViewerId
  };
}
