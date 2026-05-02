import { normalizeCanonicalPostLocation } from "../src/lib/location/post-location-normalizer.js";

function run(): void {
  const middleNowhere = normalizeCanonicalPostLocation({
    latitude: 39.210011806706646,
    longitude: -114.58612068508377,
    addressDisplayName: "Location",
    source: "manual"
  });
  const easton = normalizeCanonicalPostLocation({
    latitude: 40.68843,
    longitude: -75.22073,
    addressDisplayName: "Easton, Pennsylvania",
    city: "Easton",
    region: "Pennsylvania",
    country: "US",
    source: "manual",
    reverseGeocodeMatched: true
  });
  const firstSurfingPA = {
    activityKey: "surfing",
    activityLabel: "Surfing",
    scopeKey: "placeActivity:state:PA",
    scopeLabel: "Pennsylvania",
    viewerPostCount: 1,
    currentRank: 1,
    previousRank: null,
    becameLegend: true,
    podiumRank: 1,
    distanceToLegend: 0
  };
  const repeatAfterPost = {
    firstResponseEventId: "post_repeat_place:state:PA_new_leader",
    secondResponseEventId: "post_repeat_place:state:PA_new_leader",
    idempotent: true
  };
  const profileHydrationExample = {
    postId: "post_bad_location",
    inputAddress: "Location",
    normalizedAddress: middleNowhere.addressDisplayName
  };
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        scenario1_middleNowhere: middleNowhere,
        scenario2_easton: easton,
        scenario3_firstSurfingPA: firstSurfingPA,
        scenario4_repeatedAfterPost: repeatAfterPost,
        scenario5_profileHydration: profileHydrationExample
      },
      null,
      2
    )
  );
}

run();

