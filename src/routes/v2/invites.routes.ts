import type { FastifyInstance } from "fastify";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { invitesResolveContract } from "../../contracts/surfaces/invites.contract.js";
import { InvitesService } from "../../services/surfaces/invites.service.js";

function failureForInviteError(error: unknown): { statusCode: number; code: string; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "malformed_branch_params") {
    return { statusCode: 400, code: "malformed_branch_params", message: "Malformed invite parameters." };
  }
  if (message === "invalid_or_expired_group_invite") {
    return { statusCode: 410, code: "invalid_or_expired_group_invite", message: "This group invite is invalid or expired." };
  }
  return { statusCode: 503, code: "invite_resolve_failed", message };
}

export async function registerV2InvitesRoutes(app: FastifyInstance): Promise<void> {
  const service = new InvitesService();

  app.post(invitesResolveContract.path, async (request, reply) => {
    const body = invitesResolveContract.body.parse(request.body ?? {});
    setRouteName(invitesResolveContract.routeName);
    try {
      const resolved = await service.resolve(body.branchData);
      return success({
        routeName: invitesResolveContract.routeName,
        inviteType: resolved.inviteType,
        inviteToken: resolved.inviteToken,
        inviter: resolved.inviter,
        group: resolved.group,
      });
    } catch (error) {
      const meta = failureForInviteError(error);
      return reply.status(meta.statusCode).send(failure(meta.code, meta.message));
    }
  });
}
