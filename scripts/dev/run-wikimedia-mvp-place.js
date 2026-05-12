#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, "..", "run-wikimedia-mvp-place.mts");
const args = process.argv.slice(2);
const result = spawnSync("npx", ["tsx", script, ...args], { stdio: "inherit", shell: false });
process.exit(result.status ?? 1);
