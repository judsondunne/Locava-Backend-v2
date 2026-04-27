import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROJECT_ID, ensureEmulatorEnv } from "./common.mts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const srcRoot = path.join(repoRoot, "src");

const EMULATOR_FILES = [
  "src/app/createApp.test.ts",
  "src/routes/v2/auth-bootstrap.routes.test.ts",
  "src/routes/v2/directory-users.routes.test.ts",
  "src/routes/v2/collections-membership.routes.test.ts",
  "src/routes/v2/collections-saved.routes.test.ts",
  "src/routes/v2/comments.routes.test.ts",
  "src/routes/v2/feed-item-detail.routes.test.ts",
  "src/routes/v2/map-bootstrap.routes.test.ts",
  "src/routes/v2/mutations.routes.test.ts",
  "src/routes/v2/notifications.routes.test.ts",
  "src/routes/v2/posting.routes.test.ts",
  "src/routes/v2/profile-grid.routes.test.ts",
  "src/routes/v2/profile-post-detail.routes.test.ts",
  "src/routes/v2/profile.routes.test.ts",
  "src/routes/v2/search-results.routes.test.ts",
  "src/routes/v2/search-users.routes.test.ts",
  "src/routes/v2/social.routes.test.ts"
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findOpenPort(start = 8080): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (port: number) => {
      const server = net.createServer();
      server.unref();
      server.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") {
          tryPort(port + 1);
          return;
        }
        reject(error);
      });
      server.listen(port, () => {
        const address = server.address();
        const resolved =
          address && typeof address === "object" && typeof address.port === "number" ? address.port : port;
        server.close((closeError) => {
          if (closeError) {
            reject(closeError);
            return;
          }
          resolve(resolved);
        });
      });
    };
    tryPort(start);
  });
}

function listTestFiles(dir: string): string[] {
  const entries = readdirSync(dir).sort();
  const out: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      out.push(...listTestFiles(absolute));
      continue;
    }
    if (entry.endsWith(".test.ts")) {
      out.push(path.relative(repoRoot, absolute));
    }
  }
  return out;
}

function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv, cwd = repoRoot): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`command_failed:${command} ${args.join(" ")} exit=${code ?? "unknown"}`));
    });
    child.on("error", reject);
  });
}

async function runInsideEmulator(mode: "suite" | "check"): Promise<void> {
  ensureEmulatorEnv();
  const setupEnv = {
    ...process.env,
    NODE_ENV: "test",
    FIRESTORE_TEST_MODE: "emulator",
    FIRESTORE_SOURCE_ENABLED: "true",
    GOOGLE_APPLICATION_CREDENTIALS: " "
  };
  await runCommand("node", ["--import", "tsx", "./test/firestore/reset.mts"], setupEnv);
  await runCommand("node", ["--import", "tsx", "./test/firestore/seed.mts"], setupEnv);
  if (mode === "check") {
    console.log("[firestore-test] emulator ready");
    return;
  }

  const allFiles = listTestFiles(srcRoot);
  const emulatorSet = new Set(EMULATOR_FILES);
  const disabledFiles = allFiles.filter((file) => !emulatorSet.has(file));
  const baseEnv = {
    ...process.env,
    NODE_ENV: "test",
    GOOGLE_APPLICATION_CREDENTIALS: " ",
    FIRESTORE_SOURCE_ENABLED: "true"
  };

  if (disabledFiles.length > 0) {
    await runCommand("npx", ["vitest", "run", ...disabledFiles], {
      ...baseEnv,
      FIRESTORE_TEST_MODE: "disabled"
    });
  }

  for (const file of EMULATOR_FILES) {
    await sleep(300);
    await runCommand("node", ["--import", "tsx", "./test/firestore/reset.mts"], setupEnv);
    await runCommand("node", ["--import", "tsx", "./test/firestore/seed.mts"], setupEnv);
    await runCommand("npx", ["vitest", "run", file], {
      ...baseEnv,
      FIRESTORE_TEST_MODE: "emulator"
    });
  }
}

async function ensureJava(): Promise<void> {
  await runCommand("java", ["-version"], process.env);
}

async function runOuter(mode: "suite" | "check"): Promise<void> {
  await ensureJava();
  const firebaseConfigPath = path.join(repoRoot, "firebase.json");
  const firebaseConfig = JSON.parse(readFileSync(firebaseConfigPath, "utf8")) as {
    emulators?: { firestore?: { port?: number } };
  };
  const firestorePort = await findOpenPort(firebaseConfig.emulators?.firestore?.port ?? 8080);
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "locava-backendv2-firebase-"));
  const tempConfigPath = path.join(tempDir, "firebase.json");
  writeFileSync(
    tempConfigPath,
    JSON.stringify(
      {
        ...firebaseConfig,
        firestore: {
          ...(firebaseConfig as { firestore?: Record<string, unknown> }).firestore,
          indexes: path.join(repoRoot, "firestore.indexes.json")
        },
        emulators: {
          ...(firebaseConfig.emulators ?? {}),
          firestore: {
            ...(firebaseConfig.emulators?.firestore ?? {}),
            port: firestorePort
          }
        }
      },
      null,
      2
    )
  );
  const innerCommand = `cd ${JSON.stringify(repoRoot)} && node --import tsx ./test/firestore/run-deterministic.mts --internal ${mode}`;
  try {
    await runCommand(
      "npx",
      [
        "--yes",
        "firebase-tools",
        "emulators:exec",
        "--config",
        tempConfigPath,
        "--only",
        "firestore",
        "--project",
        PROJECT_ID,
        innerCommand
      ],
      process.env,
      tempDir
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

const [, , flag, modeArg] = process.argv;
if (flag === "--internal") {
  await runInsideEmulator(modeArg === "check" ? "check" : "suite");
} else if (flag === "--emulator-check") {
  await runOuter("check");
} else {
  await runOuter("suite");
}
