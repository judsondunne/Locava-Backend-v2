import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import {
  GroupsAddMemberBodySchema,
  GroupsInviteMembersBodySchema,
  GroupsListQuerySchema,
  GroupsUpdateBodySchema,
  GroupsVerifyCollegeBodySchema,
  groupsAddMemberContract,
  groupsCreateContract,
  groupsDetailContract,
  groupsInviteMembersContract,
  groupsJoinContract,
  groupsListContract,
  groupsRemoveMemberContract,
  groupsShareLinkContract,
  groupsUpdateContract,
  groupsVerifyCollegeContract,
} from "../../contracts/surfaces/groups.contract.js";
import { GroupsRepository } from "../../repositories/surfaces/groups.repository.js";
import { GroupsService } from "../../services/surfaces/groups.service.js";

function failureForGroupError(error: unknown): { statusCode: number; code: string; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "missing_group") return { statusCode: 404, code: "missing_group", message: "Group not found." };
  if (message === "invalid_or_expired_group_invite") {
    return { statusCode: 410, code: "invalid_or_expired_group_invite", message: "This group invite is invalid or expired." };
  }
  if (message === "group_college_verification_required") {
    return { statusCode: 409, code: "group_college_verification_required", message: "College email verification is required before joining this group." };
  }
  if (message === "group_verification_not_required") {
    return { statusCode: 409, code: "group_verification_not_required", message: "This group does not require college verification." };
  }
  if (message === "invalid_college_email") {
    return { statusCode: 400, code: "invalid_college_email", message: "Use a valid school email for this group." };
  }
  if (message === "group_owner_required") return { statusCode: 403, code: "group_owner_required", message: "Only the group owner can do that." };
  if (message === "group_member_required") return { statusCode: 403, code: "group_member_required", message: "You are not a member of this group." };
  if (message === "viewer_already_in_group") return { statusCode: 409, code: "viewer_already_in_group", message: "Viewer already belongs to a group." };
  if (message === "malformed_branch_params") return { statusCode: 400, code: "malformed_branch_params", message: "Malformed invite parameters." };
  if (message === "branch_api_key_missing") return { statusCode: 503, code: "branch_api_key_missing", message: "Group share links are temporarily unavailable." };
  return { statusCode: 503, code: "groups_unavailable", message };
}

