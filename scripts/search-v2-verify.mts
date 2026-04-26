#!/usr/bin/env node
import process from "node:process";

const base = process.env.BACKENDV2_BASE_URL ?? "http://127.0.0.1:8080";
const viewerId = process.env.SEARCH_TEST_VIEWER_ID ?? "aXngoh9jeqW35FNM3fq1w9aXdEh1";

const suggestQueries = ["h", "hi", "hiking", "best hikes", "best hikes in vermont", "cool swimming spots near me", "jud"];

async function run(): Promise<void> {
  const headers = {
    "x-viewer-id": viewerId,
    "x-viewer-roles": "internal",
    accept: "application/json"
  };
  const urls = [
    `${base}/v2/search/bootstrap`,
    ...suggestQueries.map((q) => `${base}/v2/search/suggest?q=${encodeURIComponent(q)}`),
    `${base}/v2/search/results?q=${encodeURIComponent("best hikes in vermont")}`,
    `${base}/v2/search/users?q=jud`
  ];
  for (const url of urls) {
    const res = await fetch(url, { headers });
    const text = await res.text();
    const timing = res.headers.get("server-timing") ?? "";
    console.log(`\n=== ${url}`);
    console.log(`status=${res.status} server-timing=${timing}`);
    console.log(text.slice(0, 1200));
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

