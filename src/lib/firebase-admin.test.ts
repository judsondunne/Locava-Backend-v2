import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type MockApp = { name: string; options: Record<string, unknown> };

const adminAppState: {
  apps: MockApp[];
  initializeCalls: Array<{ options: Record<string, unknown>; name: string }>;
  listUsersCalls: number;
} = {
  apps: [],
  initializeCalls: [],
  listUsersCalls: 0
};

vi.mock("firebase-admin/app", () => {
  return {
    getApps: () => adminAppState.apps,
    initializeApp: (options: Record<string, unknown>, name?: string) => {
      const appName = name ?? "[DEFAULT]";
      const app = { name: appName, options };
      adminAppState.apps.push(app);
      adminAppState.initializeCalls.push({ options, name: appName });
      return app;
    },
    applicationDefault: () => ({ kind: "application_default" }),
    cert: (input: Record<string, unknown>) => ({ kind: "cert", ...input }),
    deleteApp: async (app: MockApp) => {
      adminAppState.apps = adminAppState.apps.filter((candidate) => candidate !== app);
    }
  };
});

vi.mock("firebase-admin/auth", () => {
  return {
    getAuth: () => ({
      async listUsers(): Promise<{ users: unknown[] }> {
        adminAppState.listUsersCalls += 1;
        return { users: [] };
      },
      async createCustomToken(uid: string): Promise<string> {
        return `token:${uid}`;
      }
    })
  };
});

vi.mock("firebase-admin/firestore", () => {
  return {
    getFirestore: () => ({ kind: "firestore" })
  };
});

function setBaseEnv(): void {
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  delete process.env.FIREBASE_PROJECT_ID;
  delete process.env.FIREBASE_CLIENT_EMAIL;
  delete process.env.FIREBASE_PRIVATE_KEY;
  delete process.env.GCP_PROJECT_ID;
}

describe("firebase-admin credential resolution", () => {
  beforeEach(async () => {
    vi.resetModules();
    adminAppState.apps = [];
    adminAppState.initializeCalls = [];
    adminAppState.listUsersCalls = 0;
    setBaseEnv();
    const mod = await import("./firebase-admin.js");
    await mod.resetFirebaseAdminForTests();
  });

  it("prefers FIREBASE_SERVICE_ACCOUNT_JSON when present", async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      project_id: "from-json",
      client_email: "json@example.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n"
    });
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/ignored.json";
    process.env.FIREBASE_PROJECT_ID = "override-project";
    process.env.FIREBASE_CLIENT_EMAIL = "env@example.iam.gserviceaccount.com";
    process.env.FIREBASE_PRIVATE_KEY = "env-key";

    const mod = await import("./firebase-admin.js");
    mod.getFirebaseAdminApp();
    const diag = mod.getFirebaseAdminDiagnostics();

    expect(diag.credentialSource).toBe("firebase_service_account_json");
    expect(diag.projectId).toBe("override-project");
    expect(diag.clientEmail).toBe("json@example.iam.gserviceaccount.com");
    expect(diag).not.toHaveProperty("privateKey");
    expect(diag).not.toHaveProperty("private_key");
    expect(adminAppState.initializeCalls).toHaveLength(1);
  });

  it("uses GOOGLE_APPLICATION_CREDENTIALS when JSON env is absent", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "locava-admin-"));
    const credentialPath = path.join(tempDir, "firebase-admin.json");
    fs.writeFileSync(
      credentialPath,
      JSON.stringify({
        type: "service_account",
        project_id: "from-file",
        client_email: "file@example.iam.gserviceaccount.com",
        private_key: "-----BEGIN PRIVATE KEY-----\\nfile\\n-----END PRIVATE KEY-----\\n"
      }),
      "utf8"
    );
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath;

    const mod = await import("./firebase-admin.js");
    mod.getFirebaseAdminApp();
    const diag = mod.getFirebaseAdminDiagnostics();
    expect(diag.credentialSource).toBe("google_application_credentials_file");
    expect(diag.projectId).toBe("from-file");
    expect(diag.clientEmail).toBe("file@example.iam.gserviceaccount.com");
  });

  it("does not initialize conflicting admin apps", async () => {
    process.env.FIREBASE_PROJECT_ID = "env-project";
    process.env.FIREBASE_CLIENT_EMAIL = "env@example.iam.gserviceaccount.com";
    process.env.FIREBASE_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nenv\\n-----END PRIVATE KEY-----\\n";
    const mod = await import("./firebase-admin.js");

    const first = mod.getFirebaseAdminApp();
    const second = mod.getFirebaseAdminApp();
    expect(first).toBe(second);
    expect(adminAppState.initializeCalls).toHaveLength(1);
  });
});