export async function registerV2GroupsRoutes(app: FastifyInstance): Promise<void> {
  const service = new GroupsService(new GroupsRepository());

  app.get(groupsListContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    const query = GroupsListQuerySchema.parse(request.query ?? {});
    setRouteName(groupsListContract.routeName);
    try {
      const groups = await service.list(viewer.viewerId, query.limit, query.q);
      return success({ routeName: groupsListContract.routeName, groups });
    } catch (error) {
      const meta = failureForGroupError(error);
      return reply.status(meta.statusCode).send(failure(meta.code, meta.message));
    }
  });

  app.post(groupsCreateContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    const body = groupsCreateContract.body.parse(request.body ?? {});
    setRouteName(groupsCreateContract.routeName);
    try {
      const created = await service.create({
        viewerId: viewer.viewerId,
        name: body.name,
        bio: body.bio,
        photoUrl: body.photoUrl ?? null,
        college: body.college ?? null,
      });
      return success({
        routeName: groupsCreateContract.routeName,
        success: true,
        groupId: created.groupId,
        chatId: created.chatId,
      });
    } catch (error) {
      const meta = failureForGroupError(error);
      return reply.status(meta.statusCode).send(failure(meta.code, meta.message));
    }
  });

  app.patch<{ Params: { groupId: string } }>(groupsUpdateContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    const groupId = z.string().trim().min(1).parse(request.params.groupId);
    const body = GroupsUpdateBodySchema.parse(request.body ?? {});
    setRouteName(groupsUpdateContract.routeName);
    try {
      await service.update({
        viewerId: viewer.viewerId,
        groupId,
        name: body.name,
        bio: body.bio,
        photoUrl: body.photoUrl ?? null,
        joinMode: body.joinMode,
        isPublic: body.isPublic,
        college: body.college ?? null,
      });
      return success({ routeName: groupsUpdateContract.routeName, success: true, groupId });
    } catch (error) {
      const meta = failureForGroupError(error);
      return reply.status(meta.statusCode).send(failure(meta.code, meta.message));
    }
  });

  app.get<{ Params: { groupId: string } }>(groupsDetailContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    const groupId = z.string().trim().min(1).parse(request.params.groupId);
    setRouteName(groupsDetailContract.routeName);
    try {
      const group = await service.detail(viewer.viewerId, groupId);
      if (!group) {
        return reply.status(404).send(failure("missing_group", "Group not found."));
      }
      return success({ routeName: groupsDetailContract.routeName, group });
    } catch (error) {
      const meta = failureForGroupError(error);
      return reply.status(meta.statusCode).send(failure(meta.code, meta.message));
    }
  });

  app.post<{ Params: { groupId: string } }>(groupsJoinContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    const groupId = z.string().trim().min(1).parse(request.params.groupId);
    setRouteName(groupsJoinContract.routeName);
    try {
      const joined = await service.join({ viewerId: viewer.viewerId, groupId });
      return success({ routeName: groupsJoinContract.routeName, success: true, ...joined });
    } catch (error) {
      const meta = failureForGroupError(error);
      return reply.status(meta.statusCode).send(failure(meta.code, meta.message));
    }
  });

  app.post<{ Params: { groupId: string } }>(groupsVerifyCollegeContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    const groupId = z.string().trim().min(1).parse(request.params.groupId);
    const body = GroupsVerifyCollegeBodySchema.parse(request.body ?? {});
    setRouteName(groupsVerifyCollegeContract.routeName);
    try {
      const verified = await service.verifyCollegeEmail({
        viewerId: viewer.viewerId,
        groupId,
        email: body.email,
        method: body.method,
      });
      return success({ routeName: groupsVerifyCollegeContract.routeName, success: true, ...verified });
    } catch (error) {
      const meta = failureForGroupError(error);
      return reply.status(meta.statusCode).send(failure(meta.code, meta.message));
    }
  });

  app.post<{ Params: { groupId: string } }>(groupsAddMemberContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    const groupId = z.string().trim().min(1).parse(request.params.groupId);
    const body = GroupsAddMemberBodySchema.parse(request.body ?? {});
    setRouteName(groupsAddMemberContract.routeName);
    try {
      await service.addMember({ viewerId: viewer.viewerId, groupId, memberId: body.memberId });
      return success({ routeName: groupsAddMemberContract.routeName, success: true, groupId });
    } catch (error) {
      const meta = failureForGroupError(error);
      return reply.status(meta.statusCode).send(failure(meta.code, meta.message));
    }
  });

  app.post<{ Params: { groupId: string } }>(groupsInviteMembersContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    const groupId = z.string().trim().min(1).parse(request.params.groupId);
    const body = GroupsInviteMembersBodySchema.parse(request.body ?? {});
    setRouteName(groupsInviteMembersContract.routeName);
    try {
      const result = await service.inviteMembers({ viewerId: viewer.viewerId, groupId, memberIds: body.memberIds });
      return success({ routeName: groupsInviteMembersContract.routeName, success: true, ...result });
    } catch (error) {
      const meta = failureForGroupError(error);
      return reply.status(meta.statusCode).send(failure(meta.code, meta.message));
    }
  });

  app.delete<{ Params: { groupId: string; memberId: string } }>(groupsRemoveMemberContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    const groupId = z.string().trim().min(1).parse(request.params.groupId);
    const memberId = z.string().trim().min(1).parse(request.params.memberId);
    setRouteName(groupsRemoveMemberContract.routeName);
    try {
      await service.removeMember({ viewerId: viewer.viewerId, groupId, memberId });
      return success({ routeName: groupsRemoveMemberContract.routeName, success: true, groupId });
    } catch (error) {
      const meta = failureForGroupError(error);
      return reply.status(meta.statusCode).send(failure(meta.code, meta.message));
    }
  });

  app.get<{ Params: { groupId: string } }>(groupsShareLinkContract.path, async (request, reply) => {
    const groupId = z.string().trim().min(1).parse(request.params.groupId);
    setRouteName(groupsShareLinkContract.routeName);
    try {
      const url = await service.ensureShareLink(groupId);
      return success({ routeName: groupsShareLinkContract.routeName, success: true, url });
    } catch (error) {
      const meta = failureForGroupError(error);
      return reply.status(meta.statusCode).send(failure(meta.code, meta.message));
    }
  });
}
