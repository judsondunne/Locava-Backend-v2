import { AsyncLocalStorage } from "node:async_hooks";
import type { AllowCategory } from "@locava/contracts/firebase-access-policy";

export type FirebaseAccessGate = {
  allowCategory: AllowCategory;
  legacy: boolean;
  surface: string;
};

const storage = new AsyncLocalStorage<FirebaseAccessGate | undefined>();

export function runWithFirebaseAccessGate<T>(gate: FirebaseAccessGate, fn: () => T): T {
  return storage.run(gate, fn);
}

export function getFirebaseAccessGateFromBackground(): FirebaseAccessGate | undefined {
  return storage.getStore();
}
