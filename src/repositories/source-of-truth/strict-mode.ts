import { loadEnv } from "../../config/env.js";
import { logFirestoreDebug } from "./firestore-debug.js";

export class SourceOfTruthRequiredError extends Error {
  constructor(public readonly sourceLabel: string) {
    super(`source_of_truth_required:${sourceLabel}`);
    this.name = "SourceOfTruthRequiredError";
  }
}

export function isStrictSourceOfTruthEnabled(): boolean {
  const env = loadEnv();
  return env.SOURCE_OF_TRUTH_STRICT || env.NODE_ENV === "production";
}

export function enforceSourceOfTruthStrictness(sourceLabel: string): void {
  const strictEnabled = isStrictSourceOfTruthEnabled();
  // Some interactive surfaces should degrade (empty + fallbacks) rather than hard-503 when
  // Firestore source-of-truth is temporarily unavailable.
  const nonFatalSources = new Set([
    "search_results_firestore",
    "search_results_firestore_unavailable",
  ]);
  logFirestoreDebug("source_of_truth_strictness_check", {
    sourceLabel,
    strictEnabled
  });
  if (strictEnabled && !nonFatalSources.has(sourceLabel)) {
    logFirestoreDebug("source_of_truth_strictness_escalated", {
      sourceLabel
    });
    throw new SourceOfTruthRequiredError(sourceLabel);
  }
}
