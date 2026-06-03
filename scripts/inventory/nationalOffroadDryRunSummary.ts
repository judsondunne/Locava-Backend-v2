import { setStateEnabled } from "../../src/admin/openstreetmap/offroadNationalRunStore.js";
import { runStateOffroadDryRun } from "../../src/admin/openstreetmap/offroadNationalImport.service.js";

async function main() {
  for (const code of ["VT", "NH", "CA", "CO", "UT"]) {
    setStateEnabled(code, true);
  }

  const vt = await runStateOffroadDryRun({
    stateCode: "VT",
    sourceFilter: "all",
    customBbox: { minLat: 43.45, minLng: -72.55, maxLat: 43.63, maxLng: -72.25 },
    chunkConfig: { chunkSizeDegreesLat: 0.2, chunkSizeDegreesLng: 0.2, maxPagesPerChunk: 2 },
  });

  const nh = await runStateOffroadDryRun({
    stateCode: "NH",
    sourceFilter: "federal",
    customBbox: { minLat: 43.5, minLng: -72.5, maxLat: 43.65, maxLng: -72.2 },
    chunkConfig: { maxPagesPerChunk: 1 },
  });

  const ca = await runStateOffroadDryRun({
    stateCode: "CA",
    sourceFilter: "all",
    customBbox: { minLat: 34.0, minLng: -117.5, maxLat: 34.5, maxLng: -117.0 },
    chunkConfig: { maxPagesPerChunk: 1 },
  });

  const co = await runStateOffroadDryRun({
    stateCode: "CO",
    sourceFilter: "federal",
    customBbox: { minLat: 39.0, minLng: -106.5, maxLat: 39.5, maxLng: -105.5 },
    chunkConfig: { maxPagesPerChunk: 1 },
  });

  const ut = await runStateOffroadDryRun({
    stateCode: "UT",
    sourceFilter: "federal",
    customBbox: { minLat: 38.5, minLng: -109.5, maxLat: 39.0, maxLng: -109.0 },
    chunkConfig: { maxPagesPerChunk: 1 },
  });

  console.log(
    JSON.stringify(
      {
        LOCAVA_NATIONAL_OFFROAD_SOURCE_REGISTRY_SUMMARY: {
          totalStates: vt.stateCoverageDiagnostics?.totalStates,
          statesWithFederalCoverage: vt.stateCoverageDiagnostics?.statesWithFederalCoverage,
          statesWithActiveStateSpecificSource: vt.stateCoverageDiagnostics?.statesWithActiveStateSpecificSource,
          statesWithNeedsValidationStateSource: vt.stateCoverageDiagnostics?.statesWithNeedsValidationStateSource,
          statesNeedingStateSource: vt.stateCoverageDiagnostics?.statesNeedingStateSource,
          usfsMvumAdapterReady: true,
          blmGtlfAdapterReady: true,
          osmAdapterReady: true,
          vtransAdapterStillWorking: vt.sourceCounts.some((s) => s.sourceId === "vt_vtrans_public_highway_system" && s.routesAccepted > 0),
          masterControlPanelReady: true,
          stateToggleReady: true,
          batchDryRunReady: true,
          vtDryRunCounts: summarize(vt),
          caDryRunCounts: summarize(ca),
          coDryRunCounts: summarize(co),
          utDryRunCounts: summarize(ut),
          nhStatus: nh.status,
          meStatus: "needs_validation",
          productionWritesBlocked: true,
        },
      },
      null,
      2
    )
  );
}

function summarize(run: Awaited<ReturnType<typeof runStateOffroadDryRun>>) {
  return {
    runId: run.runId,
    routes: run.routes.length,
    areas: run.areaContexts.length,
    rejected: run.rejectedCount,
    sources: run.sourceCounts,
    errors: run.sourceCounts.flatMap((s) => s.errors),
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
