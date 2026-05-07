import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

type Finding = {
  severity: Severity;
  file: string;
  line: number;
  title: string;
  why: string;
  snippet: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendv2Root = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(backendv2Root, "..");

const TARGET_FILES = [
  path.join(workspaceRoot, "Locava Web/src/app/(app)/admin/wikipedia-staging/page.jsx"),
  path.join(workspaceRoot, "Locava Web/src/app/(app)/admin/wikimedia-mvp/page.jsx"),
  path.join(workspaceRoot, "Locava Web/src/app/(app)/admin/wikipedia-coverage/page.jsx"),
  path.join(workspaceRoot, "Locava Backend/src/controllers/wikimediaMvp.controller.ts"),
  path.join(workspaceRoot, "Locava Backend/src/routes/v1/wikimediaMvp.routes.ts"),
  path.join(workspaceRoot, "Locava Backend/src/controllers/wikimediaMvp.multiStateStaged.controller.ts"),
  path.join(workspaceRoot, "Locava Backend/src/services/wikimediaMvp/wikimediaMvp.staging.ts"),
  path.join(workspaceRoot, "Locava Backend/src/services/wikimediaMvp/wikimediaMvp.readyQueue.ts"),
  path.join(workspaceRoot, "Locava Backend/src/services/wikimediaMvp/wikimediaMvp.seedStates.ts"),
  path.join(workspaceRoot, "Locava Backend/src/services/wikimediaMvp/wikimediaMvp.stateJobs.ts"),
  path.join(workspaceRoot, "Locava Backend/src/services/wikimediaMvp/wikimediaMvp.multiStateStagedRunner.ts"),
  path.join(workspaceRoot, "Locava Backend/src/services/wikimediaMvp/wikimediaMvp.coverage.ts"),
];

type FileData = {
  absPath: string;
  relPath: string;
  text: string;
  lines: string[];
};

async function readFileData(absPath: string): Promise<FileData | null> {
  try {
    const text = await fs.readFile(absPath, "utf8");
    return {
      absPath,
      relPath: path.relative(workspaceRoot, absPath),
      text,
      lines: text.split(/\r?\n/g),
    };
  } catch {
    return null;
  }
}

function lineOf(text: string, token: string): number {
  const idx = text.indexOf(token);
  if (idx < 0) return 1;
  return text.slice(0, idx).split(/\r?\n/g).length;
}

function snippetAt(lines: string[], line: number): string {
  return (lines[Math.max(0, line - 1)] || "").trim();
}

function addFinding(
  findings: Finding[],
  file: FileData,
  severity: Severity,
  token: string,
  title: string,
  why: string,
): void {
  const line = lineOf(file.text, token);
  findings.push({
    severity,
    file: file.relPath,
    line,
    title,
    why,
    snippet: snippetAt(file.lines, line),
  });
}

async function main(): Promise<void> {
  const files = (await Promise.all(TARGET_FILES.map(readFileData))).filter((x): x is FileData => Boolean(x));
  const findings: Finding[] = [];

  const byRel = new Map(files.map((file) => [file.relPath, file] as const));

  const stagingPage = byRel.get("Locava Web/src/app/(app)/admin/wikipedia-staging/page.jsx");
  if (stagingPage) {
    if (stagingPage.text.includes("/api/v1/wikimedia-mvp/staging/runs?limit=5000")) {
      addFinding(
        findings,
        stagingPage,
        "CRITICAL",
        '/api/v1/wikimedia-mvp/staging/runs?limit=5000',
        "Staging page requests up to 5000 run summaries on mount",
        "Opening the page can read every staged run summary up to 5000, before the operator expands anything.",
      );
    }
    if (
      stagingPage.text.includes("const loadRuns = useCallback(async () =>") &&
      stagingPage.text.includes("setSelectedRunId(initial);") &&
      stagingPage.text.includes("}, [applyReadyQueueCounts, requestedRunId, selectedRunId]);")
    ) {
      addFinding(
        findings,
        stagingPage,
        "CRITICAL",
        "setSelectedRunId(initial);",
        "Initial run-list fetch can repeat because the loader depends on selectedRunId",
        "The mount effect calls loadRuns, loadRuns mutates selectedRunId, and selectedRunId is itself a dependency of loadRuns.",
      );
    }
    if (stagingPage.text.includes("const runPathVariants = [")) {
      addFinding(
        findings,
        stagingPage,
        "HIGH",
        "const runPathVariants = [",
        "Run detail loader retries up to three equivalent URLs",
        "Zero-spot runs can trigger repeated expensive run-detail requests even though the backend already includes posts by default.",
      );
    }
    if (stagingPage.text.includes("backendPath(\"/api/v1/wikimedia-mvp/staging/ready/preview?limit=5000\")")) {
      addFinding(
        findings,
        stagingPage,
        "HIGH",
        'backendPath("/api/v1/wikimedia-mvp/staging/ready/preview?limit=5000")',
        "Ready queue preview loads up to 5000 rows when the modal opens",
        "This is not a mount read, but it can become expensive if operators open the publish preview on a large queue.",
      );
    }
    if (stagingPage.text.includes("window.setInterval(() => {\n      void Promise.all([loadRunDetail(selectedRunId), loadRuns()]);\n    }, 1200);")) {
      addFinding(
        findings,
        stagingPage,
        "HIGH",
        "void Promise.all([loadRunDetail(selectedRunId), loadRuns()]);",
        "Next-batch polling replays both run-list and run-detail reads every 1.2s",
        "While generation is active, the page repeatedly re-hits the most expensive staging endpoints.",
      );
    }
    if (stagingPage.text.includes("useEffect(() => {\n    if (selectedRunId) void loadRunDetail(selectedRunId);\n  }, [selectedRunId, loadRunDetail]);")) {
      addFinding(
        findings,
        stagingPage,
        "HIGH",
        "if (selectedRunId) void loadRunDetail(selectedRunId);",
        "Selected run detail autoloads without explicit bounded paging options",
        "Selected run detail must stay bounded and should request explicit page size/cursor fields.",
      );
    }
  }

  const mvpPage = byRel.get("Locava Web/src/app/(app)/admin/wikimedia-mvp/page.jsx");
  if (mvpPage) {
    if (mvpPage.text.includes('buildWmvpUrl(server.origin, "/staging/runs?limit=5000")')) {
      addFinding(
        findings,
        mvpPage,
        "HIGH",
        'buildWmvpUrl(server.origin, "/staging/runs?limit=5000")',
        "MVP lab active-runs panel loads up to 5000 staged run summaries",
        "The page summary panel still triggers the expensive staging-runs backend path on mount.",
      );
    }
    if (mvpPage.text.includes("setInterval(() => void fetchMsrStatus(), 4000)")) {
      addFinding(
        findings,
        mvpPage,
        "CRITICAL",
        "setInterval(() => void fetchMsrStatus(), 4000)",
        "MVP lab polls multi-state status every 4 seconds",
        "If the status endpoint scans all states/spots, this poller can produce a sustained production read storm.",
      );
    }
    if (mvpPage.text.includes('mvpApi("/state-jobs?limit=25"')) {
      addFinding(
        findings,
        mvpPage,
        "MEDIUM",
        'mvpApi("/state-jobs?limit=25"',
        "MVP lab polls state-job summaries",
        "This is bounded, but it still creates steady repeated reads while the page stays open.",
      );
    }
    if (
      mvpPage.text.includes("setInterval(() => void fetchMsrStatus(), 4000)") &&
      !mvpPage.text.includes("document.visibilityState")
    ) {
      addFinding(
        findings,
        mvpPage,
        "HIGH",
        "setInterval(() => void fetchMsrStatus(), 4000)",
        "MSR polling does not guard for tab visibility",
        "Polling should pause when the tab is hidden or not actively viewing the run.",
      );
    }
  }

  const stagingService = byRel.get("Locava Backend/src/services/wikimediaMvp/wikimediaMvp.staging.ts");
  if (stagingService) {
    if (stagingService.text.includes(".collection(SPOTS_SUBCOLLECTION)\n    .get();")) {
      addFinding(
        findings,
        stagingService,
        "CRITICAL",
        ".collection(SPOTS_SUBCOLLECTION)\n    .get();",
        "Selected run hydration reads the full spots subcollection with no limit",
        "Because spot docs embed staged posts and media arrays, this becomes a full staged-post hydration for the selected run.",
      );
    }
    if (stagingService.text.includes("export const WIKIMEDIA_MVP_STAGED_RUNS_LIST_MAX = 5000;")) {
      addFinding(
        findings,
        stagingService,
        "HIGH",
        "export const WIKIMEDIA_MVP_STAGED_RUNS_LIST_MAX = 5000;",
        "Server-side max list limit is set to 5000",
        "Even though the query is technically bounded, the bound is high enough to behave like an all-runs scan for admin traffic.",
      );
    }
    if (
      stagingService.text.includes("wikimediaMvpGetStagedRunWithOptions") &&
      !stagingService.text.includes("spotsPageInfo")
    ) {
      addFinding(
        findings,
        stagingService,
        "HIGH",
        "wikimediaMvpGetStagedRunWithOptions",
        "Staged run detail does not expose spot paging metadata",
        "Run detail should expose bounded page metadata for incremental spot loading.",
      );
    }
  }

  const readyQueueService = byRel.get("Locava Backend/src/services/wikimediaMvp/wikimediaMvp.readyQueue.ts");
  if (readyQueueService) {
    if (readyQueueService.text.includes("const snap = await getDb().collection(COLLECTION).get();")) {
      addFinding(
        findings,
        readyQueueService,
        "CRITICAL",
        "const snap = await getDb().collection(COLLECTION).get();",
        "Ready queue stats reads the entire collection",
        "Any endpoint that asks for queue counts pays for a full collection scan regardless of whether the caller needs detailed rows.",
      );
    }
  }

  const multiStateService = byRel.get("Locava Backend/src/services/wikimediaMvp/wikimediaMvp.multiStateStagedRunner.ts");
  if (multiStateService) {
    if (
      multiStateService.text.includes("export async function wikimediaMvpMultiStateStagedStatus") &&
      multiStateService.text.includes('.collection("states").get();') &&
      multiStateService.text.includes('const spotsSnap = await d.ref.collection("spots").get();')
    ) {
      addFinding(
        findings,
        multiStateService,
        "CRITICAL",
        'const spotsSnap = await d.ref.collection("spots").get();',
        "Multi-state status scans every state's spots subcollection",
        "This status endpoint scales with total staged state spots and is especially dangerous when polled.",
      );
    }
    if (multiStateService.text.includes("const reconciliationWarnings = await reconcileMultiStateRun(")) {
      addFinding(
        findings,
        multiStateService,
        "HIGH",
        "const reconciliationWarnings = await reconcileMultiStateRun(",
        "Status path performs reconciliation work",
        "Status polling should stay read-only and avoid expensive or mutating reconciliation work.",
      );
    }
  }

  const wmvpController = byRel.get("Locava Backend/src/controllers/wikimediaMvp.controller.ts");
  if (wmvpController) {
    if (
      wmvpController.text.includes("stagingRuns: async") &&
      wmvpController.text.includes("readyQueueCountsPayload()") &&
      !wmvpController.text.includes("includeReadyQueueStats")
    ) {
      addFinding(
        findings,
        wmvpController,
        "CRITICAL",
        "stagingRuns: async",
        "Staging run list always hydrates ready queue stats",
        "Run-list responses should not trigger global ready queue counting unless explicitly requested.",
      );
    }
    if (
      wmvpController.text.includes("stagingRun: async") &&
      wmvpController.text.includes("readyQueueCountsPayload()") &&
      !wmvpController.text.includes("includeReadyQueueStats")
    ) {
      addFinding(
        findings,
        wmvpController,
        "CRITICAL",
        "stagingRun: async",
        "Staging run detail always hydrates ready queue stats",
        "Run-detail responses should avoid ready queue scans unless explicitly requested.",
      );
    }
  }

  const seedStatesService = byRel.get("Locava Backend/src/services/wikimediaMvp/wikimediaMvp.seedStates.ts");
  if (seedStatesService && seedStatesService.text.includes("const docs = await Promise.all(states.map((s) => loadDoc(s.stateCode)));")) {
    addFinding(
      findings,
      seedStatesService,
      "MEDIUM",
      "const docs = await Promise.all(states.map((s) => loadDoc(s.stateCode)));",
      "Seed-state list fans out to one Firestore doc read per state",
      "This is bounded to US states, but it is still a mount-time fan-out read pattern.",
    );
  }

  const coverageService = byRel.get("Locava Backend/src/services/wikimediaMvp/wikimediaMvp.coverage.ts");
  if (coverageService && coverageService.text.includes("const snaps = await db.getAll(...refs);")) {
    addFinding(
      findings,
      coverageService,
      "LOW",
      "const snaps = await db.getAll(...refs);",
      "Coverage map loads all persisted state rollups in chunks",
      "This is bounded and summary-only, so it is not a primary runaway read risk.",
    );
  }

  const stateJobsService = byRel.get("Locava Backend/src/services/wikimediaMvp/wikimediaMvp.stateJobs.ts");
  if (stateJobsService && stateJobsService.text.includes('.orderBy("updatedAtMs", "desc").limit(lim).get();')) {
    addFinding(
      findings,
      stateJobsService,
      "LOW",
      '.orderBy("updatedAtMs", "desc").limit(lim).get();',
      "State-jobs list is bounded",
      "This endpoint still polls, but the read surface is materially smaller than the staging and multi-state paths.",
    );
  }

  const severityOrder: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
  findings.sort((a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity) || a.file.localeCompare(b.file) || a.line - b.line);

  const counts = {
    CRITICAL: findings.filter((f) => f.severity === "CRITICAL").length,
    HIGH: findings.filter((f) => f.severity === "HIGH").length,
    MEDIUM: findings.filter((f) => f.severity === "MEDIUM").length,
    LOW: findings.filter((f) => f.severity === "LOW").length,
  };

  console.log("# WMVP Staging Static Read Audit");
  console.log("");
  console.log(`Workspace: \`${workspaceRoot}\``);
  console.log(`Scanned files: ${files.length}`);
  console.log(`Findings: ${findings.length} total`);
  console.log(`Severity counts: CRITICAL=${counts.CRITICAL}, HIGH=${counts.HIGH}, MEDIUM=${counts.MEDIUM}, LOW=${counts.LOW}`);
  console.log("");

  if (findings.length === 0) {
    console.log("No risky WMVP staging read patterns were detected.");
    return;
  }

  console.log("| Severity | File | Line | Finding |");
  console.log("| --- | --- | ---: | --- |");
  for (const finding of findings) {
    console.log(`| ${finding.severity} | \`${finding.file}\` | ${finding.line} | ${finding.title} |`);
  }

  console.log("");
  console.log("## Details");
  console.log("");

  for (const finding of findings) {
    console.log(`### ${finding.severity} - ${finding.title}`);
    console.log(`- File: \`${finding.file}:${finding.line}\``);
    console.log(`- Why: ${finding.why}`);
    console.log(`- Snippet: \`${finding.snippet}\``);
    console.log("");
  }

  if (counts.CRITICAL > 0) {
    process.exitCode = 2;
  }
}

await main();
