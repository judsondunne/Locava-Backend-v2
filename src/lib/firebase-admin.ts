import fs from "node:fs";
import { getApps, initializeApp, applicationDefault, cert, deleteApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { enforceBackendV2FirebaseAccess } from "./firebase-access-enforcement.js";
import { installReadOnlyLatencyAuditGuard } from "../safety/read-only-latency-audit-guard.js";

export type FirebaseAdminCredentialSource =
  | "firebase_service_account_json"
  | "google_application_credentials_file"
  | "firebase_env_cert"
  | "application_default";

export type FirebaseAdminDiagnostics = {
  credentialSource: FirebaseAdminCredentialSource;
  projectId: string | null;
  clientEmail: string | null;
  clientEmailPresent: boolean;
  hasFirebaseServiceAccountJson: boolean;
  hasGoogleApplicationCredentials: boolean;
  hasFirebaseEnvCert: boolean;
  appName: string;
  credentialPath: string | null;
};

type ResolvedCredentials = {
  source: FirebaseAdminCredentialSource;
  projectId: string | null;
  clientEmail: string | null;
  privateKey: string | null;
  credentialPath: string | null;
};

const DEFAULT_ADMIN_APP_NAME = "locava-backend-v2-admin";

let adminApp: App | null = null;
let adminAuth: Auth | null = null;
let adminFirestore: Firestore | null = null;
let diagnostics: FirebaseAdminDiagnostics | null = null;
let initLogged = false;
let permissionProbePromise: Promise<void> | null = null;

function stripWrappingQuotes(value: string | undefined): string | undefined {
  if (!value) return value;
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseServiceAccountFromJsonEnv(rawJson: string | undefined): {
  projectId: string;
  clientEmail: string;
  privateKey: string;
} | null {
  if (!rawJson || rawJson.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(rawJson) as {
      project_id?: unknown;
      client_email?: unknown;
      private_key?: unknown;
    };
    if (
      typeof parsed.project_id !== "string" ||
      typeof parsed.client_email !== "string" ||
      typeof parsed.private_key !== "string"
    ) {
      return null;
    }
    return {
      projectId: parsed.project_id.trim(),
      clientEmail: parsed.client_email.trim(),
      privateKey: parsed.private_key.replace(/\\n/g, "\n")
    };
  } catch {
    return null;
  }
}

function parseServiceAccountFromGoogleCredentialsFile(filePathRaw: string | undefined): {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  credentialPath: string;
} | null {
  const filePath = stripWrappingQuotes(filePathRaw);
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      type?: unknown;
      project_id?: unknown;
      client_email?: unknown;
      private_key?: unknown;
    };
    if (parsed.type !== "service_account") return null;
    if (
      typeof parsed.project_id !== "string" ||
      typeof parsed.client_email !== "string" ||
      typeof parsed.private_key !== "string"
    ) {
      return null;
    }
    return {
      projectId: parsed.project_id.trim(),
      clientEmail: parsed.client_email.trim(),
      privateKey: parsed.private_key.replace(/\\n/g, "\n"),
      credentialPath: filePath
    };
  } catch {
    return null;
  }
}

