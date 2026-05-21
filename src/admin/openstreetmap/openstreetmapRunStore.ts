import type { OpenStreetMapClassificationResult } from "./openstreetmap.service.js";

let latestRun: OpenStreetMapClassificationResult | null = null;

export function putOpenStreetMapClassificationRun(run: OpenStreetMapClassificationResult): void {
  latestRun = run;
}

export function clearOpenStreetMapClassificationRuns(): void {
  latestRun = null;
}

export function getLatestOpenStreetMapClassificationRun(): OpenStreetMapClassificationResult | null {
  return latestRun;
}

export function getOpenStreetMapClassificationRun(runId?: string | null): OpenStreetMapClassificationResult | null {
  if (!latestRun) return null;
  if (runId && latestRun.runId !== runId) return null;
  return latestRun;
}
