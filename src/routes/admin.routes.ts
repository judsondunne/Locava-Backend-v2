import type { FastifyInstance } from "fastify";
import { renderAdminPage } from "../dashboard/admin-page.js";

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return reply.send(renderAdminPage());
  });
}
