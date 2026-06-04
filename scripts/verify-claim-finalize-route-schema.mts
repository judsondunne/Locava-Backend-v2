#!/usr/bin/env tsx
/**
 * Read-only verification for claim-finalize route schema acceptance.
 *
 * Usage:
 *   npm run verify:claim-finalize-schema
 *   BACKEND_URL=http://192.168.0.232:8080 VERIFY_USER_ID=test_user npm run verify:claim-finalize-schema
 */
import {
  PostingClaimFinalizeBodySchema,
  normalizeClaimFinalizeBody
} from "../src/contracts/surfaces/posting-claim-finalize.contract.js";

const BACKEND_URL = (process.env.BACKEND_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const VERIFY_USER_ID = process.env.VERIFY_USER_ID ?? "schema_verify_user";

type HttpCase = {
  name: string;
  body: Record<string, unknown>;
  expectRouteClaim?: boolean;
};

const HTTP_CASES: HttpCase[] = [
  {
    name: "A_route_schema_acceptance",
    expectRouteClaim: true,
    body: {
      postId: "schema_test_post",
      userId: VERIFY_USER_ID,
      candidateId: "unx_route_schema_test",
      candidateItemType: "unexploredRoute",
      unexploredRouteId: "unx_route_schema_test",
      undiscoveredRouteId: "unx_route_schema_test",
      undiscoveredSpotId: null,
      requestLat: 43.44725,
      requestLng: -72.47488
    }
  },
  {
    name: "B_spot_schema_acceptance",
    body: {
      postId: "schema_test_post",
      userId: VERIFY_USER_ID,
      candidateId: "unx_spot_schema_test",
      candidateItemType: "unexploredSpot",
      undiscoveredSpotId: "unx_spot_schema_test",
      requestLat: 43.44725,
      requestLng: -72.47488
    }
  },
  {
    name: "C_real_route_id_lookup_path",
    expectRouteClaim: true,
    body: {
      postId: "schema_test_post",
      userId: VERIFY_USER_ID,
      candidateId: "unx_route_66c9a2b75aef",
      candidateItemType: "unexploredRoute",
      unexploredRouteId: "unx_route_66c9a2b75aef",
      undiscoveredRouteId: "unx_route_66c9a2b75aef",
      undiscoveredSpotId: null,
      requestLat: 43.44725,
      requestLng: -72.47488
    }
  }
];

function hasUnrecognizedKeys(payload: unknown): string[] {
  const row = payload as {
    error?: { code?: string; details?: { fieldErrors?: Record<string, string[]> } };
    ok?: boolean;
  };
  if (row?.error?.code !== "validation_error") return [];
  const fieldErrors = row.error.details?.fieldErrors ?? {};
  const keys: string[] = [];
  for (const messages of Object.values(fieldErrors)) {
    for (const message of messages ?? []) {
      const match = /unrecognized key\(s\) in object: '([^']+)'/.exec(message);
      if (match?.[1]) keys.push(match[1]);
    }
  }
  return keys;
}

function runLocalSchemaChecks(): void {
  console.log("\n=== LOCAL SCHEMA CHECKS ===");
  for (const testCase of HTTP_CASES) {
    const parsed = PostingClaimFinalizeBodySchema.parse(testCase.body);
    const normalized = normalizeClaimFinalizeBody(parsed, VERIFY_USER_ID);
    console.log(`[local.${testCase.name}] parsedOk=true isRouteClaim=${normalized.isRouteClaim} routeId=${normalized.routeId ?? "null"}`);
  }
}

async function postClaimFinalize(testCase: HttpCase): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/v2/posting/claim-finalize`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-viewer-id": VERIFY_USER_ID,
      "x-viewer-roles": "internal"
    },
    body: JSON.stringify(testCase.body)
  });

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  const unrecognized = hasUnrecognizedKeys(payload);
  const data =
    payload && typeof payload === "object" && "data" in (payload as Record<string, unknown>)
      ? (payload as { data?: Record<string, unknown> }).data
      : (payload as Record<string, unknown> | null);

  console.log(`\n[http.${testCase.name}] status=${response.status}`);
  console.log(`[http.${testCase.name}] unrecognized_keys=${unrecognized.length > 0 ? unrecognized.join(",") : "none"}`);
  console.log(
    `[http.${testCase.name}] captured=${String(data?.captured ?? data?.claimed ?? "null")} reason=${String(data?.reason ?? "null")} itemType=${String(data?.itemType ?? "null")}`,
  );

  if (unrecognized.length > 0) {
    throw new Error(`${testCase.name} failed: unrecognized_keys ${unrecognized.join(", ")}`);
  }
  if (response.status === 400 && (payload as { error?: { code?: string } })?.error?.code === "validation_error") {
    throw new Error(`${testCase.name} failed: validation_error ${text}`);
  }
}

async function main(): Promise<void> {
  console.log(`[verify.claim-finalize] backend=${BACKEND_URL} userId=${VERIFY_USER_ID}`);
  runLocalSchemaChecks();

  console.log("\n=== HTTP CHECKS ===");
  for (const testCase of HTTP_CASES) {
    await postClaimFinalize(testCase);
  }

  console.log("\n[verify.claim-finalize] PASS schema accepts route + spot claim fields (no unrecognized_keys)");
}

main().catch((error) => {
  console.error("\n[verify.claim-finalize] FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
});
