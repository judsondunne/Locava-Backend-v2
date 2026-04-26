import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { groupsRepository } from "../../repositories/surfaces/groups.repository.js";

function toLegacyGroup(row: {
  id: string;
  name: string;
  description: string;
  coverUrl: string | null;
  memberIds: string[];
  createdAtMs: number;
}) {
  return {
    id: row.id,
    groupId: row.id,
    name: row.name,
    title: row.name,
    description: row.description,
    imageUrl: row.coverUrl ?? "",
    coverUrl: row.coverUrl ?? "",
    memberCount: row.memberIds.length,
    memberIds: row.memberIds,
    createdAtMs: row.createdAtMs
  };
}

export async function registerV2GroupsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v2/groups", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("chat", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Groups surface is not enabled for this viewer"));
    }
    const q = z.object({ limit: z.coerce.number().int().min(1).max(50).optional() }).parse(request.query ?? {});
    setRouteName("groups.list.get");
    try {
      const rows = await groupsRepository.listForViewer(viewer.viewerId, q.limit ?? 20);
      return success({
        routeName: "groups.list.get" as const,
        items: rows.map(toLegacyGroup)
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return reply.status(503).send(failure("groups_unavailable", msg));
    }
  });

  app.post("/v2/groups", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("chat", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Groups surface is not enabled for this viewer"));
    }
    const body = z
      .object({
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(500).optional(),
        coverUrl: z.string().url().optional().nullable()
      })
      .parse(request.body ?? {});
    setRouteName("groups.create.post");
    try {
      const row = await groupsRepository.create({
        viewerId: viewer.viewerId,
        name: body.name,
        description: body.description,
        coverUrl: body.coverUrl ?? null
      });
      return success({ routeName: "groups.create.post" as const, group: toLegacyGroup(row) });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return reply.status(503).send(failure("groups_unavailable", msg));
    }
  });

  app.get<{ Params: { groupId: string } }>("/v2/groups/:groupId", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("chat", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Groups surface is not enabled for this viewer"));
    }
    const groupId = z.string().min(1).parse(request.params.groupId);
    setRouteName("groups.detail.get");
    try {
      const row = await groupsRepository.getById(viewer.viewerId, groupId);
      if (!row) {
        return reply.status(404).send(failure("group_not_found", "Group was not found."));
      }
      const profiles = await groupsRepository.loadMembersProfiles(row.memberIds);
      const members = row.memberIds.map((id) => profiles.get(id) ?? { userId: id, name: id, handle: id, pic: null });
      return success({
        routeName: "groups.detail.get" as const,
        group: { ...toLegacyGroup(row), members }
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return reply.status(503).send(failure("groups_unavailable", msg));
    }
  });

  app.post<{ Params: { groupId: string } }>("/v2/groups/:groupId/join", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("chat", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Groups surface is not enabled for this viewer"));
    }
    const groupId = z.string().min(1).parse(request.params.groupId);
    setRouteName("groups.join.post");
    try {
      const row = await groupsRepository.join(viewer.viewerId, groupId);
      if (!row) {
        return reply.status(404).send(failure("group_not_found", "Group was not found."));
      }
      return success({ routeName: "groups.join.post" as const, group: toLegacyGroup(row) });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return reply.status(503).send(failure("groups_unavailable", msg));
    }
  });
}
