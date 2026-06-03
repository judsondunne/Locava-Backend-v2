import { z } from "zod";
import { defineContract } from "../conventions.js";

export const PostingClaimCandidateQuerySchema = z.object({
  lat: z.coerce.number().finite(),
  lng: z.coerce.number().finite(),
  activities: z.string().trim().max(400).optional(),
  title: z.string().trim().max(200).optional(),
  itemTypes: z.enum(["spot", "route", "both"]).optional(),
  maxRadiusMeters: z.coerce.number().int().min(10).max(200).optional()
});

export const PostingClaimCandidateBodySchema = z
  .object({
    lat: z.number().finite(),
    lng: z.number().finite(),
    activities: z.array(z.string().trim().max(80)).max(12).optional(),
    title: z.string().trim().max(200).optional(),
    itemTypes: z.enum(["spot", "route", "both"]).optional(),
    maxRadiusMeters: z.number().int().min(10).max(200).optional()
  })
  .strict();

export const PostingClaimCandidateRowSchema = z.object({
  id: z.string(),
  sourceCollection: z.enum(["unexploredSpots", "unexploredRoutes"]),
  itemType: z.enum(["unexploredSpot", "unexploredRoute"]),
  title: z.string(),
  lat: z.number(),
  lng: z.number(),
  distanceMeters: z.number(),
  matchScore: z.number(),
  firstActivity: z.string().nullable(),
  activities: z.array(z.string()).optional(),
  emoji: z.string().nullable().optional(),
  alreadyCaptured: z.boolean().optional(),
  capturedByUserId: z.string().nullable().optional(),
  matchedBy: z
    .enum(["distance", "distance_activity", "route_segment", "name_distance", "unknown"])
    .optional()
});

export const PostingClaimCandidateResponseSchema = z.object({
  routeName: z.literal("posting.claim_candidate.get"),
  candidate: PostingClaimCandidateRowSchema.nullable()
});

export const postingClaimCandidateGetContract = defineContract({
  routeName: "posting.claim_candidate.get",
  method: "GET",
  path: "/v2/posting/claim-candidate",
  query: PostingClaimCandidateQuerySchema,
  body: z.object({}).strict(),
  response: PostingClaimCandidateResponseSchema
});

export const PostingClaimCandidatePostResponseSchema = z.object({
  routeName: z.literal("posting.claim_candidate.post"),
  candidate: PostingClaimCandidateRowSchema.nullable()
});

export const postingClaimCandidatePostContract = defineContract({
  routeName: "posting.claim_candidate.post",
  method: "POST",
  path: "/v2/posting/claim-candidate",
  query: z.object({}).strict(),
  body: PostingClaimCandidateBodySchema,
  response: PostingClaimCandidatePostResponseSchema
});
