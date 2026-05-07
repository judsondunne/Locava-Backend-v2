import { runDestructiveFirestoreScan } from "./destructive-firestore-scan.js";

const scan = runDestructiveFirestoreScan();

console.log("=== Destructive Firestore Audit ===");
for (const entry of [...scan.catalogResults, ...scan.unexpectedResults]) {
  console.log(
    JSON.stringify(
      {
        filePath: entry.filePath,
        scriptNames: entry.scriptNames,
        exactDangerousOperation: entry.exactDangerousOperation,
        touchesPosts: entry.touchesPosts,
        canRunAgainstProduction: entry.canRunAgainstProduction,
        actualAction: entry.actualAction,
        reasons: entry.reasons
      },
      null,
      2
    )
  );
}

console.log("=== Package Script Audit ===");
for (const finding of scan.packageFindings) {
  console.log(
    JSON.stringify(
      {
        scriptName: finding.scriptName,
        status: finding.status,
        reasons: finding.reasons
      },
      null,
      2
    )
  );
}
