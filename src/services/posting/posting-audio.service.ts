import { FieldValue } from "firebase-admin/firestore";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";

export type PostingSongCatalogItem = {
  id: string;
  mediaLink: string;
  displayPhoto: string;
  authorName?: string;
  Author: string;
  nameOfSong: string;
  postsUsing: string[];
  createdAt: Date | null;
  userId: string;
  duration?: number;
  suggestedStartPoint?: number;
  description?: string;
  tags?: string[];
  genre?: string[] | string;
  moods?: string[];
  themes?: string[];
  instrumentation?: string[];
  energyLevel?: string;
};

type PostingSongsQuery = {
  page?: number;
  limit?: number;
  search?: string;
  genre?: string;
};

type AudioDocShape = Record<string, unknown>;

const CACHE_TTL_MS = 5 * 60 * 1000;

let audioCatalogCache:
  | {
      items: PostingSongCatalogItem[];
      fetchedAt: number;
    }
  | null = null;

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function ensureStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => (typeof entry === "string" ? entry.split(",") : String(entry)))
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function convertTimestampLike(input: unknown): Date | null {
  if (!input) return null;
  if (input instanceof Date) return input;
  if (typeof input === "object" && input && "toDate" in input && typeof (input as { toDate?: unknown }).toDate === "function") {
    try {
      return ((input as { toDate: () => Date }).toDate() ?? null) as Date | null;
    } catch {
      return null;
    }
  }
  if (typeof input === "number" && Number.isFinite(input)) return new Date(input);
  return null;
}

function toAuthorLabel(data: AudioDocShape): string {
  const preferred =
    (typeof data.authorName === "string" && data.authorName.trim()) ||
    (typeof data.Author === "string" && data.Author.trim()) ||
    (typeof data.author === "string" && data.author.trim()) ||
    "";
  return preferred;
}

function transformAudioDoc(id: string, data: AudioDocShape): PostingSongCatalogItem {
  const author = toAuthorLabel(data);
  return {
    id,
    mediaLink: typeof data.mediaLink === "string" ? data.mediaLink : "",
    displayPhoto: typeof data.displayPhoto === "string" ? data.displayPhoto : "",
    authorName: typeof data.authorName === "string" ? data.authorName : undefined,
    Author: author,
    nameOfSong: typeof data.nameOfSong === "string" ? data.nameOfSong : "",
    postsUsing: Array.isArray(data.postsUsing) ? data.postsUsing.filter((value): value is string => typeof value === "string") : [],
    createdAt: convertTimestampLike(data.createdAt),
    userId: typeof data.userId === "string" ? data.userId : "",
    duration: typeof data.duration === "number" ? data.duration : undefined,
    suggestedStartPoint:
      typeof data.suggestedStartPoint === "number" ? data.suggestedStartPoint : undefined,
    description: typeof data.description === "string" ? data.description : undefined,
    tags: ensureStringArray(data.tags),
    genre:
      Array.isArray(data.genre) || typeof data.genre === "string"
        ? (data.genre as string[] | string)
        : undefined,
    moods: ensureStringArray(data.moods),
    themes: ensureStringArray(data.themes),
    instrumentation: ensureStringArray(data.instrumentation),
    energyLevel: typeof data.energyLevel === "string" ? data.energyLevel : undefined
  };
}

function buildMockAudioCatalog(): PostingSongCatalogItem[] {
  const genres = ["Pop", "Country", "Rap", "Rock", "Jazz", "Electronic"];
  return Array.from({ length: 24 }, (_, index) => ({
    id: `mock-audio-${index + 1}`,
    mediaLink: `https://cdn.locava.test/audio/mock-${index + 1}.mp3`,
    displayPhoto: `https://cdn.locava.test/audio/mock-${index + 1}.jpg`,
    Author: `Mock Artist ${index + 1}`,
    authorName: `Mock Artist ${index + 1}`,
    nameOfSong: `Mock Song ${index + 1}`,
    postsUsing: [],
    createdAt: new Date(Date.now() - index * 60_000),
    userId: "mock-user",
    duration: 180 + index,
    genre: genres[index % genres.length],
    moods: ["Chill"],
    themes: ["Adventure"],
    instrumentation: ["Guitar"],
    energyLevel: "Medium"
  }));
}

