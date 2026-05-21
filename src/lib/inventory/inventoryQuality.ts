import type { InventorySpot, InventoryRoute } from "../../contracts/entities/inventory-entities.contract.js";
import { isAcceptedRouteCategory, isAcceptedSpotCategory, isStrongSpotCategory } from "./inventoryCategories.js";

export type InventoryQualityInput = {
  kind: "spot" | "route";
  name: string;
  category: string;
  categories: string[];
  lat?: number;
  lng?: number;
  hasGeometry?: boolean;
  distanceMeters?: number;
  tags: Record<string, unknown>;
};

export function scoreInventoryItem(input: InventoryQualityInput): number {
  let score = 40;

  const trimmedName = input.name.trim();
  if (trimmedName.length >= 3) score += 20;
  else if (trimmedName.length > 0) score += 8;
  else score -= 25;

  if (input.kind === "spot" && isAcceptedSpotCategory(input.category)) score += 12;
  if (input.kind === "route" && isAcceptedRouteCategory(input.category)) score += 12;

  if (isStrongSpotCategory(input.category) || input.category === "hiking" || input.category === "trail") {
    score += 10;
  }

  if (input.kind === "route") {
    if (input.hasGeometry) score += 15;
    if (typeof input.distanceMeters === "number" && input.distanceMeters > 50) score += 10;
  }

  const tagCount = Object.keys(input.tags).length;
  if (tagCount >= 3) score += 8;
  else if (tagCount >= 1) score += 3;

  if (input.kind === "spot" && typeof input.lat === "number" && typeof input.lng === "number") {
    if (Math.abs(input.lat) > 89.9 || Math.abs(input.lng) > 179.9) score -= 30;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function meetsMinimumSpotQuality(input: {
  name: string;
  category: string;
  qualityScore: number;
}): boolean {
  if (input.qualityScore < 35) return false;
  if (!input.name.trim() && !isStrongSpotCategory(input.category)) return false;
  return isAcceptedSpotCategory(input.category);
}

export function meetsMinimumRouteQuality(input: {
  name: string;
  category: string;
  qualityScore: number;
  hasGeometry: boolean;
}): boolean {
  if (!input.hasGeometry) return false;
  if (input.qualityScore < 40) return false;
  if (!input.name.trim()) return false;
  return isAcceptedRouteCategory(input.category) || input.category === "hiking";
}

export function sortByQualityDesc<T extends InventorySpot | InventoryRoute>(items: T[]): T[] {
  return [...items].sort((a, b) => b.qualityScore - a.qualityScore || a.id.localeCompare(b.id));
}
