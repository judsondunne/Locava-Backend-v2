import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { incrementDbOps } from "../../observability/request-context.js";
import { getFirestoreSourceClient } from "../source-of-truth/firestore-client.js";
import { SourceOfTruthRequiredError } from "../source-of-truth/strict-mode.js";

export type ProductGroupRecord = {
  id: string;
  name: string;
  description: string;
  coverUrl: string | null;
  ownerId: string;
  memberIds: string[];
  createdAtMs: number;
};

const COLLECTION = "product_groups";

export class GroupsRepository {
  private readonly db = getFirestoreSourceClient();

  private ensureDb() {
    if (!this.db) throw new SourceOfTruthRequiredError("groups_firestore_unavailable");
    return this.db;
  }

  async listForViewer(viewerId: string, limit: number): Promise<ProductGroupRecord[]> {
    const db = this.ensureDb();
    const safe = Math.max(1, Math.min(50, limit));
    incrementDbOps("queries", 1);
    const snap = await db.collection(COLLECTION).where("memberIds", "array-contains", viewerId).limit(safe).get();
    incrementDbOps("reads", snap.docs.length);
    return snap.docs.map((doc) => this.mapDoc(doc.id, doc.data() as Record<string, unknown>));
  }

  async getById(viewerId: string, groupId: string): Promise<ProductGroupRecord | null> {
    const db = this.ensureDb();
    incrementDbOps("queries", 1);
    const doc = await db.collection(COLLECTION).doc(groupId).get();
    incrementDbOps("reads", 1);
    if (!doc.exists) return null;
    const data = doc.data() as Record<string, unknown>;
    const members = Array.isArray(data.memberIds) ? data.memberIds.filter((x): x is string => typeof x === "string") : [];
    if (!members.includes(viewerId)) return null;
    return this.mapDoc(doc.id, data);
  }

  async create(input: {
    viewerId: string;
    name: string;
    description?: string;
    coverUrl?: string | null;
  }): Promise<ProductGroupRecord> {
    const db = this.ensureDb();
    const now = Timestamp.now();
    const memberIds = [input.viewerId];
    const row = {
      name: input.name.trim(),
      description: String(input.description ?? "").trim(),
      coverUrl: input.coverUrl ?? null,
      ownerId: input.viewerId,
      memberIds,
      createdAt: now
    };
    incrementDbOps("writes", 1);
    const ref = await db.collection(COLLECTION).add(row);
    incrementDbOps("queries", 1);
    const created = await ref.get();
    incrementDbOps("reads", 1);
    return this.mapDoc(ref.id, (created.data() ?? row) as Record<string, unknown>);
  }

  async join(viewerId: string, groupId: string): Promise<ProductGroupRecord | null> {
    const db = this.ensureDb();
    const ref = db.collection(COLLECTION).doc(groupId);
    incrementDbOps("queries", 1);
    const snap = await ref.get();
    incrementDbOps("reads", 1);
    if (!snap.exists) return null;
    const data = snap.data() as Record<string, unknown>;
    const members = Array.isArray(data.memberIds) ? data.memberIds.filter((x): x is string => typeof x === "string") : [];
    if (members.includes(viewerId)) {
      return this.mapDoc(groupId, data);
    }
    const next = Array.from(new Set([...members, viewerId]));
    incrementDbOps("writes", 1);
    await ref.update({ memberIds: next });
    return this.mapDoc(groupId, { ...data, memberIds: next });
  }

  private mapDoc(id: string, data: Record<string, unknown>): ProductGroupRecord {
    const memberIds = Array.isArray(data.memberIds) ? data.memberIds.filter((x): x is string => typeof x === "string") : [];
    return {
      id,
      name: String(data.name ?? "Group"),
      description: String(data.description ?? ""),
      coverUrl: typeof data.coverUrl === "string" ? data.coverUrl : null,
      ownerId: String(data.ownerId ?? ""),
      memberIds,
      createdAtMs: data.createdAt && typeof (data.createdAt as { toMillis?: () => number }).toMillis === "function"
        ? (data.createdAt as { toMillis: () => number }).toMillis()
        : Date.now()
    };
  }

  async loadMembersProfiles(memberIds: string[]): Promise<Map<string, { userId: string; name: string; handle: string; pic: string | null }>> {
    const db = this.ensureDb();
    const unique = [...new Set(memberIds.filter((id) => id.length > 0))];
    const out = new Map<string, { userId: string; name: string; handle: string; pic: string | null }>();
    if (unique.length === 0) return out;
    const chunks: string[][] = [];
    for (let i = 0; i < unique.length; i += 10) chunks.push(unique.slice(i, i + 10));
    incrementDbOps("queries", chunks.length);
    const snaps = await Promise.all(
      chunks.map((chunk) => db.collection("users").where(FieldPath.documentId(), "in", chunk).get())
    );
    for (const snap of snaps) {
      incrementDbOps("reads", snap.docs.length);
      for (const doc of snap.docs) {
        const d = doc.data() as Record<string, unknown>;
        out.set(doc.id, {
          userId: doc.id,
          name: String(d.name ?? d.displayName ?? "").trim() || doc.id.slice(0, 8),
          handle: String(d.handle ?? "").replace(/^@+/, "") || `user_${doc.id.slice(0, 6)}`,
          pic: typeof d.profilePic === "string" ? d.profilePic : typeof d.photo === "string" ? d.photo : null
        });
      }
    }
    return out;
  }
}

export const groupsRepository = new GroupsRepository();
