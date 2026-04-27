import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

type SemanticClassification =
  | "SEMANTIC_PASS"
  | "SEMANTIC_PASS_APPROXIMATE"
  | "SEMANTIC_PASS_STAGED"
  | "SEMANTIC_FAIL_WRONG_OWNER"
  | "SEMANTIC_FAIL_MISSING_DOC"
  | "SEMANTIC_FAIL_FAKE_DATA"
  | "SEMANTIC_FAIL_WRONG_ACTIVITY"
  | "SEMANTIC_FAIL_WRONG_COLLECTION_TYPE"
  | "SEMANTIC_FAIL_DUPLICATE"
  | "SEMANTIC_FAIL_CURSOR"
  | "SEMANTIC_FAIL_MUTATION_NOT_PERSISTED"
  | "SEMANTIC_FAIL_DEEP_LINK"
  | "SEMANTIC_UNTESTED";

type SemanticResult = {
  route: string;
  nativeSurface: string;
  scenario: string;
  classification: SemanticClassification;
  latencyMs: number | null;
  sourceFirestoreDocsChecked: string[];
  mismatchDetails: string[];
  fixRecommendation: string;
  fixed: boolean;
};

type SemanticReport = {
  generatedAt: string;
  viewerId: string;
  summary: Partial<Record<SemanticClassification, number>>;
  postingProbe: {
    attempted: boolean;
    uploadSessionOk: boolean;
    registerOk: boolean;
    markUploadedOk: boolean;
    finalizeOk: boolean;
    operationSuccess: boolean;
    publicPosterImage: boolean;
    publicVideo: boolean;
    visibleInProfile: boolean;
    visibleInFeed: boolean;
    visibleInMap: boolean;
    postId: string | null;
    operationId: string | null;
    mediaId: string | null;
    posterUrl: string | null;
    videoUrl: string | null;
    details: string[];
  };
  results: SemanticResult[];
};

type CategoryReport = {
  id: string;
  label: string;
  requiredRoutes: string[];
  statuses: Array<{
    route: string;
    classification: SemanticClassification | "MISSING";
    scenario: string;
  }>;
  pass: boolean;
};

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "..");
const workspaceRoot = path.resolve(backendRoot, "..");
const semanticsReportPath = path.join(backendRoot, "tmp", "real-user-v2-semantics-report.json");
const outputJsonPath = path.join(backendRoot, "tmp", "logged-in-user-tabs-report.json");
const outputMarkdownPath = path.join(workspaceRoot, "docs", "logged-in-user-tab-walkthrough-2026-04-26.md");

const categories: Array<{ id: string; label: string; requiredRoutes: string[] }> = [
  {
    id: "home-feed-tab",
    label: "Home Feed tab",
    requiredRoutes: ["/v2/feed/bootstrap", "/v2/feed/page", "/v2/feed/bootstrap?tab=following"]
  },
  {
    id: "map-explore-tab",
    label: "Map / Explore tab",
    requiredRoutes: ["/v2/map/markers", "/v2/map/bootstrap"]
  },
  {
    id: "create-post-tab",
    label: "Create / Post tab",
    requiredRoutes: ["/v2/posting/*"]
  },
  {
    id: "achievements-tab",
    label: "Achievements tab",
    requiredRoutes: ["/v2/achievements/status", "/v2/achievements/snapshot", "/v2/achievements/leaderboard/:scope"]
  },
  {
    id: "profile-tab",
    label: "Profile tab",
    requiredRoutes: [
      "/v2/profiles/aXngoh9jeqW35FNM3fq1w9aXdEh1/bootstrap",
      "/v2/profiles/aXngoh9jeqW35FNM3fq1w9aXdEh1/grid",
      "/v2/profiles/aXngoh9jeqW35FNM3fq1w9aXdEh1/posts/:postId/detail"
    ]
  },
  {
    id: "post-detail-screen",
    label: "Post Detail screen",
    requiredRoutes: ["/v2/posts/:postId/detail", "/v2/posts/:postId/comments"]
  },
  {
    id: "search-screen",
    label: "Search screen",
    requiredRoutes: [
      "/v2/search/suggest",
      "/v2/search/bootstrap",
      "/v2/search/results",
      "/v2/search/results?types=collections",
      "/v2/search/users"
    ]
  },
  {
    id: "collections-screen",
    label: "Collections screen",
    requiredRoutes: [
      "/v2/collections",
      "/v2/collections/:id",
      "/v2/collections/:id/posts",
      "/v2/posts/:postId/save",
      "/v2/posts/:postId/unsave"
    ]
  },
  {
    id: "chat-messages-screen",
    label: "Chat / Messages screen",
    requiredRoutes: ["/v2/chats/inbox", "/v2/chats/:conversationId/messages"]
  }
];

