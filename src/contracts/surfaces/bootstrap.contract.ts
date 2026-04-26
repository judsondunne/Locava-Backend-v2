import { z } from "zod";
import { defineContract } from "../conventions.js";

export const BootstrapQuerySchema = z.object({
  debugSlowDeferredMs: z.coerce.number().int().min(0).max(2000).default(0)
});

export const BootstrapResponseSchema = z.object({
  routeName: z.literal("bootstrap.init.get"),
  firstRender: z.object({
    app: z.object({
      apiVersion: z.string(),
      serverTime: z.string()
    }),
    viewer: z.object({
      id: z.string(),
      role: z.string(),
      authenticated: z.boolean()
    }),
    bootstrap: z.object({
      shellVersion: z.string(),
      unreadCount: z.number().int().nonnegative()
    })
  }),
  deferred: z.object({
    experiments: z.array(z.string())
  }),
  background: z.object({
    cacheWarmScheduled: z.boolean()
  }),
  degraded: z.boolean(),
  fallbacks: z.array(z.string())
});

export const bootstrapContract = defineContract({
  routeName: "bootstrap.init.get",
  method: "GET",
  path: "/v2/bootstrap",
  query: BootstrapQuerySchema,
  body: z.object({}).strict(),
  response: BootstrapResponseSchema
});

export type BootstrapResponse = z.infer<typeof BootstrapResponseSchema>;
