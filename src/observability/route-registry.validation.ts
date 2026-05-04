import { listRoutePolicies } from "./route-policies.js";
import { listInferredRouteIndex } from "../runtime/infer-route-name.js";

export type RouteRegistryValidationResult = {
  duplicateRouteNames: string[];
  duplicateMethodPathWithDifferentNames: Array<{
    method: string;
    path: string;
    routeNames: string[];
  }>;
};

export function validateRouteRegistry(): RouteRegistryValidationResult {
  const policies = listRoutePolicies();
  const duplicateRouteNames = findDuplicateNames(policies.map((row) => row.routeName));
  const duplicateMethodPathWithDifferentNames = findMethodPathConflicts(listInferredRouteIndex());
  return {
    duplicateRouteNames,
    duplicateMethodPathWithDifferentNames
  };
}

function findDuplicateNames(routeNames: string[]): string[] {
  const counts = new Map<string, number>();
  for (const routeName of routeNames) {
    counts.set(routeName, (counts.get(routeName) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([routeName]) => routeName)
    .sort((a, b) => a.localeCompare(b));
}

function findMethodPathConflicts(
  rows: Array<{ method: string; path: string; routeName: string }>
): Array<{ method: string; path: string; routeNames: string[] }> {
  const byMethodPath = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = `${row.method.toUpperCase()} ${row.path}`;
    const names = byMethodPath.get(key) ?? new Set<string>();
    names.add(row.routeName);
    byMethodPath.set(key, names);
  }

  return [...byMethodPath.entries()]
    .map(([key, routeNames]) => {
      const firstSpace = key.indexOf(" ");
      return {
        method: key.slice(0, firstSpace),
        path: key.slice(firstSpace + 1),
        routeNames: [...routeNames].sort((a, b) => a.localeCompare(b))
      };
    })
    .filter((row) => row.routeNames.length > 1)
    .sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));
}
