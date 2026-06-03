/**
 * Read-only quota dry-run verification.
 * Run: npx tsx scripts/inventory/pbfQuotaVerify.ts
 */
import path from "node:path";
import { dryRunPbfFirstAccepted } from "../../src/admin/openstreetmap/national/pbfCopier/pbfCopierService.js";
import { DEFAULT_VERMONT_PBF_PATH } from "../../src/admin/openstreetmap/national/pbfCopier/pbfCopierPathHelpers.js";
import { quotasAreMet } from "../../src/admin/openstreetmap/national/pbfCopier/pbfCopierDryRunQuotas.js";

const PBF = path.resolve(process.cwd(), DEFAULT_VERMONT_PBF_PATH);
const quotas = { beach: 3, hiking_route: 2 };

async function main() {
  console.log("Quota dry-run:", quotas);
  const run = await dryRunPbfFirstAccepted({
    filePath: PBF,
    config: {
      filePath: PBF,
      stateCode: "VT",
      dryRunStopMode: "quotas",
      dryRunQuotas: quotas,
      maxAcceptedMode: false,
      balancedPreview: false,
      dryRunLimit: 9999,
    },
  });

  const progress = run.dryRunQuotaProgress ?? {};
  const met = quotasAreMet(quotas, progress);
  console.log("status:", run.status);
  console.log("lastError:", run.lastError);
  console.log("scanStopReason:", run.scanStopReason);
  console.log("quotaProgress:", progress);
  console.log("quotasMet:", met);
  console.log("docsPreviewed:", run.metrics.docsPreviewed);
  console.log("acceptedSpots:", run.metrics.acceptedSpots, "acceptedRoutes:", run.metrics.acceptedRoutes);
  console.log("rejected:", run.metrics.rejected);
  console.log("waysScanned:", run.metrics.waysScanned);

  if (!met) {
    console.error("FAIL: quotas not met at stop");
    process.exit(1);
  }
  console.log("PASS: quota dry-run stopped after filling all targets");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
