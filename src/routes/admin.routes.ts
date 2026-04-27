import type { FastifyInstance } from "fastify";
import { renderAdminPage } from "../dashboard/admin-page.js";
import { renderSearchAutofillLabPage } from "../dashboard/search-autofill-lab.js";

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return reply.send(renderAdminPage());
  });

  app.get("/admin/search-autofill-lab", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return reply.send(renderSearchAutofillLabPage());
  });
}
