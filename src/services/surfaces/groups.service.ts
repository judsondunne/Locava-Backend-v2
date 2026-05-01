import type { GroupDetailRecord, GroupDirectoryRow, GroupMembershipSummary, GroupsRepository } from "../../repositories/surfaces/groups.repository.js";

export class GroupsService {
  constructor(private readonly repository: GroupsRepository) {}

  list(viewerId: string, limit: number, query?: string): Promise<GroupDirectoryRow[]> {
    return this.repository.listForViewer(viewerId, limit, query);
  }

  detail(viewerId: string, groupId: string): Promise<GroupDetailRecord | null> {
    return this.repository.getById(viewerId, groupId);
  }

  listMemberships(userId: string): Promise<GroupMembershipSummary[]> {
    return this.repository.listMembershipsForProfile(userId);
  }

  create(input: {
    viewerId: string;
    name: string;
    bio?: string;
    photoUrl?: string | null;
    college?: { enabled: boolean; eduEmailDomain: string } | null;
  }) {
    return this.repository.create(input);
  }

  update(input: {
    viewerId: string;
    groupId: string;
    name?: string;
    bio?: string;
    photoUrl?: string | null;
    joinMode?: "open" | "private";
    isPublic?: boolean;
    college?: { enabled: boolean; eduEmailDomain: string } | null;
  }) {
    return this.repository.update(input);
  }

  join(input: { viewerId: string; groupId: string }) {
    return this.repository.join(input);
  }

  verifyCollegeEmail(input: {
    viewerId: string;
    groupId: string;
    email: string;
    method?: "email_entry" | "google";
  }) {
    return this.repository.verifyCollegeEmail(input);
  }

  addMember(input: { viewerId: string; groupId: string; memberId: string }) {
    return this.repository.addMember(input);
  }

  inviteMembers(input: { viewerId: string; groupId: string; memberIds: string[] }) {
    return this.repository.inviteMembers(input);
  }

  removeMember(input: { viewerId: string; groupId: string; memberId: string }) {
    return this.repository.removeMember(input);
  }

  ensureShareLink(groupId: string) {
    return this.repository.ensureShareLink(groupId);
  }
}
