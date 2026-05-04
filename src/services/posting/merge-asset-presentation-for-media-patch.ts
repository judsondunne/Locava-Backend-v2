/**
 * When merging pending media variant updates, preserve presentation metadata (letterbox, fit-width).
 */

export function mergeImageAssetPendingVariantPatch(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const prevPresentation = existing.presentation;
  const merged: Record<string, unknown> = { ...existing, ...patch };
  const patchHasPresentation = Object.prototype.hasOwnProperty.call(patch, "presentation");
  if (!patchHasPresentation && prevPresentation && typeof prevPresentation === "object") {
    merged.presentation = prevPresentation;
  } else if (
    patchHasPresentation &&
    patch.presentation &&
    typeof patch.presentation === "object" &&
    prevPresentation &&
    typeof prevPresentation === "object"
  ) {
    merged.presentation = {
      ...(prevPresentation as Record<string, unknown>),
      ...(patch.presentation as Record<string, unknown>)
    };
  }
  return merged;
}