async function loadAudioCatalog(): Promise<PostingSongCatalogItem[]> {
  if (audioCatalogCache && Date.now() - audioCatalogCache.fetchedAt < CACHE_TTL_MS) {
    return audioCatalogCache.items;
  }

  const db = getFirestoreSourceClient();
  if (!db) {
    const items = buildMockAudioCatalog();
    audioCatalogCache = { items, fetchedAt: Date.now() };
    return items;
  }

  const snapshot = await db.collection("audio").get();
  const items = snapshot.docs.map((doc) => transformAudioDoc(doc.id, (doc.data() ?? {}) as AudioDocShape));
  items.sort((left, right) => {
    const leftTime = left.createdAt?.getTime() ?? 0;
    const rightTime = right.createdAt?.getTime() ?? 0;
    return rightTime - leftTime;
  });
  audioCatalogCache = { items, fetchedAt: Date.now() };
  return items;
}

function matchesSearch(song: PostingSongCatalogItem, search: string): boolean {
  const normalized = normalizeText(search);
  if (!normalized) return true;
  const fields = [
    song.nameOfSong,
    song.Author,
    song.authorName,
    song.description,
    ...(song.tags ?? []),
    ...ensureStringArray(song.genre),
    ...(song.moods ?? []),
    ...(song.themes ?? []),
    ...(song.instrumentation ?? []),
    song.energyLevel
  ];
  return fields.some((field) => normalizeText(field).includes(normalized));
}

function matchesGenre(song: PostingSongCatalogItem, genre: string): boolean {
  const normalized = normalizeText(genre);
  if (!normalized) return true;
  const genres = ensureStringArray(song.genre).map((value) => normalizeText(value));
  return genres.includes(normalized);
}

function sanitizeRecordingId(recordingId: unknown): string {
  const raw = typeof recordingId === "string" || typeof recordingId === "number" ? String(recordingId).trim() : "";
  if (!raw) return "";
  const match = raw.match(/^(.*)-(\d{10,})$/);
  return match?.[1]?.trim() || raw;
}

function normalizeRecordingPosition(recording: Record<string, unknown>): { x: number; y: number } {
  const position =
    recording.position && typeof recording.position === "object" ? (recording.position as Record<string, unknown>) : null;
  const x = typeof position?.x === "number" ? position.x : typeof recording.x === "number" ? recording.x : 50;
  const y = typeof position?.y === "number" ? position.y : typeof recording.y === "number" ? recording.y : 50;
  return { x, y };
}

function enrichRecording(recording: Record<string, unknown>, audio: PostingSongCatalogItem | null): Record<string, unknown> {
  if (!audio) return recording;
  const position = normalizeRecordingPosition(recording);
  const authorLabel = audio.authorName?.trim() || audio.Author || "Unknown Artist";
  return {
    ...recording,
    audioId: audio.id,
    id: recording.id,
    Author: authorLabel,
    author: authorLabel,
    authorName: authorLabel,
    displayPhoto: audio.displayPhoto || recording.displayPhoto || null,
    mediaLink: audio.mediaLink || recording.mediaLink || null,
    downloadURL:
      (typeof recording.downloadURL === "string" && recording.downloadURL.trim()) ||
      audio.mediaLink ||
      (typeof recording.mediaLink === "string" ? recording.mediaLink : null),
    nameOfSong: audio.nameOfSong || recording.nameOfSong || null,
    duration: audio.duration ?? recording.duration ?? null,
    genre: audio.genre ?? recording.genre ?? null,
    suggestedStartPoint: audio.suggestedStartPoint ?? recording.suggestedStartPoint ?? null,
    startTime: typeof recording.startTime === "number" ? recording.startTime : 0,
    endTime: typeof recording.endTime === "number" ? recording.endTime : 0,
    mainSong: recording.mainSong === true,
    index: typeof recording.index === "number" ? recording.index : 0,
    type: typeof recording.type === "string" ? recording.type : "left",
    x: position.x,
    y: position.y,
    position
  };
}

export class PostingAudioService {
  async listSongs(query: PostingSongsQuery): Promise<{
    audio: PostingSongCatalogItem[];
    total: number;
    page: number;
    limit: number;
  }> {
    const safePage = Math.max(1, Math.floor(query.page ?? 1));
    const safeLimit = Math.min(Math.max(Math.floor(query.limit ?? 50), 1), 100);
    const all = await loadAudioCatalog();
    const filtered = all.filter((song) => matchesSearch(song, query.search ?? "") && matchesGenre(song, query.genre ?? ""));
    const total = filtered.length;
    const startIndex = (safePage - 1) * safeLimit;
    return {
      audio: filtered.slice(startIndex, startIndex + safeLimit),
      total,
      page: safePage,
      limit: safeLimit
    };
  }

