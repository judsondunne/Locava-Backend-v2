import { z } from "zod";
import { defineContract } from "../conventions.js";

export const LegendsPreviewCardSchema = z.object({
  type: z.enum(["possible_first_finder", "possible_first_activity_finder", "close_to_legend", "possible_new_leader"]),
  scopeId: z.string().min(3),
  title: z.string().min(1).max(120),
  subtitle: z.string().min(1).max(220)
});

export const LegendsStagePostBodySchema = z.object({
  userId: z.string().min(3),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  geohash: z.string().min(5).max(24).nullable().optional(),
  activityIds: z.array(z.string().min(1).max(128)).max(20).default([]),
  city: z.string().max(120).nullable().optional(),
  state: z.string().max(16).nullable().optional(),
  country: z.string().max(64).nullable().optional(),
  region: z.string().max(64).nullable().optional()
});

export const LegendsStagePostResponseSchema = z.object({
  routeName: z.literal("legends.stagepost.post"),
  stageId: z.string().min(8),
  derivedScopes: z.array(z.string().min(3)).max(12),
  previewCards: z.array(LegendsPreviewCardSchema).max(12)
});

export const legendsStagePostContract = defineContract({
  routeName: "legends.stagepost.post",
  method: "POST",
  path: "/v2/legends/stage-post",
  query: z.object({}).strict(),
  body: LegendsStagePostBodySchema,
  response: LegendsStagePostResponseSchema
});

export type LegendsStagePostResponse = z.infer<typeof LegendsStagePostResponseSchema>;

