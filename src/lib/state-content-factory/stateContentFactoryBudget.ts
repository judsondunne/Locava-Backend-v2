import type { StateContentFactoryBudgetSnapshot, StateContentFactoryRunMode } from "./types.js";

export function createStateContentFactoryBudget(input: {
  runMode: StateContentFactoryRunMode;
  maxPlacesToProcess: number;
}): StateContentFactoryBudgetSnapshot {
  const isDryRun = input.runMode === "dry_run";
  return {
    firestoreReads: 0,
    firestoreWrites: 0,
    externalRequests: 0,
    wikidataRequests: 0,
    commonsRequests: 0,
    mediaRequests: 0,
    maxFirestoreReads: isDryRun ? 25 : 500,
    maxFirestoreWrites: isDryRun ? 0 : 1000,
    maxExternalRequests: 500,
    maxPlacesProcessed: input.maxPlacesToProcess,
  };
}

export function budgetExceededReason(
  budget: StateContentFactoryBudgetSnapshot,
  placesProcessed: number,
): "READ_BUDGET_EXCEEDED" | "WRITE_BUDGET_EXCEEDED" | "EXTERNAL_REQUEST_BUDGET_EXCEEDED" | "PLACES_PROCESSED_LIMIT" | null {
  if (budget.firestoreReads > budget.maxFirestoreReads) return "READ_BUDGET_EXCEEDED";
  if (budget.maxFirestoreWrites > 0 && budget.firestoreWrites > budget.maxFirestoreWrites) return "WRITE_BUDGET_EXCEEDED";
  if (budget.externalRequests > budget.maxExternalRequests) return "EXTERNAL_REQUEST_BUDGET_EXCEEDED";
  if (placesProcessed >= budget.maxPlacesProcessed) return "PLACES_PROCESSED_LIMIT";
  return null;
}

function percentUsed(current: number, max: number): number {
  if (max <= 0) return 0;
  return Math.round((current / max) * 100);
}

export function firestoreReadBudgetWarning(budget: StateContentFactoryBudgetSnapshot): {
  shouldWarn: boolean;
  percentUsed: number;
} {
  if (budget.firestoreReads <= 0) {
    return { shouldWarn: false, percentUsed: 0 };
  }
  const pct = percentUsed(budget.firestoreReads, budget.maxFirestoreReads);
  return { shouldWarn: pct >= 75, percentUsed: pct };
}

export function firestoreWriteBudgetWarning(budget: StateContentFactoryBudgetSnapshot): {
  shouldWarn: boolean;
  percentUsed: number;
} {
  if (budget.maxFirestoreWrites <= 0 || budget.firestoreWrites <= 0) {
    return { shouldWarn: false, percentUsed: 0 };
  }
  const pct = percentUsed(budget.firestoreWrites, budget.maxFirestoreWrites);
  return { shouldWarn: pct >= 75, percentUsed: pct };
}

export function externalRequestBudgetWarning(budget: StateContentFactoryBudgetSnapshot): {
  shouldWarn: boolean;
  percentUsed: number;
} {
  if (budget.externalRequests <= 0) {
    return { shouldWarn: false, percentUsed: 0 };
  }
  const pct = percentUsed(budget.externalRequests, budget.maxExternalRequests);
  return { shouldWarn: pct >= 75, percentUsed: pct };
}
