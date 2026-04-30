import { z } from "zod";
import { defineContract, EmptySchema } from "../conventions.js";

export const KNOWN_ANALYTICS_EVENT_NAMES = [
  "session_start",
  "session_heartbeat",
  "session_end",
  "session_location",
  "app_open",
  "app_first_open",
  "app_foreground",
  "app_background",
  "screen_view",
  "tab_view",
  "feed_bootstrap",
  "feed_page_view",
  "post_impression",
  "post_open",
  "post_view",
  "post_view_duration",
  "post_like",
  "post_unlike",
  "post_save",
  "post_unsave",
  "comment_open",
  "comment_create",
  "profile_view",
  "map_open",
  "map_marker_view",
  "search_open",
  "search_query",
  "search_result_click",
  "collection_view",
  "collection_save",
  "chat_opened",
  "notification_opened",
  "onboarding_step_view",
  "onboarding_step_complete",
  "deep_link_open",
  "user_identified",
  "consent_updated",
  "feature_flag_state",
  "experiment_exposure",
  "post_engagement_summary_v1",
  "backend_route_observation"
] as const;

export const AnalyticsEventNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9_]+$/, "analytics event names must be snake_case");

export const AnalyticsPropertiesSchema = z.record(z.string().min(1).max(128), z.unknown()).default({});

export const AnalyticsEventEnvelopeSchema = z
  .object({
    eventId: z.string().trim().min(1).max(128).optional(),
    schemaVersion: z.string().trim().min(1).max(32).optional(),
    event: AnalyticsEventNameSchema,
    properties: AnalyticsPropertiesSchema.optional(),
    clientTime: z.coerce.number().int().positive().optional(),
    serverTime: z.coerce.number().int().positive().optional(),
    timezone: z.string().trim().min(1).max(128).optional(),
    userId: z.string().trim().min(1).max(128).nullable().optional(),
    anonId: z.string().trim().min(1).max(128).optional(),
    installId: z.string().trim().min(1).max(128).optional(),
    sessionId: z.string().trim().min(1).max(128).optional(),
    appVersion: z.string().trim().min(1).max(64).optional(),
    buildNumber: z.string().trim().min(1).max(64).optional(),
    releaseChannel: z.string().trim().min(1).max(64).optional(),
    platform: z.string().trim().min(1).max(32).optional(),
    osVersion: z.string().trim().min(1).max(64).optional(),
    deviceModel: z.string().trim().min(1).max(128).optional(),
    country: z.string().trim().min(1).max(64).optional(),
    region: z.string().trim().min(1).max(64).optional(),
    geohashPrecision: z.string().trim().min(1).max(32).optional(),
    attribution: z.record(z.string().min(1).max(128), z.unknown()).optional(),
    branch_link_data_first: z.record(z.string().min(1).max(128), z.unknown()).optional(),
    branch_link_data_last: z.record(z.string().min(1).max(128), z.unknown()).optional(),
    consentFlags: z.record(z.string().min(1).max(128), z.unknown()).optional(),
    experimentExposures: z.array(z.record(z.string().min(1).max(128), z.unknown())).max(50).optional(),
    networkType: z.string().trim().min(1).max(64).optional(),
    screenName: z.string().trim().min(1).max(128).optional(),
    performance: z.record(z.string().min(1).max(128), z.unknown()).optional()
  })
  .passthrough();

export type AnalyticsEventEnvelope = z.infer<typeof AnalyticsEventEnvelopeSchema>;

export const AnalyticsEventsBodySchema = z.object({
  events: z.array(AnalyticsEventEnvelopeSchema).min(1).max(250)
});

export type AnalyticsEventsBody = z.infer<typeof AnalyticsEventsBodySchema>;

export const AnalyticsEventsResponseSchema = z.object({
  routeName: z.literal("analytics.events.post"),
  accepted: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  dropped: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  disabled: z.boolean(),
  destination: z.object({
    enabled: z.boolean(),
    projectId: z.string().nullable(),
    dataset: z.string().nullable(),
    table: z.string().nullable()
  })
});

export const analyticsEventsContract = defineContract({
  routeName: "analytics.events.post",
  method: "POST",
  path: "/v2/analytics/events",
  query: EmptySchema,
  body: AnalyticsEventsBodySchema,
  response: AnalyticsEventsResponseSchema
});
