/**
 * Vermont PBF Copier V2 evaluation regions — 30-mile radius bboxes for audit runs.
 */
import { bboxFromCenterRadiusKm } from "../../../../lib/inventory/inventoryBbox.js";
import type { PbfCopierV2ViewportBbox } from "./pbfCopierV2ViewportPreview.js";

export const VERMONT_EVAL_RADIUS_MILES = 30;
export const VERMONT_EVAL_RADIUS_KM = VERMONT_EVAL_RADIUS_MILES * 1.60934;

export type VermontEvalRegion = {
  slug: string;
  name: string;
  center: { lat: number; lng: number };
  reason: string;
};

export const VERMONT_EVAL_REGIONS: VermontEvalRegion[] = [
  {
    slug: "quechee-hartford",
    name: "Quechee / Hartford / Upper Valley",
    center: { lat: 43.646171, lng: -72.419239 },
    reason: "Known Locava area, tourist/outdoor/business mix, Quechee Gorge, trails, villages.",
  },
  {
    slug: "woodstock-marsh-billings",
    name: "Woodstock / Marsh-Billings",
    center: { lat: 43.62424, lng: -72.51843 },
    reason: "Trails, parks, restaurants, tourist businesses, rural POIs.",
  },
  {
    slug: "burlington-lake-champlain",
    name: "Burlington / Lake Champlain / UVM",
    center: { lat: 44.475883, lng: -73.212074 },
    reason: "Dense urban businesses, waterfront, college/campus, parks, restaurants.",
  },
  {
    slug: "stowe-waterbury",
    name: "Stowe / Waterbury / Mountain area",
    center: { lat: 44.475277, lng: -72.702225 },
    reason: "Ski/outdoor/tourist-heavy, trails, resorts, shops, restaurants.",
  },
  {
    slug: "montpelier-barre",
    name: "Montpelier / Barre",
    center: { lat: 44.27, lng: -72.57 },
    reason: "Civic noise test, downtown businesses, parks, trails, government buildings.",
  },
  {
    slug: "middlebury-addison",
    name: "Middlebury / Addison County",
    center: { lat: 44.015337, lng: -73.16734 },
    reason: "College town, downtown, farms, lake/water/outdoor spots.",
  },
  {
    slug: "rutland-killington",
    name: "Rutland / Killington",
    center: { lat: 43.610618, lng: -72.972683 },
    reason: "City + ski/outdoor/trails; test businesses and major routes.",
  },
  {
    slug: "manchester-dorset",
    name: "Manchester / Dorset / Southern Green Mountains",
    center: { lat: 43.18, lng: -73.04 },
    reason: "Tourist retail, hiking, outdoor spots, galleries, hotels, restaurants.",
  },
  {
    slug: "bennington-shaftsbury",
    name: "Bennington / Shaftsbury",
    center: { lat: 42.8781345, lng: -73.1967741 },
    reason: "Southern Vermont town, monuments/historic spots, businesses, civic filtering.",
  },
  {
    slug: "newport-nek",
    name: "Newport / Lake Memphremagog / NEK",
    center: { lat: 44.94, lng: -72.21 },
    reason: "Lake/water access, rural businesses, parks, trails, northern Vermont edge cases.",
  },
];

export function viewportBboxFromCenterRadius(
  center: { lat: number; lng: number },
  radiusKm: number = VERMONT_EVAL_RADIUS_KM
): PbfCopierV2ViewportBbox {
  const bbox = bboxFromCenterRadiusKm(center, radiusKm);
  return {
    westLng: bbox.minLng,
    southLat: bbox.minLat,
    eastLng: bbox.maxLng,
    northLat: bbox.maxLat,
  };
}

export function bboxForVermontEvalRegion(region: VermontEvalRegion): PbfCopierV2ViewportBbox {
  return viewportBboxFromCenterRadius(region.center);
}
