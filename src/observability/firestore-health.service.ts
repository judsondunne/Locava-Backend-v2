import { getFirestoreAdminIdentity, getFirestoreSourceClient } from "../repositories/source-of-truth/firestore-client.js";

export type FirestoreHealthSnapshot = {
  configured: boolean;
  adminInitialized: boolean;
  connected: boolean;
  lastCheckAt: string | null;
  latencyMs: number | null;
  errorMessage: string | null;
};

const CACHE_TTL_MS = 15_000;

class FirestoreHealthService {
  private snapshot: FirestoreHealthSnapshot = {
    configured: false,
    adminInitialized: false,
    connected: false,
    lastCheckAt: null,
    latencyMs: null,
    errorMessage: null
  };
  private inFlight: Promise<FirestoreHealthSnapshot> | null = null;
  private lastCheckedAtMs = 0;

  async getSnapshot(force = false): Promise<FirestoreHealthSnapshot> {
    if (!force && this.snapshot.lastCheckAt && Date.now() - this.lastCheckedAtMs < CACHE_TTL_MS) {
      return { ...this.snapshot };
    }
    if (this.inFlight) {
      return this.inFlight;
    }
    this.inFlight = this.runProbe().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async runProbe(): Promise<FirestoreHealthSnapshot> {
    const identity = getFirestoreAdminIdentity();
    const db = getFirestoreSourceClient();
    const configured = Boolean(identity.projectId || identity.credentialsLoaded || db);
    const adminInitialized = db !== null;
    if (!db) {
      this.snapshot = {
        configured,
        adminInitialized,
        connected: false,
        lastCheckAt: new Date().toISOString(),
        latencyMs: null,
        errorMessage: "firestore_client_not_available"
      };
      this.lastCheckedAtMs = Date.now();
      return { ...this.snapshot };
    }

    const startedAt = Date.now();
    try {
      await db.doc("ops/health-dashboard-firestore-probe").get();
      this.snapshot = {
        configured,
        adminInitialized,
        connected: true,
        lastCheckAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        errorMessage: null
      };
    } catch (error) {
      this.snapshot = {
        configured,
        adminInitialized,
        connected: false,
        lastCheckAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        errorMessage: error instanceof Error ? error.message : String(error)
      };
    }
    this.lastCheckedAtMs = Date.now();
    return { ...this.snapshot };
  }
}

export const firestoreHealthService = new FirestoreHealthService();
