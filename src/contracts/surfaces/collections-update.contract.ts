import { z } from "zod";
import { defineContract } from "../conventions.js";

const CollectionPrivacySchema = z.enum(["private", "friends", "public"]);

export const CollectionsUpdateBodySchema = z
  .object({
    collectionId: z.string().trim().min(1),
    updates: z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
        description: z.string().trim().max(500).optional(),
        privacy: CollectionPrivacySchema.optional()
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0, {
        message: "updates must include at least one field"
      })
  })
  .strict();

export const CollectionsUpdateResponseSchema = z.object({
  routeName: z.literal("collections.update.post"),
  collectionId: z.string().min(1),
  updatedFields: z.array(z.enum(["name", "description", "privacy"])),
  updatedCollection: z.object({
    id: z.string().min(1),
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    privacy: CollectionPrivacySchema.optional()
  })
});

export const collectionsUpdateContract = defineContract({
  routeName: "collections.update.post",
  method: "POST",
  path: "/v2/collections/update",
  query: z.object({}).strict(),
  body: CollectionsUpdateBodySchema,
  response: CollectionsUpdateResponseSchema
});
