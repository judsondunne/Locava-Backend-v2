import { z } from "zod";
import { defineContract } from "../conventions.js";

export const AuthProfileBranchMergeBodySchema = z.object({
  branchData: z.record(z.unknown())
});

export const AuthProfileBranchMergeResponseSchema = z.object({
  routeName: z.literal("auth.profile_branch_merge.post"),
  success: z.boolean(),
  storage: z.enum(["firestore", "local_state_fallback"]).optional(),
  error: z.string().optional()
});

// invalidation: branch merge updates viewer profile bootstrap/session-linked onboarding metadata.
export const authProfileBranchMergeContract = defineContract({
  routeName: "auth.profile_branch_merge.post",
  method: "POST",
  path: "/v2/auth/profile/branch",
  query: z.object({}).strict(),
  body: AuthProfileBranchMergeBodySchema,
  response: AuthProfileBranchMergeResponseSchema
});
