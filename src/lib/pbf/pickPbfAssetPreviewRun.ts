import type { PbfV2FullRunRecord } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierV2FullRunTypes.js";

export function fullRunModeRank(mode: string | undefined): number {
  if (mode === "write_prod") return 0;
  if (mode === "write_test") return 1;
  return 2;
}

export function isRealFullVermontRunMode(mode: string | undefined): boolean {
  return mode === "write_test" || mode === "write_prod";
}

export function pickDefaultAssetPreviewRunId(
  runs: PbfV2FullRunRecord[],
  requestedRunId?: string | null,
  activeRunId?: string | null,
): string | null {
  if (!runs.length) return null;
  if (requestedRunId && runs.some((run) => run.runId === requestedRunId)) {
    return requestedRunId;
  }
  if (activeRunId && runs.some((run) => run.runId === activeRunId)) {
    return activeRunId;
  }

  const sorted = [...runs].sort((a, b) => {
    const modeDelta = fullRunModeRank(a.mode) - fullRunModeRank(b.mode);
    if (modeDelta !== 0) return modeDelta;
    const aRunning = a.status === "running" || a.status === "paused" ? 0 : 1;
    const bRunning = b.status === "running" || b.status === "paused" ? 0 : 1;
    if (aRunning !== bRunning) return aRunning - bRunning;
    return b.updatedAt > a.updatedAt ? 1 : -1;
  });

  const preferred = sorted.find((run) => isRealFullVermontRunMode(run.mode));
  return preferred?.runId ?? sorted[0]?.runId ?? null;
}

export function formatAssetPreviewRunLabel(run: PbfV2FullRunRecord, activeRunId?: string | null): string {
  const mode =
    run.mode === "dry_run"
      ? "dry-run"
      : run.mode === "write_prod"
        ? "write-prod"
        : run.mode === "write_test"
          ? "write-test"
          : run.mode;
  const updated = run.updatedAt?.slice(0, 19).replace("T", " ") ?? "";
  const cap = run.maxTotalSpots != null ? ` · cap ${run.maxTotalSpots}` : "";
  const active = activeRunId && run.runId === activeRunId ? " · ACTIVE" : "";
  return `${run.runId.slice(0, 18)}… · ${mode} · ${run.status}${cap}${active} · ${updated}`;
}
