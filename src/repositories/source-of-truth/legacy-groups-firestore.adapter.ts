import { FieldPath } from "firebase-admin/firestore";
import { getFirestoreSourceClient } from "./firestore-client.js";

export class LegacyGroupsFirestoreAdapter {
  private readonly db = getFirestoreSourceClient();

  isAvailable(): boolean {
    return Boolean(this.db);
  }

  requireDb() {
    if (!this.db) {
      throw new Error("legacy_groups_firestore_unavailable");
    }
    return this.db;
  }

  users() {
    return this.requireDb().collection("users");
  }

  user(userId: string) {
    return this.users().doc(userId);
  }

  groups() {
    return this.requireDb().collection("groups");
  }

  group(groupId: string) {
    return this.groups().doc(groupId);
  }

  groupMembers(groupId: string) {
    return this.group(groupId).collection("members");
  }

  groupInvitations(groupId: string) {
    return this.group(groupId).collection("invitations");
  }

  groupVerifications(groupId: string) {
    return this.group(groupId).collection("verifications");
  }

  chats() {
    return this.requireDb().collection("chats");
  }

  chat(chatId: string) {
    return this.chats().doc(chatId);
  }

  cache() {
    return this.requireDb().collection("cache");
  }

  membersCollectionGroup() {
    return this.requireDb().collectionGroup("members");
  }

  usersByIdsQuery(ids: string[]) {
    return this.users().where(FieldPath.documentId(), "in", ids);
  }
}
