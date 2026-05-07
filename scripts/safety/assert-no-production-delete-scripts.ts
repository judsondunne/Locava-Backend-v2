import { collectViolations, runDestructiveFirestoreScan } from "./destructive-firestore-scan.js";

const scan = runDestructiveFirestoreScan();
const violations = collectViolations(scan);

if (violations.length > 0) {
  console.error("Destructive Firestore safety violations detected:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log("No destructive Firestore production-delete script violations detected.");
}
