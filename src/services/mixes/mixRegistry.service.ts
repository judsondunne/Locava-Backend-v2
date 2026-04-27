export type MixDefinition = {
  id: string;
  type:
    | "nearby"
    | "activity"
    | "location_activity"
    | "location_general"
    | "daily"
    | "friends"
    | "trending"
    | "suggested";
  title: string;
  subtitle?: string;
  seed: {
    kind: "activity_query" | "friends" | "daily";
    query?: string;
  };
  activityFilters?: string[];
  locationLabel?: string;
  locationConstraint?: {
    stateRegionId?: string;
    cityRegionId?: string;
    center?: { lat: number; lng: number };
    maxDistanceMiles?: number;
  };
};

const DEFAULT_BASE_ACTIVITIES: Array<{ activity: string; title: string }> = [
  { activity: "hiking", title: "Hikes Near You" },
  { activity: "swimming", title: "Swimming Spots Near You" },
  { activity: "coffee", title: "Coffee Near You" },
  { activity: "food", title: "Food Near You" },
  { activity: "sunset", title: "Scenic Spots Near You" },
  { activity: "waterfall", title: "Weekend Spots Near You" },
];

export class MixRegistryService {
  buildBootstrapMixes(): MixDefinition[] {
    const mixes: MixDefinition[] = [
      {
        id: "nearby:near_you",
        type: "nearby",
        title: "Near You",
        subtitle: "Great spots nearby",
        seed: { kind: "activity_query", query: "near me" },
        locationLabel: "Near you",
      },
      {
        id: "nearby:popular_near_you",
        type: "trending",
        title: "Popular Near You",
        subtitle: "Trending posts nearby",
        seed: { kind: "activity_query", query: "popular near me" },
        locationLabel: "Near you",
      },
      {
        id: "daily:for_you",
        type: "daily",
        title: "Daily Mix",
        subtitle: "Picks based on your activities nearby",
        seed: { kind: "daily" },
        locationLabel: "Near you",
      },
      {
        id: "friends:from_people_you_follow",
        type: "friends",
        title: "Friends Mix",
        subtitle: "Recent posts from people you follow",
        seed: { kind: "friends" },
      },
    ];

    for (const def of DEFAULT_BASE_ACTIVITIES) {
      mixes.push({
        id: `activity:${def.activity}`,
        type: "activity",
        title: def.title,
        subtitle: `Top ${def.activity} posts near you`,
        seed: { kind: "activity_query", query: `${def.activity} near me` },
        activityFilters: [def.activity],
        locationLabel: "Near you",
      });
    }

    // Ensure at least 8 mixes; fill with additional activity mixes that are broadly useful.
    const fillers = ["restaurants", "beach", "park", "mountain", "trail"];
    for (const activity of fillers) {
      if (mixes.length >= 8) break;
      mixes.push({
        id: `activity:${activity}`,
        type: "activity",
        title: `${activity.charAt(0).toUpperCase()}${activity.slice(1)} Near You`,
        subtitle: `Top ${activity} posts near you`,
        seed: { kind: "activity_query", query: `${activity} near me` },
        activityFilters: [activity],
        locationLabel: "Near you",
      });
    }

    return mixes.slice(0, 12);
  }
}

