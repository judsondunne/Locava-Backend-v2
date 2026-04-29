import { z } from "zod";
import { defineContract } from "../conventions.js";
import { LegendAwardWireSchema } from "./legends-me-bootstrap.contract.js";

export const LegendsAfterPostParamsSchema = z.object({
  postId: z.string().min(3)
});

export const LegendsAfterPostResponseSchema = z.object({
  routeName: z.literal("legends.afterpost.get"),
  postId: z.string(),
  status: z.enum(["processing", "complete", "failed"]),
  pollAfterMs: z.number().int().nonnegative(),
  awards: z.array(LegendAwardWireSchema).max(40)
});

export const legendsAfterPostContract = defineContract({
  routeName: "legends.afterpost.get",
  method: "GET",
  path: "/v2/legends/after-post/:postId",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: LegendsAfterPostResponseSchema
});

