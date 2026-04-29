import { z } from "zod";
import { defineContract } from "../conventions.js";

export const LegendsStagePostCancelParamsSchema = z.object({
  stageId: z.string().min(8)
});

export const LegendsStagePostCancelResponseSchema = z.object({
  routeName: z.literal("legends.stagepost.cancel.delete"),
  stageId: z.string().min(8),
  cancelled: z.boolean()
});

export const legendsStagePostCancelContract = defineContract({
  routeName: "legends.stagepost.cancel.delete",
  method: "DELETE",
  path: "/v2/legends/stage-post/:stageId",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: LegendsStagePostCancelResponseSchema
});

