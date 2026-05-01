import type { ProductCompatViewer } from "./compat-viewer-payload.js";

function isGeneratedFallbackIdentity(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return false;
  return /^user_[a-z0-9]{6,}$/.test(trimmed) || trimmed === "locava user";
}

export function applyViewerPatchGuarded(
  base: ProductCompatViewer,
  patch: Record<string, unknown>,
): ProductCompatViewer {
  const next: ProductCompatViewer = { ...base };
  if (typeof patch.name === "string") {
    if (!isGeneratedFallbackIdentity(patch.name)) next.name = patch.name;
  }
  if (typeof patch.handle === "string") {
    const normalized = patch.handle.replace(/^@+/, "").trim();
    if (normalized && !isGeneratedFallbackIdentity(normalized)) next.handle = normalized;
  }
  if (typeof patch.profilePic === "string") {
    const normalizedPic = patch.profilePic.trim();
    if (normalizedPic.length > 0) next.profilePic = normalizedPic;
  }
  if (typeof patch.bio === "string") next.bio = patch.bio;
  if (patch.permissions && typeof patch.permissions === "object" && patch.permissions !== null) {
    next.permissions = {
      ...(base.permissions ?? {}),
      ...(patch.permissions as Record<string, boolean>)
    };
  }
  if (patch.settings && typeof patch.settings === "object" && patch.settings !== null) {
    next.settings = {
      ...(base.settings ?? {}),
      ...(patch.settings as Record<string, unknown>)
    };
  }
  return next;
}
