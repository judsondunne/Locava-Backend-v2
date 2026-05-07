/**
 * Scans service source trees for direct Firebase Admin / modular getFirestore usage
 * outside canonical wrapper files. Fails CI when new unlisted paths appear.
 *
 * Usage: npm run audit:firebase-containment
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const SCAN_ROOTS = [
  path.join(repoRoot, "Locava Backendv2", "src"),
  path.join(repoRoot, "Locava Backend", "src"),
  path.join(repoRoot, "Locava Web", "src")
] as const;

const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]);

/** Canonical init/wrapper modules only — everything else must stay in baseline or be fixed. */
const CANONICAL_ALLOWLIST = new Set<string>([
  "Locava Backendv2/src/lib/firebase-admin.ts",
  "Locava Backend/src/config/firebase.ts",
  "Locava Backend/src/config/firebaseTracked.ts",
  "Locava Web/src/config/firebase.js",
  "Locava Web/src/config/firebase-admin.js"
]);

const RE_FIREBASE_ADMIN_PKG =
  /from\s+["']firebase-admin["']|import\s+admin\s+from\s+["']firebase-admin["']/;

const RE_FIREBASE_ADMIN_APP = /from\s+["']firebase-admin\/app["']/;

const RE_GETFIRESTORE_ADMIN =
  /import\s*\{[^}]*\bgetFirestore\b[^}]*\}\s*from\s*["']firebase-admin\/firestore["']/;

const RE_GETFIRESTORE_CLIENT =
  /import\s*\{[^}]*\bgetFirestore\b[^}]*\}\s*from\s*["']firebase\/firestore["']/;

const RE_REQUIRE_GETFIRESTORE_ADMIN =
  /require\s*\(\s*["']firebase-admin\/firestore["']\s*\)/;

type Finding = {
  repoPath: string;
  line: number;
  rule: string;
  text: string;
};

function toRepoPosixPath(absFile: string): string {
  return path.relative(repoRoot, absFile).split(path.sep).join("/");
}

async function loadBaseline(): Promise<Set<string>> {
  const baselinePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "firebase-read-containment-audit.baseline.txt"
  );
  const raw = await fs.readFile(baselinePath, "utf8");
  const set = new Set<string>();
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    set.add(t.replace(/\\/g, "/"));
  }
  return set;
}

async function* walkFiles(dir: string): AsyncGenerator<string> {
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === "dist" || ent.name === ".git") continue;
      yield* walkFiles(abs);
    } else if (ent.isFile()) {
      const ext = path.extname(ent.name);
      if (SOURCE_EXT.has(ext)) yield abs;
    }
  }
}

function classifyLine(line: string, lineNo: number, repoPath: string, findings: Finding[]): void {
  const trimmed = line.trim();
  if (trimmed.startsWith("//")) return;

  if (/^\s*import\s+type\s+/.test(line)) {
    if (RE_FIREBASE_ADMIN_PKG.test(line)) return;
    if (RE_FIREBASE_ADMIN_APP.test(line)) return;
  }

  if (RE_FIREBASE_ADMIN_PKG.test(line)) {
    findings.push({ repoPath, line: lineNo, rule: "firebase-admin package", text: trimmed });
  }
  if (RE_FIREBASE_ADMIN_APP.test(line)) {
    findings.push({ repoPath, line: lineNo, rule: "firebase-admin/app", text: trimmed });
  }
  if (RE_GETFIRESTORE_ADMIN.test(line)) {
    findings.push({ repoPath, line: lineNo, rule: "getFirestore (firebase-admin/firestore)", text: trimmed });
  }
  if (RE_GETFIRESTORE_CLIENT.test(line)) {
    findings.push({ repoPath, line: lineNo, rule: "getFirestore (firebase/firestore)", text: trimmed });
  }
}

function multilineImportFindings(content: string, repoPath: string): Finding[] {
  const out: Finding[] = [];
  /** Brace-limited so we do not span from one import statement to the next. */
  const patterns: { re: RegExp; rule: string }[] = [
    {
      re: /import\s*\{[^}]*\bgetFirestore\b[^}]*\}\s*from\s*["']firebase\/firestore["']/g,
      rule: "getFirestore (firebase/firestore)"
    },
    {
      re: /import\s*\{[^}]*\bgetFirestore\b[^}]*\}\s*from\s*["']firebase-admin\/firestore["']/g,
      rule: "getFirestore (firebase-admin/firestore)"
    }
  ];
  for (const { re, rule } of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const line = content.slice(0, m.index).split(/\r?\n/).length;
      if (!out.some((f) => f.repoPath === repoPath && f.line === line && f.rule === rule)) {
        out.push({ repoPath, line, rule, text: "(multiline import)" });
      }
    }
  }
  return out;
}

async function scanFile(absPath: string): Promise<Finding[]> {
  const repoPath = toRepoPosixPath(absPath);
  const findings: Finding[] = [];
  try {
    const content = await fs.readFile(absPath, "utf8");
    const lines = content.split(/\r?\n/);
    lines.forEach((line, i) => classifyLine(line, i + 1, repoPath, findings));
    for (const extra of multilineImportFindings(content, repoPath)) {
      if (!findings.some((f) => f.line === extra.line && f.rule === extra.rule)) {
        findings.push(extra);
      }
    }
    if (
      RE_REQUIRE_GETFIRESTORE_ADMIN.test(content) &&
      !CANONICAL_ALLOWLIST.has(repoPath)
    ) {
      findings.push({
        repoPath,
        line: 0,
        rule: "require(firebase-admin/firestore)",
        text: "(dynamic require — check manually)"
      });
    }
  } catch {
    return findings;
  }
  return findings;
}

async function main(): Promise<void> {
  const baseline = await loadBaseline();
  const allowed = new Set<string>([...CANONICAL_ALLOWLIST, ...baseline]);

  const allFindings: Finding[] = [];
  for (const root of SCAN_ROOTS) {
    for await (const file of walkFiles(root)) {
      allFindings.push(...(await scanFile(file)));
    }
  }

  const violations = allFindings.filter((f) => !allowed.has(f.repoPath));

  const rows = allFindings
    .sort((a, b) => a.repoPath.localeCompare(b.repoPath) || a.line - b.line)
    .map(
      (f) =>
        `| ${f.repoPath} | ${f.line || "—"} | ${f.rule} | ${allowed.has(f.repoPath) ? "allowlisted" : "**NEW**"} |`
    );

  console.log("# Firebase read containment — direct Firebase surface audit\n");
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log(`Repo root: ${repoRoot}\n`);
  console.log("| File | Line | Rule | Status |");
  console.log("| --- | --- | --- | --- |");
  for (const row of rows) console.log(row);
  console.log("");
  console.log(`Summary: ${allFindings.length} finding(s), ${violations.length} unallowlisted.`);

  if (violations.length > 0) {
    console.error("\nUnallowlisted Firebase direct usage:");
    for (const v of violations) {
      console.error(`  - ${v.repoPath}:${v.line} ${v.rule}`);
    }
    console.error(
      "\nFix: route through a canonical wrapper, or add a one-line entry to scripts/firebase-read-containment-audit.baseline.txt with justification."
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
