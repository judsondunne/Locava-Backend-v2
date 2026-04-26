import { z } from "zod";
import { defineContract } from "../conventions.js";

export const PlacesReverseGeocodeQuerySchema = z.object({
  lat: z.coerce.number().finite(),
  lng: z.coerce.number().finite().optional(),
  lon: z.coerce.number().finite().optional(),
});

export const PlacesReverseGeocodeResponseSchema = z.object({
  routeName: z.literal("places.reverse_geocode.get"),
  success: z.boolean(),
  address: z.string().nullable(),
  match: z
    .object({
      text: z.string(),
      stateName: z.string(),
      lat: z.number().nullable(),
      lng: z.number().nullable(),
    })
    .nullable(),
});

export const placesReverseGeocodeContract = defineContract({
  routeName: "places.reverse_geocode.get",
  method: "GET",
  path: "/v2/places/reverse-geocode",
  query: PlacesReverseGeocodeQuerySchema,
  body: z.object({}).strict(),
  response: PlacesReverseGeocodeResponseSchema,
});
