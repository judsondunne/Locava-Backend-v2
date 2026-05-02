import { z } from "zod";
import type { FastifyRequest } from "fastify";

export const ViewerContextSchema = z.object({
  viewerId: z.string().min(1),
  roles: z.array(z.string()).default([]),
  isInternal: z.boolean().default(false),
  /** Optional client-provided identity hints (e.g. Firebase Auth user); never trusted for authorization. */
  clientProfile: z
    .object({
      email: z.string().nullable().optional(),
      handle: z.string().nullable().optional(),
      name: z.string().nullable().optional(),
      photoUrl: z.string().nullable().optional()
    })
    .optional()
});

export type ViewerContext = z.infer<typeof ViewerContextSchema>;

export function buildViewerContext(request: FastifyRequest): ViewerContext {
  const viewerId = request.headers["x-viewer-id"]?.toString() ?? "anonymous";
  const roleHeader = request.headers["x-viewer-roles"]?.toString() ?? "";
  const roles = roleHeader
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);

  const email = request.headers["x-viewer-email"]?.toString()?.trim() || null;
  const handle = request.headers["x-viewer-handle"]?.toString()?.trim() || null;
  const name = request.headers["x-viewer-name"]?.toString()?.trim() || null;
  const photoUrl = request.headers["x-viewer-photo-url"]?.toString()?.trim() || null;
  const clientProfile =
    email || handle || name || photoUrl ? { email, handle, name, photoUrl } : undefined;

  return ViewerContextSchema.parse({
    viewerId,
    roles,
    isInternal: roles.includes("internal"),
    clientProfile
  });
}
