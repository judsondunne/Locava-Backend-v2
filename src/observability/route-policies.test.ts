import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listRoutePolicies, getRoutePolicy } from "./route-policies.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const routesDir = path.resolve(here, "../routes/v2");
const contractsDir = path.resolve(here, "../contracts/surfaces");

function collectQuotedSetRouteNames(): string[] {
  const names = new Set<string>();
  for (const file of readdirSync(routesDir).filter((entry) => entry.endsWith(".routes.ts"))) {
    const source = readFileSync(path.join(routesDir, file), "utf8");
    for (const match of source.matchAll(/setRouteName\("([^"]+)"\)/g)) {
      const routeName = match[1];
      if (routeName) names.add(routeName);
    }
  }
  return [...names].sort();
}

function collectContractRouteNames(): string[] {
  const names = new Set<string>();
  for (const file of readdirSync(contractsDir).filter((entry) => entry.endsWith(".contract.ts"))) {
    const source = readFileSync(path.join(contractsDir, file), "utf8");
    const match = source.match(/routeName:\s*"([^"]+)"/);
    const routeName = match?.[1];
    if (routeName) names.add(routeName);
  }
  return [...names].sort();
}

describe("route policy governance", () => {
  it("has unique route policy names", () => {
    const names = listRoutePolicies().map((policy) => policy.routeName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("covers every quoted setRouteName usage in v2 route files", () => {
    const missing = collectQuotedSetRouteNames().filter((routeName) => !getRoutePolicy(routeName));
    expect(missing).toEqual([]);
  });

  it("covers every surface contract route", () => {
    const missing = collectContractRouteNames().filter((routeName) => !getRoutePolicy(routeName));
    expect(missing).toEqual([]);
  });
});