export function resolveFirebaseAdminCredentials(env: NodeJS.ProcessEnv = process.env): ResolvedCredentials {
  const firebaseServiceAccountJson = env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const googleCredentialsPath = stripWrappingQuotes(env.GOOGLE_APPLICATION_CREDENTIALS);
  const hasFirebaseEnvCert = Boolean(
    env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY
  );

  const fromJsonEnv = parseServiceAccountFromJsonEnv(firebaseServiceAccountJson);
  if (fromJsonEnv) {
    return {
      source: "firebase_service_account_json",
      projectId: stripWrappingQuotes(env.FIREBASE_PROJECT_ID) ?? fromJsonEnv.projectId,
      clientEmail: fromJsonEnv.clientEmail,
      privateKey: fromJsonEnv.privateKey,
      credentialPath: null
    };
  }

  const fromFile = parseServiceAccountFromGoogleCredentialsFile(googleCredentialsPath);
  if (fromFile) {
    return {
      source: "google_application_credentials_file",
      projectId: stripWrappingQuotes(env.FIREBASE_PROJECT_ID) ?? fromFile.projectId,
      clientEmail: fromFile.clientEmail,
      privateKey: fromFile.privateKey,
      credentialPath: fromFile.credentialPath
    };
  }

  if (hasFirebaseEnvCert) {
    return {
      source: "firebase_env_cert",
      projectId: stripWrappingQuotes(env.FIREBASE_PROJECT_ID) ?? null,
      clientEmail: stripWrappingQuotes(env.FIREBASE_CLIENT_EMAIL) ?? null,
      privateKey: stripWrappingQuotes(env.FIREBASE_PRIVATE_KEY)?.replace(/\\n/g, "\n") ?? null,
      credentialPath: null
    };
  }

  return {
    source: "application_default",
    projectId: stripWrappingQuotes(env.FIREBASE_PROJECT_ID) ?? stripWrappingQuotes(env.GCP_PROJECT_ID) ?? null,
    clientEmail: null,
    privateKey: null,
    credentialPath: googleCredentialsPath ?? null
  };
}

function buildDiagnostics(input: {
  appName: string;
  resolved: ResolvedCredentials;
  env: NodeJS.ProcessEnv;
}): FirebaseAdminDiagnostics {
  return {
    credentialSource: input.resolved.source,
    projectId: input.resolved.projectId,
    clientEmail: input.resolved.clientEmail,
    clientEmailPresent: Boolean(input.resolved.clientEmail),
    hasFirebaseServiceAccountJson: Boolean(input.env.FIREBASE_SERVICE_ACCOUNT_JSON),
    hasGoogleApplicationCredentials: Boolean(stripWrappingQuotes(input.env.GOOGLE_APPLICATION_CREDENTIALS)),
    hasFirebaseEnvCert: Boolean(
      input.env.FIREBASE_PROJECT_ID && input.env.FIREBASE_CLIENT_EMAIL && input.env.FIREBASE_PRIVATE_KEY
    ),
    appName: input.appName,
    credentialPath: input.resolved.credentialPath
  };
}

function logInitOnce(diag: FirebaseAdminDiagnostics): void {
  if (initLogged) return;
  initLogged = true;
  const verbose = process.env.LOG_STARTUP_DEBUG === "1";
  if (verbose) {
    console.info({
      event: "firebase_admin_initialized",
      credentialSource: diag.credentialSource,
      projectId: diag.projectId,
      clientEmail: diag.clientEmail,
      clientEmailPresent: diag.clientEmailPresent,
      hasFirebaseServiceAccountJson: diag.hasFirebaseServiceAccountJson,
      hasGoogleApplicationCredentials: diag.hasGoogleApplicationCredentials,
      hasFirebaseEnvCert: diag.hasFirebaseEnvCert,
      appName: diag.appName
    });
    return;
  }
  console.info({
    event: "firebase_admin_initialized",
    projectId: diag.projectId,
    credentialConfigured: diag.clientEmailPresent || diag.hasGoogleApplicationCredentials || diag.hasFirebaseEnvCert,
    appName: diag.appName
  });
}

