import { z } from "zod";
import { defineContract } from "../conventions.js";

export const PostingClaimFinalizeBodySchema = z
  .object({
    postId: z.string().trim().min(1).max(200),
    userId: z.string().trim().min(1).max(200),
    lat: z.number().finite(),
    lng: z.number().finite(),
    candidateId: z.string().trim().min(1).max(200).optional(),
    sourceCollection: z.enum(["unexploredSpots", "unexploredRoutes"]).optional(),
    itemType: z.enum(["unexploredSpot", "unexploredRoute"]).optional(),
    activities: z.array(z.string().trim().max(80)).max(12).optional(),
    title: z.string().trim().max(200).optional()
  })
  .strict();

export const PostingClaimFinalizeResultSchema = z.object({
  routeName: z.literal("posting.claim_finalize.post"),
  captured: z.boolean(),
  isFirstCapture: z.boolean().optional(),
  sourceCollection: z.enum(["unexploredSpots", "unexploredRoutes"]).optional(),
  itemType: z.enum(["unexploredSpot", "unexploredRoute"]).optional(),
  itemId: z.string().optional(),
  title: z.string().optional(),
  emoji: z.string().nullable().optional(),
  firstActivity: z.string().nullable().optional(),
  distanceMeters: z.number().optional(),
  matchScore: z.number().optional(),
  alreadyCaptured: z.boolean().optional(),
  xpAward: z.number().optional(),
  reason: z.string().optional()
});

export const postingClaimFinalizeContract = defineContract({
  routeName: "posting.claim_finalize.post",
  method: "POST",
  path: "/v2/posting/claim-finalize",
  query: z.object({}).strict(),
  body: PostingClaimFinalizeBodySchema,
  response: PostingClaimFinalizeResultSchema
});
