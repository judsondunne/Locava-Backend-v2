import type { FastifyInstance } from "fastify";
import { renderAdminPage } from "../dashboard/admin-page.js";
import { renderSearchAutofillLabPage } from "../dashboard/search-autofill-lab.js";
import { renderWikiCurationLabPage } from "../dashboard/wiki-curation-lab.js";
import { renderInventoryLabPage } from "../dashboard/inventory-lab.js";
import { renderOpenStreetMapLabPage } from "../dashboard/openstreetmap-lab.js";
import { renderOpenStreetMapOffroadMasterPage } from "../dashboard/openstreetmap-offroad-master.js";
import { renderOpenStreetMapNationalImportPage } from "../dashboard/openstreetmap-national-import.js";
import { renderOpenStreetMapNationalCopierPage } from "../dashboard/openstreetmap-national-copier.js";
import { renderOpenStreetMapPbfCopierPage } from "../dashboard/openstreetmap-pbf-copier.js";
import { renderOpenStreetMapPbfCopierV2Page } from "../dashboard/openstreetmap-pbf-copier-v2.js";
import { renderOpenStreetMapVermontOffroadImportPage } from "../dashboard/openstreetmap-vermont-offroad-import.js";

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return reply.send(renderAdminPage());
  });

  app.get("/admin/wiki-curation", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return reply.send(renderWikiCurationLabPage());
  });

  app.get("/admin/search-autofill-lab", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return reply.send(renderSearchAutofillLabPage());
  });

  app.get("/admin/inventory", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return reply.send(renderInventoryLabPage());
  });

  app.get("/admin/openstreetmap", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return reply.send(renderOpenStreetMapLabPage());
  });

  app.get("/admin/openstreetmap/offroad-master", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return reply.send(renderOpenStreetMapOffroadMasterPage());
  });

  app.get("/admin/openstreetmap/offroad-master/:stateCode", async (request, reply) => {
    reply.type("text/html; charset=utf-8");
    const stateCode = (request.params as { stateCode: string }).stateCode?.toUpperCase();
    return reply.send(renderOpenStreetMapOffroadMasterPage(stateCode));
  });

  app.get("/admin/openstreetmap/national-import", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return reply.send(renderOpenStreetMapNationalImportPage());
  });

  app.get("/admin/openstreetmap/national-copier", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return reply.send(renderOpenStreetMapNationalCopierPage());
  });

  app.get("/admin/openstreetmap/pbf-copier", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return reply.send(renderOpenStreetMapPbfCopierPage());
  });

  app.get("/admin/openstreetmap/pbf-copier-v2", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return reply.send(renderOpenStreetMapPbfCopierV2Page());
  });

  app.get("/admin/openstreetmap/vermont-offroad-import", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return reply.send(renderOpenStreetMapVermontOffroadImportPage());
  });
}
