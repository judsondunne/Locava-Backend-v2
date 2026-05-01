import { beforeEach, describe, expect, it, vi } from "vitest";

const firestoreCollectionGetMock = vi.fn();
const firestoreDocGetMock = vi.fn();
const firestoreDocUpdateMock = vi.fn().mockResolvedValue(undefined);

vi.mock("../../repositories/source-of-truth/firestore-client.js", () => ({
  getFirestoreSourceClient: () => ({
    collection: (name: string) => {
      if (name === "audio") {
        return {
          get: firestoreCollectionGetMock,
          doc: () => ({
            get: firestoreDocGetMock,
            update: firestoreDocUpdateMock,
          }),
        };
      }
      return {
        doc: () => ({
          get: firestoreDocGetMock,
          update: firestoreDocUpdateMock,
        }),
      };
    },
  }),
}));

describe("PostingAudioService", () => {
  beforeEach(() => {
    firestoreCollectionGetMock.mockReset();
    firestoreDocGetMock.mockReset();
    firestoreDocUpdateMock.mockReset();
    firestoreDocUpdateMock.mockResolvedValue(undefined);
  });

  it("lists songs from the shared audio collection with search filtering", async () => {
    firestoreCollectionGetMock.mockResolvedValue({
      docs: [
        {
          id: "song-1",
          data: () => ({
            nameOfSong: "Late Night Drive",
            Author: "The Artist",
            mediaLink: "https://cdn.example.com/song-1.mp3",
            displayPhoto: "https://cdn.example.com/song-1.jpg",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            genre: ["Pop"],
          }),
        },
        {
          id: "song-2",
          data: () => ({
            nameOfSong: "Morning Hike",
            Author: "Another Artist",
            mediaLink: "https://cdn.example.com/song-2.mp3",
            displayPhoto: "https://cdn.example.com/song-2.jpg",
            createdAt: new Date("2025-01-01T00:00:00.000Z"),
            genre: ["Country"],
          }),
        },
      ],
    });

    const { PostingAudioService } = await import("./posting-audio.service.js");
    const service = new PostingAudioService();
    const result = await service.listSongs({ page: 1, limit: 10, search: "late", genre: "Pop" });

    expect(result.total).toBe(1);
    expect(result.audio[0]?.id).toBe("song-1");
    expect(result.audio[0]?.nameOfSong).toBe("Late Night Drive");
  });

  it("enriches recordings and updates usage stats for the published post", async () => {
    firestoreDocGetMock.mockResolvedValue({
      exists: true,
      data: () => ({
        authorName: "Catalog Artist",
        Author: "Catalog Artist",
        displayPhoto: "https://cdn.example.com/song.jpg",
        mediaLink: "https://cdn.example.com/song.mp3",
        nameOfSong: "Catalog Song",
        duration: 187,
        genre: ["Pop"],
        usageCount: 2,
        avgSelectedStartMs: 4000,
        avgSelectedEndMs: 18000,
      }),
    });

    const { PostingAudioService } = await import("./posting-audio.service.js");
    const service = new PostingAudioService();
    const enriched = await service.enrichRecordingsForPublish([
      { id: "songCatalogId-1710000000000", startTime: 12, endTime: 27, mainSong: true },
    ]);

    expect(enriched[0]?.audioId).toBe("songCatalogId");
    expect(enriched[0]?.nameOfSong).toBe("Catalog Song");
    expect(enriched[0]?.authorName).toBe("Catalog Artist");
    expect(enriched[0]?.downloadURL).toBe("https://cdn.example.com/song.mp3");

    await service.recordUsageForPublishedPost({
      recordings: enriched,
      activities: ["hike"],
      postId: "post_123",
    });

    expect(firestoreDocUpdateMock).toHaveBeenCalledTimes(1);
    expect(firestoreDocUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        avgSelectedStartMs: 6667,
        avgSelectedEndMs: 21000,
      })
    );
  });
});
