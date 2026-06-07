export type CostTrackerState = {
  estimatedProviderCalls: number;
  estimatedCredits: number;
  exactCostKnown: boolean;
  providerHeaders: string[];
  notes: string[];
};

export function createCostTracker(): CostTrackerState {
  return {
    estimatedProviderCalls: 0,
    estimatedCredits: 0,
    exactCostKnown: false,
    providerHeaders: [],
    notes: [
      "Exact Serper/Bing credit usage is not exposed by the Locava API. estimatedProviderCalls counts one upstream image search per place.",
      "estimatedCredits assumes 1 credit per provider call unless response headers indicate otherwise.",
    ],
  };
}

export function recordPlaceSearchCost(
  state: CostTrackerState,
  provider: "bing" | "serper" | "mock" | "none",
  resultCount: number,
  responseHeaders?: Headers,
): void {
  if (provider === "none" || provider === "mock") {
    state.notes.push(`Skipped credit charge for provider=${provider}`);
    return;
  }

  state.estimatedProviderCalls += 1;
  state.estimatedCredits += 1;

  if (responseHeaders) {
    for (const key of ["x-ratelimit-remaining", "x-credits-remaining", "x-serper-credits"]) {
      const value = responseHeaders.get(key);
      if (value) {
        state.providerHeaders.push(`${key}: ${value}`);
        state.notes.push(`Observed header ${key}=${value} (exact cost still unknown unless provider documents it).`);
      }
    }
  }

  state.notes.push(
    `Recorded 1 estimated ${provider} call (${resultCount} images returned).`,
  );
}

export function wouldExceedBudget(state: CostTrackerState, maxCredits: number): boolean {
  return state.estimatedCredits > maxCredits;
}

export function formatCostSummary(state: CostTrackerState): string {
  const exact = state.exactCostKnown
    ? String(state.estimatedCredits)
    : `${state.estimatedCredits} (estimated; exact cost unknown)`;
  return `providerCalls=${state.estimatedProviderCalls} credits=${exact}`;
}
