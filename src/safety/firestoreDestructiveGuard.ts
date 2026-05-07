const PRODUCTION_PROJECT_ID = "learn-32d72";
const REQUIRED_EMULATOR_CONFIRMATION = "I_UNDERSTAND_THIS_ONLY_RUNS_ON_EMULATOR";
const REQUIRED_POSTS_CONFIRMATION = "I_UNDERSTAND_POSTS_WIPE_EMULATOR_ONLY";

type GuardDetails = {
  operationName: string;
  targetPath: string;
  emulatorHostPresent: boolean;
  emulatorHost: string | null;
  gcloudProject: string | null;
  googleCloudProject: string | null;
  firebaseConfigReferencesProduction: boolean;
  destructiveConfirmationPresent: boolean;
  postsConfirmationPresent: boolean;
};

function trimEnv(name: string): string | null {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function firebaseConfigReferencesProductionProject(rawConfig: string | null): boolean {
  if (!rawConfig) return false;
  return rawConfig.includes(PRODUCTION_PROJECT_ID);
}

function buildBlockedErrorMessage(details: GuardDetails, reasons: string[]): string {
  return [
    "DESTRUCTIVE_FIRESTORE_OPERATION_BLOCKED",
    `operationName=${details.operationName}`,
    `targetPath=${details.targetPath}`,
    `reasons=${reasons.join(",")}`,
    `emulatorHostPresent=${details.emulatorHostPresent}`,
    `emulatorHost=${details.emulatorHost ?? "null"}`,
    `gcloudProject=${details.gcloudProject ?? "null"}`,
    `googleCloudProject=${details.googleCloudProject ?? "null"}`,
    `firebaseConfigReferencesProduction=${details.firebaseConfigReferencesProduction}`,
    `destructiveConfirmationPresent=${details.destructiveConfirmationPresent}`,
    `postsConfirmationPresent=${details.postsConfirmationPresent}`
  ].join(" ");
}

export function assertEmulatorOnlyDestructiveFirestoreOperation(
  operationName: string,
  targetPath: string
): void {
  const emulatorHost = trimEnv("FIRESTORE_EMULATOR_HOST");
  const gcloudProject = trimEnv("GCLOUD_PROJECT");
  const googleCloudProject = trimEnv("GOOGLE_CLOUD_PROJECT");
  const firebaseConfig = trimEnv("FIREBASE_CONFIG");
  const destructiveConfirmation =
    trimEnv("ALLOW_DESTRUCTIVE_FIRESTORE_EMULATOR_ONLY") === REQUIRED_EMULATOR_CONFIRMATION;
  const postsConfirmation =
    trimEnv("ALLOW_POSTS_WIPE_IN_EMULATOR") === REQUIRED_POSTS_CONFIRMATION;
  const firebaseConfigReferencesProduction = firebaseConfigReferencesProductionProject(firebaseConfig);

  const details: GuardDetails = {
    operationName,
    targetPath,
    emulatorHostPresent: Boolean(emulatorHost),
    emulatorHost,
    gcloudProject,
    googleCloudProject,
    firebaseConfigReferencesProduction,
    destructiveConfirmationPresent: destructiveConfirmation,
    postsConfirmationPresent: postsConfirmation
  };

  const reasons: string[] = [];
  if (!emulatorHost) reasons.push("missing_firestore_emulator_host");
  if (gcloudProject === PRODUCTION_PROJECT_ID) reasons.push("gcloud_project_is_production");
  if (googleCloudProject === PRODUCTION_PROJECT_ID) reasons.push("google_cloud_project_is_production");
  if (firebaseConfigReferencesProduction) reasons.push("firebase_config_references_production");
  if (!destructiveConfirmation) reasons.push("missing_destructive_emulator_confirmation");
  if (targetPath === "posts" && !postsConfirmation) reasons.push("missing_posts_wipe_confirmation");

  if (reasons.length > 0) {
    const error = new Error(buildBlockedErrorMessage(details, reasons));
    (error as Error & { details?: GuardDetails; reasons?: string[] }).details = details;
    (error as Error & { details?: GuardDetails; reasons?: string[] }).reasons = reasons;
    throw error;
  }
}
