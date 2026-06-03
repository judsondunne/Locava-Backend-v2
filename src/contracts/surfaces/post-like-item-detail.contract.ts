import { z } from "zod";
import { defineContract } from "../conventions.js";

export const PostLikeSourceCollectionSchema = z.enum([
  "posts",
  "unexploredSpots",
  "unexploredRoutes",
]);

export const PostLikeItemTypeSchema = z.enum([
  "post",
  "unexploredSpot",
  "unexploredRoute",
]);

export const PostLikeItemDetailSchema = z
  .object({
    id: z.string(),
    itemId: z.string(),
    sourceCollection: PostLikeSourceCollectionSchema,
    itemType: PostLikeItemTypeSchema,
  })
  .passthrough();

export const postLikeItemDetailContract = defineContract({
  routeName: "post_like.detail.get",
  method: "GET",
  path: "/v2/post-like/detail",
  query: z.object({
    sourceCollection: PostLikeSourceCollectionSchema,
    itemType: PostLikeItemTypeSchema,
    id: z.string().min(1),
  }),
  body: z.object({}).strict(),
  response: z.object({
    routeName: z.literal("post_like.detail.get"),
    item: PostLikeItemDetailSchema,
    generatedAt: z.number().int().nonnegative(),
  }),
});

export const postLikeRouteGeometryContract = defineContract({
  routeName: "post_like.route_geometry.get",
  method: "GET",
  path: "/v2/post-like/route-geometry",
  query: z.object({
    sourceCollection: PostLikeSourceCollectionSchema,
    itemType: PostLikeItemTypeSchema,
    id: z.string().min(1),
  }),
  body: z.object({}).strict(),
  response: z.object({
    routeName: z.literal("post_like.route_geometry.get"),
    route: z.record(z.unknown()),
    generatedAt: z.number().int().nonnegative(),
  }),
});
