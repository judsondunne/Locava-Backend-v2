type CheckResult = { ok: boolean; message: string };

function assertCheck(ok: boolean, message: string): CheckResult {
  return { ok, message };
}

async function run() {
  const distanceKm = (aLat: number, aLng: number, bLat: number, bLng: number): number => {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const x =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 6371 * (2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
  };

  const base = process.env.MIXES_DEBUG_BASE_URL ?? "http://127.0.0.1:3000";
  const viewerId = process.env.MIXES_DEBUG_VIEWER_ID ?? "internal-viewer";
  const roleHeader = process.env.MIXES_DEBUG_VIEWER_ROLES ?? "internal";
  const burlington = { lat: 44.476, lng: -73.212, radiusKm: 12 };
  const headers: Record<string, string> = {
    "x-viewer-id": viewerId,
    "x-viewer-roles": roleHeader,
  };

  const tests = [
    `${base}/v2/mixes/hiking/preview?activity=hiking&limit=3`,
    `${base}/v2/mixes/nearby/preview?lat=${burlington.lat}&lng=${burlington.lng}&radiusKm=${burlington.radiusKm}&limit=3`,
    `${base}/v2/mixes/hiking-nearby/preview?activity=hiking&lat=${burlington.lat}&lng=${burlington.lng}&radiusKm=${burlington.radiusKm}&limit=3`,
    `${base}/v2/mixes/hiking/page?activity=hiking&limit=5`,
    `${base}/v2/mixes/nearby/page?lat=${burlington.lat}&lng=${burlington.lng}&radiusKm=${burlington.radiusKm}&limit=5`,
    `${base}/v2/mixes/none/page?activity=zzzzzz-does-not-exist&limit=5`,
  ];

  for (const url of tests) {
    const res = await fetch(url, { headers });
    const json = await res.json().catch(() => ({}));
    const data = json?.data ?? json;
    const checks: CheckResult[] = [];
    checks.push(assertCheck(res.status === 200, `status=200 (${res.status})`));
    checks.push(assertCheck(data?.ok === true, "ok=true"));
    checks.push(assertCheck(Array.isArray(data?.posts), "posts is array"));
    if (data?.posts) {
      checks.push(assertCheck(data.posts.every((p: any) => p && typeof p.postId === "string"), "all posts have postId"));
      checks.push(assertCheck(new Set(data.posts.map((p: any) => p.postId)).size === data.posts.length, "no duplicate postIds in page"));
    }
    if (url.includes("radiusKm=") && Array.isArray(data?.posts)) {
      const u = new URL(url);
      const lat = Number(u.searchParams.get("lat"));
      const lng = Number(u.searchParams.get("lng"));
      const radiusKm = Number(u.searchParams.get("radiusKm"));
      let missingCoordinates = 0;
      let outsideRadius = 0;
      for (const post of data.posts) {
        const pLat = typeof post?.geo?.lat === "number" ? post.geo.lat : null;
        const pLng = typeof post?.geo?.lng === "number" ? post.geo.lng : null;
        if (pLat == null || pLng == null) {
          missingCoordinates += 1;
          continue;
        }
        const d = distanceKm(lat, lng, pLat, pLng);
        if (!(Number.isFinite(d) && d <= radiusKm)) outsideRadius += 1;
      }
      checks.push(assertCheck(outsideRadius === 0, `radius truth: outsideRadius=${outsideRadius}`));
      checks.push(assertCheck(true, `radius truth: missingCoordinates=${missingCoordinates}`));
    }

    if (url.includes("/preview?")) {
      checks.push(assertCheck((data?.posts?.length ?? 0) <= 3, "preview length <= 3"));
    }
    if (url.includes("none/page")) {
      checks.push(assertCheck((data?.posts?.length ?? 0) === 0, "empty mix has no posts"));
      checks.push(assertCheck(data?.hasMore === false, "empty mix hasMore=false"));
    }
    const failed = checks.filter((c) => !c.ok);
    const prefix = failed.length === 0 ? "PASS" : "FAIL";
    console.log(`${prefix} ${url}`);
    for (const c of checks) {
      console.log(`  - ${c.ok ? "ok" : "x"} ${c.message}`);
    }
    if (data?.diagnostics) {
      console.log(
        `  diagnostics route=${data.diagnostics.routeName} returned=${data.diagnostics.returnedCount} candidates=${data.diagnostics.candidateCount} source=${data.diagnostics.source} cacheHit=${data.diagnostics.cacheHit}`
      );
    }
  }
}

run().catch((error) => {
  console.error("debug-mixes-v2 failed", error);
  process.exitCode = 1;
});
