import { getFirestoreSourceClient } from "./firestore-client.js";

export class AuthBranchAttributionFirestoreAdapter {
  private readonly db = getFirestoreSourceClient();

  isAvailable(): boolean {
    return Boolean(this.db);
  }

  requireDb() {
    if (!this.db) {
      throw new Error("auth_branch_firestore_unavailable");
    }
    return this.db;
  }

  users() {
    return this.requireDb().collection("users");
  }

  user(userId: string) {
    return this.users().doc(userId);
  }

  cohorts() {
    return this.requireDb().collection("cohorts");
  }

  cohort(cohortKey: string) {
    return this.cohorts().doc(cohortKey);
  }
}
