import { CompatUserFullRepository } from "../../repositories/compat/user-full.repository.js";

export class CompatUserFullService {
  constructor(private readonly repo = new CompatUserFullRepository()) {}

  async buildUserData(input: {
    viewerId: string;
    targetUserId: string;
    profileBootstrap: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const firstRender = (input.profileBootstrap.firstRender as Record<string, unknown> | undefined) ?? {};
    const profile = (firstRender.profile as Record<string, unknown> | undefined) ?? {};
    const relationship = (firstRender.relationship as Record<string, unknown> | undefined) ?? {};
    const social = await this.repo.loadUserSocialEdges(input.targetUserId);

    return {
      name: String(profile.name ?? ""),
      handle: String(profile.handle ?? "").replace(/^@+/, ""),
      profilePic: (profile.profilePic as string | null | undefined) ?? "",
      viewerFollows: Boolean(relationship.following ?? false),
      followers: social.followers,
      following: social.following,
      followersCount: social.followersCount,
      followingCount: social.followingCount,
      lastLoginAt: social.lastLoginAt,
      relationshipUserRef: input.targetUserId,
      primaryGroup: null,
      groupMemberships: [],
    };
  }
}

