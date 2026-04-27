import { scheduleBackgroundWork } from "../lib/background-work.js";
import { globalCache } from "./global-cache.js";

const MAX_KEYS_PER_TAG = 256;
const MAX_INVALIDATE_KEYS = 128;

function tagIndexKey(tag: string): string {
  return `route-tag-index:${tag}`;
}

function keyIndexKey(key: string): string {
  return `route-key-tags:${key}`;
}

async function readStringList(key: string): Promise<string[]> {
  return (await globalCache.get<string[]>(key)) ?? [];
}

async function writeStringList(key: string, values: string[]): Promise<void> {
  await globalCache.set(key, values, 60 * 60 * 1000);
}

export async function registerRouteCacheKey(key: string, tags: string[]): Promise<void> {
  const cleanedTags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
  if (!cleanedTags.length) return;

  const keyTags = new Set(await readStringList(keyIndexKey(key)));
  for (const tag of cleanedTags) {
    keyTags.add(tag);
    const keys = new Set(await readStringList(tagIndexKey(tag)));
    keys.add(key);
    if (keys.size > MAX_KEYS_PER_TAG) {
      const oldest = keys.values().next().value as string | undefined;
      if (oldest) {
        keys.delete(oldest);
      }
    }
    await writeStringList(tagIndexKey(tag), [...keys]);
  }
  await writeStringList(keyIndexKey(key), [...keyTags]);
}

export async function invalidateRouteCacheByTags(
  tags: string[],
  options: { deferIndexCleanup?: boolean } = {}
): Promise<string[]> {
  const cleanedTags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
  if (!cleanedTags.length) return [];

  const keysToInvalidate = new Set<string>();
  const tagKeyLists = await Promise.all(cleanedTags.map((tag) => readStringList(tagIndexKey(tag))));
  for (const tagKeys of tagKeyLists) {
    for (const key of tagKeys) {
      keysToInvalidate.add(key);
      if (keysToInvalidate.size >= MAX_INVALIDATE_KEYS) break;
    }
    if (keysToInvalidate.size >= MAX_INVALIDATE_KEYS) break;
  }
  const invalidateList = [...keysToInvalidate];
  await Promise.all(invalidateList.map((key) => globalCache.del(key)));

  if (options.deferIndexCleanup) {
    scheduleBackgroundWork(async () => {
      await cleanupRouteCacheIndexForKeys(invalidateList);
    });
    return invalidateList;
  }

  await cleanupRouteCacheIndexForKeys(invalidateList);
  return invalidateList;
}

async function cleanupRouteCacheIndexForKeys(invalidateList: string[]): Promise<void> {
  for (const key of invalidateList) {
    const mappedTags = await readStringList(keyIndexKey(key));
    for (const tag of mappedTags) {
      const set = new Set(await readStringList(tagIndexKey(tag)));
      set.delete(key);
      if (set.size === 0) {
        await globalCache.del(tagIndexKey(tag));
      } else {
        await writeStringList(tagIndexKey(tag), [...set]);
      }
    }
    await globalCache.del(keyIndexKey(key));
  }
}
