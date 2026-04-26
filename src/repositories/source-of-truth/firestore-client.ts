import { getApps, initializeApp, applicationDefault, cert, getApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import fs from "node:fs";
import path from "node:path";

let firestoreInstance: Firestore | null | undefined;
let initIdentity: {
  projectId: string | null;
  credentialType: "service_account_env" | "service_account_file" | "application_default" | "none";
  serviceAccountEmail: string | null;
  credentialsLoaded: boolean;
  credentialPath: string | null;
} = {
  projectId: null,
  credentialType: "none",
  serviceAccountEmail: null,
  credentialsLoaded: false,
  credentialPath: null
};

function hasServiceAccountEnv(): boolean {
  return Boolean(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY);
}

function shouldEnableFirestore(): boolean {
  if (process.env.NODE_ENV === "test") {
    return false;
  }
  if (process.env.FIRESTORE_SOURCE_ENABLED === "false") {
    return false;
  }
  return true;
}

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

function resolveCredentialPath(): string | null {
  const fromEnv = stripWrappingQuotes(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const legacyPath = path.resolve(process.cwd(), "..", "Locava Backend", ".secrets", "learn-32d72-13d7a236a08e.json");
  if (fs.existsSync(legacyPath)) return legacyPath;
  return null;
}

function initializeFirebaseAdminApp(): App {
  if (getApps().length > 0) {
    return getApp();
  }

  if (hasServiceAccountEnv()) {
    initIdentity = {
      projectId: process.env.FIREBASE_PROJECT_ID ?? process.env.GCP_PROJECT_ID ?? null,
      credentialType: "service_account_env",
      serviceAccountEmail: process.env.FIREBASE_CLIENT_EMAIL ?? null,
      credentialsLoaded: true,
      credentialPath: null
    };
    return initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n")
      }),
      projectId: process.env.FIREBASE_PROJECT_ID ?? process.env.GCP_PROJECT_ID
    });
  }

  const credentialPath = resolveCredentialPath();
  if (credentialPath) {
    const raw = fs.readFileSync(credentialPath, "utf8");
    const parsed = JSON.parse(raw) as {
      project_id?: string;
      client_email?: string;
      private_key?: string;
    };
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      throw new Error("service_account_file_invalid");
    }
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath;
    if (!process.env.GCP_PROJECT_ID) process.env.GCP_PROJECT_ID = parsed.project_id;
    if (!process.env.FIREBASE_PROJECT_ID) process.env.FIREBASE_PROJECT_ID = parsed.project_id;
    initIdentity = {
      projectId: parsed.project_id ?? null,
      credentialType: "service_account_file",
      serviceAccountEmail: parsed.client_email ?? null,
      credentialsLoaded: true,
      credentialPath
    };
    return initializeApp({
      credential: cert({
        projectId: parsed.project_id,
        clientEmail: parsed.client_email,
        privateKey: parsed.private_key
      }),
      projectId: parsed.project_id
    });
  }

  initIdentity = {
    projectId: process.env.GCP_PROJECT_ID ?? process.env.FIREBASE_PROJECT_ID ?? null,
    credentialType: "application_default",
    serviceAccountEmail: null,
    credentialsLoaded: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS),
    credentialPath: stripWrappingQuotes(process.env.GOOGLE_APPLICATION_CREDENTIALS) ?? null
  };
  return initializeApp({
    credential: applicationDefault(),
    projectId: process.env.GCP_PROJECT_ID ?? process.env.FIREBASE_PROJECT_ID
  });
}

export function getFirestoreAdminIdentity(): typeof initIdentity {
  return { ...initIdentity };
}

export function getFirestoreSourceClient(): Firestore | null {
  if (firestoreInstance !== undefined) {
    return firestoreInstance;
  }
  if (!shouldEnableFirestore()) {
    firestoreInstance = null;
    return firestoreInstance;
  }

  try {
    initializeFirebaseAdminApp();
    const db = getFirestore();
    db.settings({ ignoreUndefinedProperties: true });
    firestoreInstance = db;
    return firestoreInstance;
  } catch {
    if (initIdentity.credentialType === "none") {
      initIdentity = {
        projectId: process.env.GCP_PROJECT_ID ?? process.env.FIREBASE_PROJECT_ID ?? null,
        credentialType: "none",
        serviceAccountEmail: null,
        credentialsLoaded: false,
        credentialPath: stripWrappingQuotes(process.env.GOOGLE_APPLICATION_CREDENTIALS) ?? null
      };
    }
    firestoreInstance = null;
    return firestoreInstance;
  }
}
