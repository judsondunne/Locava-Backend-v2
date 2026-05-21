const PRODUCTION_PROJECT_ID = "learn-32d72";
export const INVENTORY_PRODUCTION_CONFIRMATION = "I_UNDERSTAND_THIS_WRITES_INVENTORY_TO_PRODUCTION";
export const INVENTORY_PRODUCTION_ENV_VAR = "INVENTORY_IMPORT_ALLOW_PROD_WRITE";

export type InventoryWriteGuardOptions = {
  commitTarget: "none" | "emulator" | "production";
  operation: string;
  confirmProductionWrite?: string;
  allowProductionEnvVarName?: string;
};

export type InventoryWriteGuardDetails = {
  operation: string;
  commitTarget: string;
  emulatorHostPresent: boolean;
  productionEnvVarSet: boolean;
  productionConfirmationPresent: boolean;
};

function trimEnv(name: string): string | null {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function isFirestoreEmulatorActive(): boolean {
  return Boolean(trimEnv("FIRESTORE_EMULATOR_HOST"));
}

export function isInventoryProductionWriteUnlocked(options?: {
  confirmProductionWrite?: string;
  allowProductionEnvVarName?: string;
}): boolean {
  const envVar = options?.allowProductionEnvVarName ?? INVENTORY_PRODUCTION_ENV_VAR;
  return (
    trimEnv(envVar) === "true" &&
    options?.confirmProductionWrite === INVENTORY_PRODUCTION_CONFIRMATION
  );
}

export function assertInventoryWriteAllowed(options: InventoryWriteGuardOptions): void {
  const details: InventoryWriteGuardDetails = {
    operation: options.operation,
    commitTarget: options.commitTarget,
    emulatorHostPresent: isFirestoreEmulatorActive(),
    productionEnvVarSet: trimEnv(options.allowProductionEnvVarName ?? INVENTORY_PRODUCTION_ENV_VAR) === "true",
    productionConfirmationPresent:
      options.confirmProductionWrite === INVENTORY_PRODUCTION_CONFIRMATION,
  };

  if (options.commitTarget === "none") {
    throw new InventoryWriteBlockedError(
      "INVENTORY_WRITE_BLOCKED",
      `Firestore writes are disabled for operation=${options.operation} (commitTarget=none)`,
      details
    );
  }

  if (options.commitTarget === "emulator") {
    if (!details.emulatorHostPresent) {
      throw new InventoryWriteBlockedError(
        "INVENTORY_EMULATOR_REQUIRED",
        `Emulator writes require FIRESTORE_EMULATOR_HOST for operation=${options.operation}`,
        details
      );
    }
    const gcloud = trimEnv("GCLOUD_PROJECT");
    const googleCloud = trimEnv("GOOGLE_CLOUD_PROJECT");
    if (gcloud === PRODUCTION_PROJECT_ID || googleCloud === PRODUCTION_PROJECT_ID) {
      throw new InventoryWriteBlockedError(
        "INVENTORY_PRODUCTION_PROJECT_BLOCKED",
        `Emulator writes blocked while project id is production (${PRODUCTION_PROJECT_ID})`,
        details
      );
    }
    return;
  }

  if (options.commitTarget === "production") {
    if (!isInventoryProductionWriteUnlocked(options)) {
      throw new InventoryWriteBlockedError(
        "INVENTORY_PRODUCTION_WRITE_BLOCKED",
        `Production inventory writes blocked for operation=${options.operation}. Set ${INVENTORY_PRODUCTION_ENV_VAR}=true and confirmProductionWrite=${INVENTORY_PRODUCTION_CONFIRMATION}`,
        details
      );
    }
    return;
  }

  throw new InventoryWriteBlockedError(
    "INVENTORY_INVALID_COMMIT_TARGET",
    `Unknown commitTarget=${options.commitTarget}`,
    details
  );
}

export function assertInventoryCollectionTarget(collectionName: string): void {
  const allowed = new Set(["inventoryImportRuns", "inventorySpots", "inventoryRoutes", "inventoryTiles"]);
  if (!allowed.has(collectionName)) {
    throw new Error(`INVENTORY_COLLECTION_FORBIDDEN: writes to ${collectionName} are not allowed`);
  }
  if (collectionName === "posts") {
    throw new Error("INVENTORY_POSTS_WRITE_FORBIDDEN");
  }
}

export class InventoryWriteBlockedError extends Error {
  readonly code: string;
  readonly details: InventoryWriteGuardDetails;

  constructor(code: string, message: string, details: InventoryWriteGuardDetails) {
    super(message);
    this.name = "InventoryWriteBlockedError";
    this.code = code;
    this.details = details;
  }
}
