import { getApps, initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import fs from "node:fs";

function hasServiceAccountCredentials(): boolean {
  return Boolean(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY);
}

function buildAppName(): string {
  return "locava-backend-v2-auth";
}

type ServiceAccountFile = {
  type?: string;
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

function readServiceAccountFromGoogleApplicationCredentials(): {
  projectId: string;
  clientEmail: string;
  privateKey: string;
} | null {
  const filePath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!filePath) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as ServiceAccountFile;
    if (parsed.type !== "service_account") return null;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) return null;
    return {
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key.replace(/\\n/g, "\n")
    };
  } catch {
    return null;
  }
}

export function getFirebaseAuthClient(): Auth | null {
  try {
    const appName = buildAppName();
    let app = getApps().find((candidate) => candidate.name === appName);
    if (!app) {
      const useExplicitCreds = hasServiceAccountCredentials();
      const fileServiceAccount = !useExplicitCreds ? readServiceAccountFromGoogleApplicationCredentials() : null;
      app = initializeApp(
        useExplicitCreds
          ? {
              credential: cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n")
              }),
              projectId: process.env.FIREBASE_PROJECT_ID
            }
          : fileServiceAccount
            ? {
                credential: cert({
                  projectId: fileServiceAccount.projectId,
                  clientEmail: fileServiceAccount.clientEmail,
                  privateKey: fileServiceAccount.privateKey
                }),
                projectId: fileServiceAccount.projectId
              }
          : {
              credential: applicationDefault(),
              projectId: process.env.GCP_PROJECT_ID ?? process.env.FIREBASE_PROJECT_ID
            },
        appName
      );
    }
    return getAuth(app);
  } catch {
    return null;
  }
}
