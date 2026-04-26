/**
 * Shared dev/compat viewer object shape for `/api/v1/product/*` routes on Backendv2.
 * Not persisted — replaced when Firebase/live identity is wired.
 */

export type ProductCompatViewer = {
  userId: string;
  handle: string;
  name: string;
  profilePic: string;
  onboardingComplete: boolean;
  createdAt: number | null;
  featureFlags: Record<string, boolean>;
  bio?: string;
  permissions?: Record<string, boolean>;
  settings?: Record<string, unknown>;
};

export function buildProductCompatViewer(viewerId: string): ProductCompatViewer {
  const isAnonymous = viewerId === "anonymous";
  return {
    userId: viewerId,
    handle: isAnonymous ? "guest" : "",
    name: isAnonymous ? "Guest" : "",
    profilePic: "",
    onboardingComplete: isAnonymous,
    createdAt: null,
    featureFlags: {}
  };
}
