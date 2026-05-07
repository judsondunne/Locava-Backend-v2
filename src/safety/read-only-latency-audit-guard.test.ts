import { afterEach, describe, expect, it } from "vitest";
import {
  installReadOnlyLatencyAuditGuard,
  isReadOnlyLatencyAuditEnabled,
  isReadOnlyLatencyAuditGuardActive,
} from "./read-only-latency-audit-guard.js";

class FakeDocRef {
  set(): string {
    return "set";
  }
  update(): string {
    return "update";
  }
  create(): string {
    return "create";
  }
  delete(): string {
    return "delete";
  }
}

class FakeCollectionRef {
  add(): string {
    return "add";
  }
  doc(): FakeDocRef {
    return new FakeDocRef();
  }
}

class FakeBatch {
  commit(): string {
    return "commit";
  }
}

class FakeFirestore {
  collection(): FakeCollectionRef {
    return new FakeCollectionRef();
  }
  batch(): FakeBatch {
    return new FakeBatch();
  }
  runTransaction(): Promise<string> {
    return Promise.resolve("txn");
  }
  bulkWriter(): { ok: true } {
    return { ok: true };
  }
}

afterEach(() => {
  delete process.env.READ_ONLY_LATENCY_AUDIT;
  delete process.env.FIRESTORE_EMULATOR_HOST;
});

describe("read-only latency audit guard", () => {
  it("activates only for non-emulator read-only audit runs", () => {
    expect(isReadOnlyLatencyAuditEnabled()).toBe(false);
    expect(isReadOnlyLatencyAuditGuardActive()).toBe(false);

    process.env.READ_ONLY_LATENCY_AUDIT = "1";
    expect(isReadOnlyLatencyAuditEnabled()).toBe(true);
    expect(isReadOnlyLatencyAuditGuardActive()).toBe(true);

    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
    expect(isReadOnlyLatencyAuditGuardActive()).toBe(false);
  });

  it("blocks Firestore write entrypoints once installed", async () => {
    process.env.READ_ONLY_LATENCY_AUDIT = "1";
    const db = new FakeFirestore();

    installReadOnlyLatencyAuditGuard({ db: db as never, app: {} as never });

    expect(() => db.collection().doc().set()).toThrow(/read_only_latency_audit_blocked:firestore\.doc\.set/);
    expect(() => db.collection().doc().update()).toThrow(/read_only_latency_audit_blocked:firestore\.doc\.update/);
    expect(() => db.collection().doc().create()).toThrow(/read_only_latency_audit_blocked:firestore\.doc\.create/);
    expect(() => db.collection().doc().delete()).toThrow(/read_only_latency_audit_blocked:firestore\.doc\.delete/);
    expect(() => db.collection().add()).toThrow(/read_only_latency_audit_blocked:firestore\.collection\.add/);
    expect(() => db.batch().commit()).toThrow(/read_only_latency_audit_blocked:firestore\.batch\.commit/);
    expect(() => db.runTransaction()).toThrow(/read_only_latency_audit_blocked:firestore\.runTransaction/);
    expect(() => db.bulkWriter()).toThrow(/read_only_latency_audit_blocked:firestore\.bulkWriter/);
  });
});
