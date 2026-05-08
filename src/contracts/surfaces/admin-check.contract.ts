import { z } from "zod";
import { defineContract } from "../conventions.js";

export const adminCheckResponseSchema = z.object({
  routeName: z.literal("admin.check.get"),
  isAdmin: z.boolean(),
  viewerId: z.string(),
});

export const adminCheckContract = defineContract({
  routeName: "admin.check.get",
  method: "GET",
  path: "/v2/admin/check",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: adminCheckResponseSchema,
});
