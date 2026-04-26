export type SurfaceBudget = {
  latencyMsP50: number;
  latencyMsP95: number;
  maxReads: number;
};

export type OrchestratorMeta = {
  routeName: string;
  budget: SurfaceBudget;
  cache: {
    hits: number;
    misses: number;
  };
  timeouts: string[];
  fallbacks: string[];
};

export type OrchestratorResult<T> = {
  firstRender: T;
  deferred?: Record<string, unknown>;
  meta: OrchestratorMeta;
};
