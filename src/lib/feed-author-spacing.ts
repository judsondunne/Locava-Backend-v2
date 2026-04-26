/**
 * Mirrors legacy `applyAuthorSpacing` (Locava Backend `ranking.service.ts`) for V2 feed cards.
 * Uses `author.userId` as the author key (same as legacy `authorId` on ranked items).
 */
export interface FeedCardSpacingShape {
  postId: string;
  author: { userId: string };
}
const DEFAULT_RECENT_AUTHOR_HISTORY = 6;
const MAX_SPACING_ATTEMPTS = 200;
const MIN_SPACING_BETWEEN_SAME_AUTHOR = 2;

export type AuthorSpacingFeedOptions = {
  spacing: number;
  recentAuthors?: string[];
  historyLimit?: number;
  authorCounts?: Record<string, number>;
};

function authorKey(item: FeedCardSpacingShape): string {
  return String(item.author?.userId ?? "").trim() || "_unknown";
}

export function applyAuthorSpacingToFeedCards<T extends FeedCardSpacingShape>(
  items: T[],
  options: AuthorSpacingFeedOptions
): T[] {
  const spacing = Math.max(1, options.spacing);
  if (spacing <= 1 || items.length <= 1) return items;

  const keys = items.map(authorKey);
  const uniqueAuthors = new Set(keys);
  if (uniqueAuthors.size === 1) return items;

  const historyLimit = options.historyLimit ?? DEFAULT_RECENT_AUTHOR_HISTORY;
  const recentAuthors = new Set(options.recentAuthors ?? []);
  const authorCountMap = new Map<string, number>(
    options.authorCounts ? Object.entries(options.authorCounts) : []
  );
  const queue = [...items];
  const result: T[] = [];
  const servedAuthors: string[] = [];

  let attempts = 0;

  while (queue.length > 0 && attempts < MAX_SPACING_ATTEMPTS) {
    attempts += 1;

    let candidates = queue.filter(
      (item) =>
        !recentAuthors.has(authorKey(item)) &&
        !result.slice(-Math.max(spacing - 1, MIN_SPACING_BETWEEN_SAME_AUTHOR)).some((r) => authorKey(r) === authorKey(item))
    );

    if (candidates.length === 0) {
      candidates = queue.filter(
        (item) =>
          !recentAuthors.has(authorKey(item)) &&
          !result.slice(-MIN_SPACING_BETWEEN_SAME_AUTHOR).some((r) => authorKey(r) === authorKey(item))
      );
    }

    if (candidates.length === 0) {
      candidates = queue.filter(
        (item) => !result.slice(-MIN_SPACING_BETWEEN_SAME_AUTHOR).some((r) => authorKey(r) === authorKey(item))
      );
    }

    if (candidates.length === 0) {
      candidates = [...queue];
    }

    candidates.sort((a, b) => {
      const ka = authorKey(a);
      const kb = authorKey(b);
      const countA = authorCountMap.get(ka) ?? 0;
      const countB = authorCountMap.get(kb) ?? 0;
      if (countA !== countB) return countA - countB;
      const idxA = queue.findIndex((item) => item.postId === a.postId);
      const idxB = queue.findIndex((item) => item.postId === b.postId);
      return idxA - idxB;
    });

    if (candidates.length === 0) {
      const [selected] = queue.splice(0, 1);
      if (!selected) break;
      const k = authorKey(selected);
      result.push(selected);
      servedAuthors.push(k);
      authorCountMap.set(k, (authorCountMap.get(k) ?? 0) + 1);
      recentAuthors.add(k);
      while (recentAuthors.size > historyLimit) {
        const oldest = servedAuthors.shift();
        if (oldest && !servedAuthors.includes(oldest)) recentAuthors.delete(oldest);
      }
      continue;
    }

    const primary = candidates[0];
    if (!primary) {
      const [selected] = queue.splice(0, 1);
      if (!selected) break;
      const k = authorKey(selected);
      result.push(selected);
      servedAuthors.push(k);
      authorCountMap.set(k, (authorCountMap.get(k) ?? 0) + 1);
      recentAuthors.add(k);
      while (recentAuthors.size > historyLimit) {
        const oldest = servedAuthors.shift();
        if (oldest && !servedAuthors.includes(oldest)) recentAuthors.delete(oldest);
      }
      continue;
    }

    const pickIndex = queue.findIndex((item) => item.postId === primary.postId);
    const [selected] = queue.splice(pickIndex === -1 ? 0 : pickIndex, 1);
    if (!selected) break;

    const k = authorKey(selected);
    result.push(selected);
    servedAuthors.push(k);
    authorCountMap.set(k, (authorCountMap.get(k) ?? 0) + 1);
    recentAuthors.add(k);

    if (recentAuthors.size > historyLimit) {
      const recentAuthorsArray = servedAuthors.slice(-historyLimit);
      recentAuthors.clear();
      recentAuthorsArray.forEach((id) => recentAuthors.add(id));
    }
  }

  const finalResult = result.length ? result.concat(queue) : items;
  if (finalResult.length === 0 && items.length > 0) return items;
  return finalResult;
}

/** Default spacing aligned with legacy feed switches (kSpacing ~3). */
export const DEFAULT_FEED_AUTHOR_SPACING = 3;
