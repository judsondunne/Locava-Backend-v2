import { z } from "zod";
import { defineContract } from "../conventions.js";
import { LegendEventWireSchema } from "./legends-me-bootstrap.contract.js";

export const LegendsEventsUnseenResponseSchema = z.object({
  routeName: z.literal("legends.events.unseen.get"),
  events: z.array(LegendEventWireSchema).max(20),
  count: z.number().int().nonnegative(),
  nextPollAfterMs: z.number().int().nonnegative(),
  /** Present when we returned empty without waiting on optional Firestore work (startup pressure / timeout / cold client). */
  degraded: z.boolean().optional(),
  reason: z.string().max(160).optional(),
  debugTimingsMs: z.record(z.number()).optional()
});

export const legendsEventsUnseenContract = defineContract({
  routeName: "legends.events.unseen.get",
  method: "GET",
  path: "/v2/legends/events/unseen",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: LegendsEventsUnseenResponseSchema
});

