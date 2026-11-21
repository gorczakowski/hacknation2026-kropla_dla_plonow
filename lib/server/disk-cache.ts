import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/** Where fetched source data is kept between runs (gitignored). */
export const CACHE_DIR = process.env.DATA_CACHE_DIR || path.join(process.cwd(), ".cache");

type Stored<T> = { savedAt: number; key: string; value: T };

const inflight = new Map<string, Promise<{ value: unknown; savedAt: number }>>();

/**
 * JSON cache on disk. It survives restarts, so a repeat run for the same parcel
 * and day does not call the upstream services again (rate limits, slow WCS).
 * Concurrent loads of one key share a single upstream call. Failed loads are
 * not stored. Returns when the value was fetched, for the report's dates.
 */
export async function diskCached<T>(
  namespace: string,
  key: string,
  ttlMs: number,
  load: () => Promise<T>
): Promise<{ value: T; savedAt: number }> {
  const file = path.join(CACHE_DIR, namespace, `${createHash("sha1").update(key).digest("hex")}.json`);
  try {
    const stored = JSON.parse(await readFile(file, "utf8")) as Stored<T>;
    if (Date.now() - stored.savedAt < ttlMs) return { value: stored.value, savedAt: stored.savedAt };
  } catch {
    // Not cached yet, or unreadable: load it.
  }

  const pending = inflight.get(file);
  if (pending) return pending as Promise<{ value: T; savedAt: number }>;

  const task = (async () => {
    const value = await load();
    const savedAt = Date.now();
    try {
      await mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${savedAt}.tmp`;
      await writeFile(tmp, JSON.stringify({ savedAt, key, value } satisfies Stored<T>));
      await rename(tmp, file);
    } catch {
      // A read-only disk only costs us the cache.
    }
    return { value, savedAt };
  })().finally(() => inflight.delete(file));

  inflight.set(file, task);
  return task;
}

export const HOUR = 3600_000;
export const DAY = 24 * HOUR;
