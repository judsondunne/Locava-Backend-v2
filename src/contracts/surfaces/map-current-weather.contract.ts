import { z } from "zod";
import { defineContract, EmptySchema } from "../conventions.js";

export const MapCurrentWeatherQuerySchema = z.object({
  lat: z.coerce.number().finite().min(-90).max(90),
  lon: z.coerce.number().finite().min(-180).max(180)
});

export const MapCurrentWeatherResponseSchema = z.object({
  routeName: z.literal("map.current_weather.get"),
  temp: z.number(),
  tempMax: z.number(),
  tempMin: z.number(),
  feelsLike: z.number(),
  condition: z.string().min(1),
  /** Original WMO code from provider (optional, for debugging). */
  weatherCode: z.number().int().optional(),
  source: z.enum(["open_meteo", "openweathermap"])
});

export const mapCurrentWeatherContract = defineContract({
  routeName: "map.current_weather.get",
  method: "GET",
  path: "/v2/map/current-weather",
  query: MapCurrentWeatherQuerySchema,
  body: EmptySchema,
  response: MapCurrentWeatherResponseSchema
});

export type MapCurrentWeatherResponse = z.infer<typeof MapCurrentWeatherResponseSchema>;
