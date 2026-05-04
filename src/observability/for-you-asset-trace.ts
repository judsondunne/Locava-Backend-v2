/**
 * Opt-in tracing for For You / feed card media projection (Metro / server logs).
 *
 * Enable all cards: `FOR_YOU_ASSET_TRACE=1`
 * Enable specific posts: `FOR_YOU_ASSET_TRACE_IDS=post_a,post_b`
 */
export function shouldForYouAssetTrace(postId: string | undefined | null): boolean {
  const id = typeof postId === "string" ? postId.trim() : "";
  const envAll = process.env.FOR_YOU_ASSET_TRACE;
  if (envAll === "1" || envAll === "true" || envAll === "yes") return true;
  const raw = process.env.FOR_YOU_ASSET_TRACE_IDS;
  if (!raw || !id) return false;
  const set = new Set(
    raw
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return set.has(id);
}

export function logForYouAssetTrace(payload: Record<string, unknown>): void {
  const pid = typeof payload.postId === "string" ? payload.postId : "";
  if (!shouldForYouAssetTrace(pid)) return;
  // eslint-disable-next-line no-console
  console.log("[ForYouAssetTrace]", JSON.stringify(payload));
}

export function logForYouFullMediaRepair(payload: Record<string, unknown>): void {
  const pid = typeof payload.postId === "string" ? payload.postId : "";
  const repaired = payload.repaired === true;
  if (!repaired && !shouldForYouAssetTrace(pid) && process.env.FOR_YOU_FULL_MEDIA_REPAIR_LOG !== "1") return;
  // eslint-disable-next-line no-console
  console.log("[ForYouFullMediaRepair]", JSON.stringify(payload));
}
