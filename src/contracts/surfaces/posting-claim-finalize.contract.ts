import { z } from "zod";
import { defineContract } from "../conventions.js";

export const CLAIM_FINALIZE_SCHEMA_VERSION = "2026-06-04-route-passthrough-v1";

const nullableString = z.union([z.string(), z.null()]).optional();
const nullableNumber = z.union([z.number().finite(), z.null()]).optional();
const nullableBoolean = z.union([z.boolean(), z.null()]).optional();

function resolveCoordinate(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function optionalTrimmedString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const PostingClaimFinalizeBodyCoreSchema = z
  .object({
    postId: z.string().trim().min(1).max(200),
    userId: z.string().trim().min(1).max(200).optional(),
    lat: z.number().finite().optional(),
    lng: z.number().finite().optional(),
    candidateId: nullableString,
    sourceCollection: z.enum(["unexploredSpots", "unexploredRoutes"]).optional(),
    itemType: z.enum(["unexploredSpot", "unexploredRoute"]).optional(),
    activities: z.array(z.string().trim().max(80)).max(12).optional(),
    title: z.string().trim().max(200).optional(),
    enforcePostDistanceCheck: nullableBoolean,
    undiscoveredSpotId: nullableString,
    undiscoveredRouteId: nullableString,
    unexploredRouteId: nullableString,
    unexploredSpotId: nullableString,
    candidateItemType: z
      .union([z.enum(["unexploredSpot", "unexploredRoute"]), z.string(), z.null()])
      .optional(),
    requestLat: nullableNumber,
    requestLng: nullableNumber,
    uploadLat: nullableNumber,
    uploadLng: nullableNumber,
    finalizeLat: nullableNumber,
    finalizeLng: nullableNumber
  })
  .passthrough();

export const PostingClaimFinalizeBodySchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const row = raw as Record<string, unknown>;
  const lat = resolveCoordinate(
    row.lat,
    row.requestLat,
    row.finalizeLat,
    row.uploadLat
  );
  const lng = resolveCoordinate(
    row.lng,
    row.requestLng,
    row.finalizeLng,
    row.uploadLng
  );
  return {
    ...row,
    ...(lat != null ? { lat } : {}),
    ...(lng != null ? { lng } : {})
  };
}, PostingClaimFinalizeBodyCoreSchema.superRefine((body, ctx) => {
  if (body.lat == null || body.lng == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "lat/lng (or requestLat/requestLng / finalizeLat/finalizeLng / uploadLat/uploadLng) required",
      path: ["lat"]
    });
  }
}));

export type ParsedClaimFinalizeBody = z.infer<typeof PostingClaimFinalizeBodySchema>;

export type NormalizedClaimFinalizeBody = ParsedClaimFinalizeBody & {
  userId: string;
  lat: number;
  lng: number;
  isRouteClaim: boolean;
  isSpotClaim: boolean;
  routeId?: string;
  spotId?: string;
  candidateItemType?: string;
};

export function normalizeClaimFinalizeBody(
  body: ParsedClaimFinalizeBody,
  fallbackUserId: string
): NormalizedClaimFinalizeBody {
  const rawCandidateId =
    optionalTrimmedString(body.unexploredRouteId) ||
    optionalTrimmedString(body.undiscoveredRouteId) ||
    optionalTrimmedString(body.candidateId) ||
    optionalTrimmedString(body.unexploredSpotId) ||
    optionalTrimmedString(body.undiscoveredSpotId);

  const isRouteClaim =
    body.candidateItemType === "unexploredRoute" ||
    String(rawCandidateId || "").startsWith("unx_route_");

  const isSpotClaim =
    body.candidateItemType === "unexploredSpot" ||
    String(rawCandidateId || "").startsWith("unx_spot_") ||
    (!isRouteClaim && Boolean(optionalTrimmedString(body.undiscoveredSpotId)));

  const routeId = isRouteClaim
    ? optionalTrimmedString(body.unexploredRouteId) ||
      optionalTrimmedString(body.undiscoveredRouteId) ||
      optionalTrimmedString(body.candidateId) ||
      optionalTrimmedString(body.undiscoveredSpotId)
    : undefined;

  const spotId = isSpotClaim
    ? optionalTrimmedString(body.unexploredSpotId) ||
      optionalTrimmedString(body.undiscoveredSpotId) ||
      optionalTrimmedString(body.candidateId)
    : undefined;

  return {
    ...body,
    userId: optionalTrimmedString(body.userId) ?? fallbackUserId,
    lat: body.lat as number,
    lng: body.lng as number,
    isRouteClaim,
    isSpotClaim,
    routeId,
    spotId,
    candidateId: isRouteClaim ? routeId : isSpotClaim ? spotId : optionalTrimmedString(body.candidateId),
    candidateItemType:
      typeof body.candidateItemType === "string" ? body.candidateItemType : undefined,
    itemType: isRouteClaim
      ? "unexploredRoute"
      : isSpotClaim
        ? "unexploredSpot"
        : body.itemType,
    sourceCollection: isRouteClaim
      ? "unexploredRoutes"
      : isSpotClaim
        ? "unexploredSpots"
        : body.sourceCollection
  };
}

export function logClaimFinalizeSchemaVersion(): void {
  console.info(
    `[claim-finalize.schema.version] supportsRouteClaimFields=true passthrough=true version=${CLAIM_FINALIZE_SCHEMA_VERSION}`,
  );
}

export const PostingClaimFinalizeCaptureSummarySchema = z.object({
  status: z.string(),
  sourceCollection: z.enum(["unexploredSpots", "unexploredRoutes"]),
  itemType: z.enum(["unexploredSpot", "unexploredRoute"]),
  itemId: z.string(),
  title: z.string().optional(),
  emoji: z.string().nullable().optional(),
  distanceMeters: z.number().optional(),
  matchScore: z.number().optional(),
  isFirstCapture: z.boolean().optional()
});

export const PostingClaimFinalizeResultSchema = z.object({
  routeName: z.literal("posting.claim_finalize.post"),
  captured: z.boolean(),
  claimed: z.boolean().optional(),
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
  reason: z.string().optional(),
  captureSummary: PostingClaimFinalizeCaptureSummarySchema.optional()
});

export function postingClaimFinalizeAcceptsRouteFields(body: {
  candidateId?: unknown;
  candidateItemType?: unknown;
  unexploredRouteId?: unknown;
  undiscoveredRouteId?: unknown;
  undiscoveredSpotId?: unknown;
  itemType?: unknown;
  sourceCollection?: unknown;
}): boolean {
  const candidateId = optionalTrimmedString(body.candidateId);
  const undiscoveredSpotId = optionalTrimmedString(body.undiscoveredSpotId);
  return (
    body.candidateItemType === "unexploredRoute" ||
    body.itemType === "unexploredRoute" ||
    body.sourceCollection === "unexploredRoutes" ||
    Boolean(optionalTrimmedString(body.unexploredRouteId)) ||
    Boolean(optionalTrimmedString(body.undiscoveredRouteId)) ||
    candidateId?.startsWith("unx_route_") === true ||
    undiscoveredSpotId?.startsWith("unx_route_") === true
  );
}

export const postingClaimFinalizeContract = defineContract({
  routeName: "posting.claim_finalize.post",
  method: "POST",
  path: "/v2/posting/claim-finalize",
  query: z.object({}).strict(),
  body: PostingClaimFinalizeBodySchema,
  response: PostingClaimFinalizeResultSchema
});
