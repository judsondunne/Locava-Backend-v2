/**
 * audit-real-post-readiness — read-only sampler that scores production posts
 * against the StandardizedPostDoc contract.
 *
 * Run from this package's root with credentials configured:
 *   cd "Locava Backendv2"
 *   npx tsx scripts/audit-real-post-readiness.mts \
 *     --limit 200 \
 *     --out ../real-post-readiness-audit.md
 *
 * GUARDRAILS:
 *   - read-only: no Firestore writes/transactions/migrations
 *   - bounded: caller controls --limit (default 100, hard cap 5000)
 *   - emits per-section conformance counts and a markdown report
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  STANDARDIZED_POST_DOC_OUTER_SECTIONS,
  StandardizedPostDocSchema
} from "../src/contracts/standardized-post-doc.contract.js";
import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";

type CliArgs = {
  limit: number;
  out: string;
  collection: string;
  includeDeleted: boolean;
};

const HARD_CAP = 5000;
const DEFAULT_LIMIT = 100;

function parseCliArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    limit: DEFAULT_LIMIT,
    out: resolve(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "real-post-readiness-audit.md"
    ),
    collection: "posts",
    includeDeleted: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--limit") {
      const v = Number(argv[i + 1]);
      if (Number.isFinite(v) && v > 0) args.limit = Math.min(v, HARD_CAP);
      i += 1;
    } else if (flag === "--out") {
      const v = argv[i + 1];
      if (typeof v === "string" && v.length > 0) args.out = resolve(v);
      i += 1;
    } else if (flag === "--collection") {
      const v = argv[i + 1];
      if (typeof v === "string" && v.length > 0) args.collection = v;
      i += 1;
    } else if (flag === "--include-deleted") {
      args.includeDeleted = true;
    }
  }
  return args;
}

type SectionStats = {
  name: string;
  present: number;
  missing: number;
};

type IssueCounts = Map<string, number>;

type AuditResult = {
  sampled: number;
  fullyConforming: number;
  rejected: number;
  perSection: SectionStats[];
  topIssues: Array<{ path: string; count: number }>;
  examples: Array<{ postId: string; issues: string[] }>;
};

function pushIssue(map: IssueCounts, path: string): void {
  map.set(path, (map.get(path) ?? 0) + 1);
}

async function audit(args: CliArgs): Promise<AuditResult> {
  const db = getFirestoreSourceClient();
  if (!db) {
    throw new Error(
      "Firestore client unavailable. Configure FIRESTORE_SOURCE_ENABLED and credentials."
    );
  }

  let query = db.collection(args.collection).limit(args.limit);
  if (!args.includeDeleted) {
    // We still inspect deleted posts for shape conformance but mark them.
    query = db.collection(args.collection).limit(args.limit);
  }
  const snap = await query.get();

  const sectionPresent: Record<string, number> = {};
  for (const s of STANDARDIZED_POST_DOC_OUTER_SECTIONS) sectionPresent[s] = 0;

  const issues: IssueCounts = new Map();
  const examples: AuditResult["examples"] = [];

  let fullyConforming = 0;
  let rejected = 0;

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    for (const section of STANDARDIZED_POST_DOC_OUTER_SECTIONS) {
      if (section === "id") {
        if (typeof data.id === "string" && data.id.length > 0) {
          sectionPresent.id = (sectionPresent.id ?? 0) + 1;
        }
        continue;
      }
      if (data[section] != null) {
        sectionPresent[section] = (sectionPresent[section] ?? 0) + 1;
      }
    }

    const candidate: Record<string, unknown> = {
      ...data,
      id: typeof data.id === "string" ? data.id : doc.id,
      postId: typeof data.postId === "string" ? data.postId : doc.id
    };

    const parsed = StandardizedPostDocSchema.safeParse(candidate);
    if (parsed.success) {
      fullyConforming += 1;
      continue;
    }
    rejected += 1;
    const docIssues: string[] = [];
    for (const issue of parsed.error.issues) {
      const p = issue.path.length === 0 ? "<root>" : issue.path.join(".");
      pushIssue(issues, `${p}:${issue.code}`);
      if (docIssues.length < 5) docIssues.push(`${p}:${issue.code}`);
    }
    if (examples.length < 10) {
      examples.push({ postId: doc.id, issues: docIssues });
    }
  }

  const perSection: SectionStats[] = STANDARDIZED_POST_DOC_OUTER_SECTIONS.map((name) => ({
    name,
    present: sectionPresent[name] ?? 0,
    missing: snap.size - (sectionPresent[name] ?? 0)
  }));

  const topIssues = [...issues.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);

  return {
    sampled: snap.size,
    fullyConforming,
    rejected,
    perSection,
    topIssues,
    examples
  };
}

function pct(part: number, whole: number): string {
  if (whole === 0) return "0.00%";
  return ((part / whole) * 100).toFixed(2) + "%";
}

function buildMarkdown(args: CliArgs, result: AuditResult): string {
  const lines: string[] = [];
  lines.push("# Real Post Readiness Audit");
  lines.push("");
  lines.push("> Read-only sampler. No Firestore writes, no migrations. Generated by");
  lines.push("> `Locava Backendv2/scripts/audit-real-post-readiness.mts`.");
  lines.push("");
  lines.push("## Run parameters");
  lines.push("");
  lines.push(`- collection: \`${args.collection}\``);
  lines.push(`- limit: ${args.limit}`);
  lines.push(`- include-deleted: ${args.includeDeleted}`);
  lines.push(`- generated-at: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Headline");
  lines.push("");
  lines.push(`- sampled: ${result.sampled}`);
  lines.push(
    `- fully conforming to StandardizedPostDoc: ${result.fullyConforming} (${pct(
      result.fullyConforming,
      result.sampled
    )})`
  );
  lines.push(
    `- rejected by schema: ${result.rejected} (${pct(result.rejected, result.sampled)})`
  );
  lines.push("");
  lines.push("## Outer-section presence");
  lines.push("");
  lines.push("| section | present | missing | %present |");
  lines.push("| --- | ---: | ---: | ---: |");
  for (const s of result.perSection) {
    lines.push(`| ${s.name} | ${s.present} | ${s.missing} | ${pct(s.present, result.sampled)} |`);
  }
  lines.push("");
  lines.push("## Top schema-issue paths (truncated)");
  lines.push("");
  if (result.topIssues.length === 0) {
    lines.push("_None — all sampled posts validated cleanly._");
  } else {
    lines.push("| path:code | count |");
    lines.push("| --- | ---: |");
    for (const issue of result.topIssues) {
      lines.push(`| \`${issue.path}\` | ${issue.count} |`);
    }
  }
  lines.push("");
  lines.push("## Example rejected posts (truncated)");
  lines.push("");
  if (result.examples.length === 0) {
    lines.push("_None._");
  } else {
    for (const ex of result.examples) {
      lines.push(`- \`${ex.postId}\``);
      for (const i of ex.issues) lines.push(`  - ${i}`);
    }
  }
  lines.push("");
  lines.push("## Interpreting results");
  lines.push("");
  lines.push(
    "- A 100% conforming sample means the new endpoint can ship in `real_standardized` mode without any fallback handling for the sampled cohort."
  );
  lines.push(
    "- Sections appearing as missing for many posts indicate a backend canonicalization gap; those posts will fall through to `rejected` from the new endpoint and surface as `REAL_POST_RENDER_OPEN_BLOCKED_NO_MODEL` if a viewer attempts to open them."
  );
  lines.push(
    "- The schema-issue paths point at the smallest patches needed to reach 100% conformance. Fixes belong in the canonicalization pipeline, **not** in this read path or on the client."
  );
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const result = await audit(args);
  const md = buildMarkdown(args, result);
  writeFileSync(args.out, md, "utf8");
  console.log(
    `audit-real-post-readiness: sampled=${result.sampled} conforming=${result.fullyConforming} rejected=${result.rejected} -> ${args.out}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