function isPassing(classification: string): boolean {
  return classification.startsWith("SEMANTIC_PASS");
}

function buildCategoryReport(report: SemanticReport, category: { id: string; label: string; requiredRoutes: string[] }): CategoryReport {
  const statuses = category.requiredRoutes.map((route) => {
    const result = report.results.find((row) => row.route === route);
    return {
      route,
      classification: result?.classification ?? "MISSING",
      scenario: result?.scenario ?? "No matching semantics result was generated."
    };
  });
  return {
    id: category.id,
    label: category.label,
    requiredRoutes: category.requiredRoutes,
    statuses,
    pass: statuses.every((status) => isPassing(status.classification))
  };
}

async function main(): Promise<void> {
  const run = spawnSync("npm", ["run", "debug:real-user:v2-semantics"], {
    cwd: backendRoot,
    stdio: "inherit",
    env: process.env
  });
  if (run.status !== 0) {
    process.exit(run.status ?? 1);
  }

  const report = JSON.parse(await fs.readFile(semanticsReportPath, "utf8")) as SemanticReport;
  const categoryReports = categories.map((category) => buildCategoryReport(report, category));
  const passCount = categoryReports.filter((row) => row.pass).length;
  const allPassed = categoryReports.every((row) => row.pass);

  const output = {
    generatedAt: new Date().toISOString(),
    viewerId: report.viewerId,
    semanticsGeneratedAt: report.generatedAt,
    semanticsSummary: report.summary,
    postingProbe: report.postingProbe,
    passCount,
    totalCategories: categoryReports.length,
    allPassed,
    categories: categoryReports
  };

  await fs.mkdir(path.dirname(outputJsonPath), { recursive: true });
  await fs.writeFile(outputJsonPath, JSON.stringify(output, null, 2));

  const lines: string[] = [];
  lines.push("# Logged-In User Tab Walkthrough - 2026-04-26");
  lines.push("");
  lines.push(`Generated: ${output.generatedAt}`);
  lines.push(`Viewer: ${output.viewerId}`);
  lines.push(`Semantics generated: ${output.semanticsGeneratedAt}`);
  lines.push(`Status: ${allPassed ? "PASS" : "BLOCKER"}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- categories passed: ${passCount}/${categoryReports.length}`);
  lines.push(`- posting visible in profile: ${report.postingProbe.visibleInProfile}`);
  lines.push(`- posting visible in feed: ${report.postingProbe.visibleInFeed}`);
  lines.push(`- posting visible in map: ${report.postingProbe.visibleInMap}`);
  lines.push("");
  lines.push("## Category Matrix");
  lines.push("");
  for (const category of categoryReports) {
    lines.push(`### ${category.label} — \`${category.pass ? "PASS" : "BLOCKER"}\``);
    for (const status of category.statuses) {
      lines.push(`- \`${status.route}\` — \`${status.classification}\` — ${status.scenario}`);
    }
    lines.push("");
  }
  await fs.writeFile(outputMarkdownPath, lines.join("\n"));

  console.log(
    JSON.stringify(
      {
        status: allPassed ? "PASS" : "BLOCKER",
        passCount,
        totalCategories: categoryReports.length,
        postingProbe: report.postingProbe
      },
      null,
      2
    )
  );

  if (!allPassed) {
    process.exit(1);
  }
}

await main();
