import "fastify";
import type { AppEnv } from "../config/env.js";

declare module "fastify" {
  interface FastifyInstance {
    config: AppEnv;
  }

  interface FastifyRequest {
    requestStartNs: bigint;
    requestIdValue: string;
    analyticsErrorCode?: string;
  }
}
