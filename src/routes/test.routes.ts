import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { success } from "../lib/response.js";
import { TestService } from "../services/test.service.js";

const EchoBodySchema = z.object({
  message: z.string().min(1),
  payload: z.unknown().optional()
});

const SlowQuerySchema = z.object({
  ms: z.coerce.number().int().min(0).max(10000).default(1000)
});

const DbSimulateSchema = z.object({
  reads: z.coerce.number().int().min(0).max(1000).default(1),
  writes: z.coerce.number().int().min(0).max(1000).default(0)
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function registerTestRoutes(app: FastifyInstance): Promise<void> {
  const testService = new TestService();

  app.get("/test/ping", async () => success({ pong: true, now: new Date().toISOString() }));

  app.post("/test/echo", async (request) => {
    const body = EchoBodySchema.parse(request.body);
    return success({ echo: body });
  });

  app.get("/test/error", async () => {
    throw new Error("Intentional test error");
  });

  app.get("/test/slow", async (request) => {
    const query = SlowQuerySchema.parse(request.query);
    await delay(query.ms);
    return success({ delayedMs: query.ms });
  });

  app.get("/test/db-simulate", async (request) => {
    const query = DbSimulateSchema.parse(request.query);
    const result = await testService.simulateDb(query.reads, query.writes);
    return success({
      message: "Database simulation complete",
      result
    });
  });
}
