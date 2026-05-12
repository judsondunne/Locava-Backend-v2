import { z } from "zod";

export type SeedLikesConfig = {
  allowWrites: boolean;
  allowTargetBelowMin: boolean;
  minExistingLikes: number;
  targetMin: number;
  targetMax: number;
  batchSize: number;
  maxPostsPerRun: number;
  useOldWebLikers: boolean;
  runIdPrefix: string;
};

export const SeedLikesConfigSchema = z
  .object({
    allowWrites: z.boolean().optional().default(false),
    allowTargetBelowMin: z.boolean().optional().default(false),
    minExistingLikes: z.coerce.number().int().min(0).max(10_000).optional().default(10),
    targetMin: z.coerce.number().int().min(0).max(10_000).optional().default(18),
    targetMax: z.coerce.number().int().min(0).max(10_000).optional().default(24),
    batchSize: z.coerce.number().int().min(1).max(500).optional().default(200),
    maxPostsPerRun: z.coerce.number().int().min(0).max(1_000_000).optional().default(0),
    useOldWebLikers: z.boolean().optional().default(true),
    runIdPrefix: z.string().min(1).max(120).optional().default("seed-likes")
  })
  .superRefine((value, ctx) => {
    if (value.targetMax < value.targetMin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "targetMax must be greater than or equal to targetMin",
        path: ["targetMax"]
      });
    }
  });

export function defaultSeedLikesConfig(): SeedLikesConfig {
  return SeedLikesConfigSchema.parse({});
}

export function parseSeedLikesConfig(input: unknown): SeedLikesConfig {
  return SeedLikesConfigSchema.parse(input ?? {});
}
