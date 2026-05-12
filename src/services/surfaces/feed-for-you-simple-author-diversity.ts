import type { SimpleFeedCandidate } from "../../repositories/surfaces/feed-for-you-simple.repository.js";

export type AuthorDiversityOptions = {
  limit: number;
  lastAuthorId: string | null;
  recentAuthorIds: ReadonlySet<string>;
  maxPerAuthorPerPage?: number;
  avoidBackToBack?: boolean;
};

export type AuthorDiversityResult = {
  items: SimpleFeedCandidate[];
  sameAuthorAdjacentCount: number;
  maxAuthorPageCount: number;
  authorDiversityApplied: boolean;
};

export function diversifyByAuthor(
  candidates: SimpleFeedCandidate[],
  input: AuthorDiversityOptions
): AuthorDiversityResult {
  const maxPerAuthor = Math.max(1, input.maxPerAuthorPerPage ?? 2);
  const avoidBackToBack = input.avoidBackToBack !== false;
  const pool = [...candidates];
  const items: SimpleFeedCandidate[] = [];
  const pageAuthorCount = new Map<string, number>();
  let sameAuthorAdjacentCount = 0;
  let authorDiversityApplied = false;

  const previousAuthor = (): string | null =>
    items.length > 0 ? items[items.length - 1]?.authorId ?? null : input.lastAuthorId;

  const hasAlternativeAuthor = (blockedAuthor: string | null): boolean => {
    if (!blockedAuthor) return pool.length > 0;
    return pool.some((candidate) => candidate.authorId !== blockedAuthor);
  };

  while (items.length < input.limit && pool.length > 0) {
    let pickedIndex = -1;
    const prev = previousAuthor();
    for (let index = 0; index < pool.length; index += 1) {
      const candidate = pool[index];
      if (!candidate) continue;
      const authorId = candidate.authorId;
      if ((pageAuthorCount.get(authorId) ?? 0) >= maxPerAuthor) continue;
      if (avoidBackToBack && prev && authorId === prev && hasAlternativeAuthor(prev)) continue;
      if (input.recentAuthorIds.has(authorId) && hasAlternativeAuthor(authorId)) {
        const fresher = pool.find((row) => !input.recentAuthorIds.has(row.authorId));
        if (fresher && fresher.authorId !== authorId) continue;
      }
      pickedIndex = index;
      break;
    }
    if (pickedIndex < 0) break;
    const [picked] = pool.splice(pickedIndex, 1);
    if (!picked) break;
    if (avoidBackToBack && previousAuthor() && picked.authorId === previousAuthor()) {
      sameAuthorAdjacentCount += 1;
    } else if (pickedIndex > 0) {
      authorDiversityApplied = true;
    }
    pageAuthorCount.set(picked.authorId, (pageAuthorCount.get(picked.authorId) ?? 0) + 1);
    items.push(picked);
  }

  if (items.length < input.limit) {
    for (let index = 0; index < pool.length && items.length < input.limit; index += 1) {
      const candidate = pool[index];
      if (!candidate) continue;
      if ((pageAuthorCount.get(candidate.authorId) ?? 0) >= maxPerAuthor) continue;
      items.push(candidate);
      pageAuthorCount.set(candidate.authorId, (pageAuthorCount.get(candidate.authorId) ?? 0) + 1);
      pool.splice(index, 1);
      index -= 1;
      authorDiversityApplied = true;
    }
  }

  let maxAuthorPageCount = 0;
  for (const count of pageAuthorCount.values()) {
    maxAuthorPageCount = Math.max(maxAuthorPageCount, count);
  }

  return {
    items,
    sameAuthorAdjacentCount,
    maxAuthorPageCount,
    authorDiversityApplied
  };
}
