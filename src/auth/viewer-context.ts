import { z } from "zod";
import type { FastifyRequest } from "fastify";

export const ViewerContextSchema = z.object({
  viewerId: z.string().min(1),
  roles: z.array(z.string()).default([]),
  isInternal: z.boolean().default(false)
});

export type ViewerContext = z.infer<typeof ViewerContextSchema>;

export function buildViewerContext(request: FastifyRequest): ViewerContext {
  const viewerId = request.headers["x-viewer-id"]?.toString() ?? "anonymous";
  const roleHeader = request.headers["x-viewer-roles"]?.toString() ?? "";
  const roles = roleHeader
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);

  return ViewerContextSchema.parse({
    viewerId,
    roles,
    isInternal: roles.includes("internal")
  });
}
