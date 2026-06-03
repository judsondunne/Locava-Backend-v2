const PRODUCTION_PROJECT_ID = "learn-32d72";
export const OSM_NATIONAL_PRODUCTION_CONFIRMATION =
  "I_UNDERSTAND_THIS_WILL_WRITE_NATIONAL_UNEXPLORED_SPOTS";
export const OSM_NATIONAL_PRODUCTION_ENV_VAR = "OSM_NATIONAL_IMPORT_ALLOW_PROD_WRITE";
/** Vermont off-road bulk import: production writes unlock with this password only (no env var). */
export const VERMONT_OFFROAD_PRODUCTION_PASSWORD = "Cooper";

const ALLOWED_COLLECTIONS = new Set([
  "openStreetMapNationalRuns",
  "unexploredSpots",
  "unexploredRoutes",
  "unexploredTiles",
  "unexploredRawArtifacts",
]);

export type OsmNationalWriteTarget = "none" | "emulator" | "production";

export type OsmNationalWriteGuardOptions = {
  writeTarget: OsmNationalWriteTarget;
  operation: string;
  confirmProductionWrite?: string;
  allowProductionEnvVarName?: string;
};

export type OsmNationalWriteBudget = {
  maxTotalWrites?: number;
  maxWritesPerMinute?: number;
  maxWritesPerSecond?: number;
  maxStateWrites?: number;
  maxChunkWrites?: number;
  stopOnBudgetExceeded?: boolean;
};

export type OsmNationalWriteBudgetState = {
  totalWrites: number;
  chunkWrites: number;
  stateWrites: number;
  writesThisMinute: number;
  minuteWindowStartedAt: number;
  lastWriteAt: number;
};

export type OsmNationalWriteGuardDetails = {
  operation: string;
  writeTarget: string;
  emulatorHostPresent: boolean;
  productionEnvVarSet: boolean;
  productionConfirmationPresent: boolean;
};