export function getFirebaseAdminApp(appName = DEFAULT_ADMIN_APP_NAME): App {
  if (adminApp) return adminApp;
  const existing = getApps().find((candidate) => candidate.name === appName);
  if (existing) {
    adminApp = existing;
    if (!diagnostics) {
      const resolved = resolveFirebaseAdminCredentials(process.env);
      diagnostics = buildDiagnostics({ appName, resolved, env: process.env });
      logInitOnce(diagnostics);
    }
    return adminApp;
  }

  const resolved = resolveFirebaseAdminCredentials(process.env);
  const appConfig =
    resolved.source === "application_default"
      ? {
          credential: applicationDefault(),
          projectId: resolved.projectId ?? undefined
        }
      : {
          credential: cert({
            projectId: resolved.projectId ?? undefined,
            clientEmail: resolved.clientEmail ?? undefined,
            privateKey: resolved.privateKey ?? undefined
          }),
          projectId: resolved.projectId ?? undefined
        };
  adminApp = initializeApp(appConfig, appName);
  diagnostics = buildDiagnostics({ appName, resolved, env: process.env });
  logInitOnce(diagnostics);
  return adminApp;
}

export function getFirebaseAdminAuth(): Auth {
  enforceBackendV2FirebaseAccess({ operationType: "auth" });
  if (adminAuth) return adminAuth;
  adminAuth = getAuth(getFirebaseAdminApp());
  return adminAuth;
}

export function getFirebaseAdminFirestore(): Firestore {
  enforceBackendV2FirebaseAccess({ operationType: "read" });
  if (adminFirestore) return adminFirestore;
  const app = getFirebaseAdminApp();
  adminFirestore = getFirestore(app);
  installReadOnlyLatencyAuditGuard({ db: adminFirestore, app });
  return adminFirestore;
}

export function getFirebaseAdminDiagnostics(): FirebaseAdminDiagnostics {
  if (!diagnostics) {
    const resolved = resolveFirebaseAdminCredentials(process.env);
    diagnostics = buildDiagnostics({ appName: DEFAULT_ADMIN_APP_NAME, resolved, env: process.env });
  }
  return { ...diagnostics };
}

export async function runFirebaseAdminPermissionProbe(): Promise<void> {
  if (permissionProbePromise) return permissionProbePromise;
  permissionProbePromise = (async () => {
    const auth = getFirebaseAdminAuth();
    try {
      await auth.listUsers(1);
      console.info({
        event: "firebase_admin_permission_probe_success",
        projectId: getFirebaseAdminDiagnostics().projectId
      });
    } catch (error) {
      const diag = getFirebaseAdminDiagnostics();
      const email = diag.clientEmail ?? "";
      if (email.includes("analytics-publisher")) {
        console.error(
          {
            event: "firebase_admin_credential_requires_fix",
            reason:
              "GOOGLE_APPLICATION_CREDENTIALS appears to reference an Analytics/BigQuery service account instead of Firebase Admin. Apple/Google sign-in mints tokens and reads Auth/Firestore — use firebase-adminsdk-*, Firebase App Hosting default SA, or a custom SA with firebaseauth.admin",
            credentialSource: diag.credentialSource,
            clientEmail: diag.clientEmail,
            credentialPathPresent: diag.hasGoogleApplicationCredentials
          },
          "Firebase Admin credential is likely incompatible with Auth/Firestore"
        );
      }
      console.error(
        `Backendv2 Firebase Admin credential cannot access project ${diag.projectId ?? "unknown"}. Set GOOGLE_APPLICATION_CREDENTIALS for local dev or configure FIREBASE_SERVICE_ACCOUNT_JSON / Cloud Run IAM for deploy.`,
        {
          event: "firebase_admin_permission_probe_failed",
          projectId: diag.projectId,
          credentialSource: diag.credentialSource,
          clientEmail: diag.clientEmail,
          message: error instanceof Error ? error.message : String(error)
        }
      );
      throw error;
    }
  })();
  return permissionProbePromise;
}

export async function resetFirebaseAdminForTests(): Promise<void> {
  adminAuth = null;
  adminFirestore = null;
  diagnostics = null;
  initLogged = false;
  permissionProbePromise = null;
  const appsToDelete = getApps().filter((app) => app.name === DEFAULT_ADMIN_APP_NAME);
  await Promise.all(appsToDelete.map((app) => deleteApp(app).catch(() => undefined)));
  adminApp = null;
}