  async enrichRecordingsForPublish(recordings: unknown[]): Promise<Record<string, unknown>[]> {
    if (!Array.isArray(recordings) || recordings.length === 0) return [];
    const normalizedRecordings = recordings.filter(
      (recording): recording is Record<string, unknown> => Boolean(recording && typeof recording === "object")
    );
    const db = getFirestoreSourceClient();
    let byId = new Map<string, PostingSongCatalogItem>();
    if (db) {
      const audioIds = [...new Set(normalizedRecordings.map((recording) => sanitizeRecordingId(recording.id)).filter(Boolean))];
      const entries = await Promise.all(
        audioIds.map(async (audioId) => {
          const snapshot = await db.collection("audio").doc(audioId).get();
          if (!snapshot.exists) return null;
          return [audioId, transformAudioDoc(audioId, (snapshot.data() ?? {}) as AudioDocShape)] as const;
        })
      );
      byId = new Map(entries.filter((entry): entry is readonly [string, PostingSongCatalogItem] => entry != null));
    } else {
      const audioCatalog = await loadAudioCatalog();
      byId = new Map(audioCatalog.map((song) => [song.id, song] as const));
    }
    return normalizedRecordings
      .filter((recording): recording is Record<string, unknown> => Boolean(recording && typeof recording === "object"))
      .map((recording) => {
        const audioId = sanitizeRecordingId(recording.id);
        const audio = audioId ? byId.get(audioId) ?? null : null;
        return enrichRecording(recording, audio);
      });
  }

  async recordUsageForPublishedPost(input: {
    recordings: unknown[];
    activities: string[];
    postId: string;
  }): Promise<void> {
    if (!Array.isArray(input.recordings) || input.recordings.length === 0 || !input.postId) return;
    const db = getFirestoreSourceClient();
    if (!db) return;

    const activities = input.activities.map((value) => String(value ?? "").trim()).filter(Boolean);
    await Promise.all(
      input.recordings.map(async (recording) => {
        if (!recording || typeof recording !== "object") return;
        const row = recording as Record<string, unknown>;
        const audioId = sanitizeRecordingId(row.audioId ?? row.id);
        if (!audioId) return;
        const audioRef = db.collection("audio").doc(audioId);
        const snapshot = await audioRef.get();
        if (!snapshot.exists) return;
        const audioData = (snapshot.data() ?? {}) as AudioDocShape;
        const startTimeMs =
          typeof row.startTime === "number" && Number.isFinite(row.startTime) ? Math.round(row.startTime * 1000) : 0;
        const endTimeMs =
          typeof row.endTime === "number" && Number.isFinite(row.endTime) ? Math.round(row.endTime * 1000) : 0;
        const currentUsageCount =
          typeof audioData.usageCount === "number" && Number.isFinite(audioData.usageCount) ? audioData.usageCount : 0;
        const newUsageCount = currentUsageCount + 1;
        const oldAvgStart =
          typeof audioData.avgSelectedStartMs === "number" && Number.isFinite(audioData.avgSelectedStartMs)
            ? audioData.avgSelectedStartMs
            : 0;
        const oldAvgEnd =
          typeof audioData.avgSelectedEndMs === "number" && Number.isFinite(audioData.avgSelectedEndMs)
            ? audioData.avgSelectedEndMs
            : 0;
        const nextUpdate: Record<string, unknown> = {
          usageCount: FieldValue.increment(1),
          avgSelectedStartMs: Math.round((oldAvgStart * currentUsageCount + startTimeMs) / newUsageCount),
          avgSelectedEndMs: Math.round((oldAvgEnd * currentUsageCount + endTimeMs) / newUsageCount),
          recentUsage30d: FieldValue.increment(1),
          postsUsing: FieldValue.arrayUnion(input.postId)
        };
        if (activities.length > 0) {
          nextUpdate.popularWithActivities = FieldValue.arrayUnion(...activities);
        }
        await audioRef.update(nextUpdate);
      })
    );
  }
}