function trimEnv(name: string): string | null {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function isFirestoreEmulatorActiveForOsmNational(): boolean {
  return Boolean(trimEnv("FIRESTORE_EMULATOR_HOST"));
}

export function isOsmNationalProductionWriteUnlocked(options?: {
  confirmProductionWrite?: string;
  allowProductionEnvVarName?: string;
}): boolean {
  if (options?.confirmProductionWrite === VERMONT_OFFROAD_PRODUCTION_PASSWORD) {
    return true;
  }
  const envVar = options?.allowProductionEnvVarName ?? OSM_NATIONAL_PRODUCTION_ENV_VAR;
  return (
    trimEnv(envVar) === "true" &&
    options?.confirmProductionWrite === OSM_NATIONAL_PRODUCTION_CONFIRMATION
  );
}

export function assertOsmNationalWriteAllowed(options: OsmNationalWriteGuardOptions): void {
  const details: OsmNationalWriteGuardDetails = {
    operation: options.operation,
    writeTarget: options.writeTarget,
    emulatorHostPresent: isFirestoreEmulatorActiveForOsmNational(),
    productionEnvVarSet: trimEnv(options.allowProductionEnvVarName ?? OSM_NATIONAL_PRODUCTION_ENV_VAR) === "true",
    productionConfirmationPresent:
      options.confirmProductionWrite === OSM_NATIONAL_PRODUCTION_CONFIRMATION ||
      options.confirmProductionWrite === VERMONT_OFFROAD_PRODUCTION_PASSWORD,
  };

  if (options.writeTarget === "none") {
    throw new OsmNationalWriteBlockedError(
      "OSM_NATIONAL_WRITE_BLOCKED",
      `Firestore writes disabled for operation=${options.operation} (writeTarget=none)`,
      details
    );
  }

  if (options.writeTarget === "emulator") {
    if (!details.emulatorHostPresent) {
      throw new OsmNationalWriteBlockedError(
        "OSM_NATIONAL_EMULATOR_REQUIRED",
        `Emulator writes require FIRESTORE_EMULATOR_HOST for operation=${options.operation}`,
        details
      );
    }
    const gcloud = trimEnv("GCLOUD_PROJECT");
    const googleCloud = trimEnv("GOOGLE_CLOUD_PROJECT");
    if (gcloud === PRODUCTION_PROJECT_ID || googleCloud === PRODUCTION_PROJECT_ID) {
      throw new OsmNationalWriteBlockedError(
        "OSM_NATIONAL_PRODUCTION_PROJECT_BLOCKED",
        `Emulator writes blocked while project id is production (${PRODUCTION_PROJECT_ID})`,
        details
      );
    }
    return;
  }

  if (options.writeTarget === "production") {
    if (!isOsmNationalProductionWriteUnlocked(options)) {
      throw new OsmNationalWriteBlockedError(
        "OSM_NATIONAL_PRODUCTION_WRITE_BLOCKED",
        `Production OSM national writes blocked for operation=${options.operation}. Enter password ${VERMONT_OFFROAD_PRODUCTION_PASSWORD}, or set ${OSM_NATIONAL_PRODUCTION_ENV_VAR}=true with confirmProductionWrite=${OSM_NATIONAL_PRODUCTION_CONFIRMATION}`,
        details
      );
    }
    return;
  }

  throw new OsmNationalWriteBlockedError(
    "OSM_NATIONAL_INVALID_WRITE_TARGET",
    `Unknown writeTarget=${options.writeTarget}`,
    details
  );
}

export function assertOsmNationalProgressWriteAllowed(options: OsmNationalWriteGuardOptions): void {
  if (options.writeTarget === "none") {
    return;
  }
  assertOsmNationalWriteAllowed(options);
}

export function assertOsmNationalCollectionTarget(collectionName: string, options?: { progressOnly?: boolean }): void {
  if (collectionName === "posts") {
    throw new Error("OSM_NATIONAL_POSTS_WRITE_FORBIDDEN");
  }
  if (options?.progressOnly) {
    if (collectionName !== "openStreetMapNationalRuns") {
      throw new Error(`OSM_NATIONAL_PROGRESS_ONLY: ${collectionName} not allowed in progress-only mode`);
    }
    return;
  }
  if (!ALLOWED_COLLECTIONS.has(collectionName)) {
    throw new Error(`OSM_NATIONAL_COLLECTION_FORBIDDEN: writes to ${collectionName} are not allowed`);
  }
}

export function createWriteBudgetState(): OsmNationalWriteBudgetState {
  return {
    totalWrites: 0,
    chunkWrites: 0,
    stateWrites: 0,
    writesThisMinute: 0,
    minuteWindowStartedAt: Date.now(),
    lastWriteAt: 0,
  };
}

export function assertWriteBudgetAllows(
  budget: OsmNationalWriteBudget | undefined,
  state: OsmNationalWriteBudgetState,
  pendingWrites: number
): void {
  if (!budget) return;

  const now = Date.now();
  if (now - state.minuteWindowStartedAt >= 60_000) {
    state.writesThisMinute = 0;
    state.minuteWindowStartedAt = now;
  }

  const projectedTotal = state.totalWrites + pendingWrites;
  const projectedMinute = state.writesThisMinute + pendingWrites;
  const projectedChunk = state.chunkWrites + pendingWrites;
  const projectedState = state.stateWrites + pendingWrites;

  if (budget.maxTotalWrites != null && projectedTotal > budget.maxTotalWrites) {
    throw new OsmNationalBudgetExceededError("maxTotalWrites exceeded");
  }
  if (budget.maxWritesPerMinute != null && projectedMinute > budget.maxWritesPerMinute) {
    throw new OsmNationalBudgetExceededError("maxWritesPerMinute exceeded");
  }
  if (budget.maxChunkWrites != null && projectedChunk > budget.maxChunkWrites) {
    throw new OsmNationalBudgetExceededError("maxChunkWrites exceeded");
  }
  if (budget.maxStateWrites != null && projectedState > budget.maxStateWrites) {
    throw new OsmNationalBudgetExceededError("maxStateWrites exceeded");
  }
}

export function recordWriteBudgetUsage(state: OsmNationalWriteBudgetState, count: number): void {
  const now = Date.now();
  if (now - state.minuteWindowStartedAt >= 60_000) {
    state.writesThisMinute = 0;
    state.minuteWindowStartedAt = now;
  }
  state.totalWrites += count;
  state.chunkWrites += count;
  state.stateWrites += count;
  state.writesThisMinute += count;
  state.lastWriteAt = now;
}

export class OsmNationalWriteBlockedError extends Error {
  readonly code: string;
  readonly details: OsmNationalWriteGuardDetails;

  constructor(code: string, message: string, details: OsmNationalWriteGuardDetails) {
    super(message);
    this.name = "OsmNationalWriteBlockedError";
    this.code = code;
    this.details = details;
  }
}

export class OsmNationalBudgetExceededError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`OSM_NATIONAL_BUDGET_EXCEEDED: ${reason}`);
    this.name = "OsmNationalBudgetExceededError";
    this.reason = reason;
  }
}
