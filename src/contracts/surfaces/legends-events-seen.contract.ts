import { z } from "zod";
import { defineContract } from "../conventions.js";

export const LegendsEventsSeenParamsSchema = z.object({
  eventId: z.string().min(3)
});

export const LegendsEventsSeenResponseSchema = z.object({
  routeName: z.literal("legends.events.seen.post"),
  eventId: z.string(),
  seen: z.literal(true)
});

export const legendsEventsSeenContract = defineContract({
  routeName: "legends.events.seen.post",
  method: "POST",
  path: "/v2/legends/events/:eventId/seen",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: LegendsEventsSeenResponseSchema
});

