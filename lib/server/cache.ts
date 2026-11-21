/**
 * Small in-memory TTL cache for upstream responses (ULDK, later Open-Meteo,
 * Copernicus...). Good enough for a single Node process; swap for Redis when
 * the app runs on more than one instance.
 */
type Entry<T> = { value: T; expires: number };

export function createCache<T>({ ttlMs, maxEntries }: { ttlMs: number; maxEntries: number }) {
  const store = new Map<string, Entry<T>>();

  return {
    get(key: string): T | undefined {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (entry.expires < Date.now()) {
        store.delete(key);
        return undefined;
      }
      // Refresh recency (Map keeps insertion order).
      store.delete(key);
      store.set(key, entry);
      return entry.value;
    },
    set(key: string, value: T) {
      store.set(key, { value, expires: Date.now() + ttlMs });
      while (store.size > maxEntries) {
        const oldest = store.keys().next().value;
        if (oldest === undefined) break;
        store.delete(oldest);
      }
    }
  };
}

/** Memoises an async loader by key; failed loads are not cached. */
export function cached<T>(
  cache: ReturnType<typeof createCache<T>>,
  key: string,
  load: () => Promise<T>
): Promise<T> {
  const hit = cache.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  return load().then(value => {
    cache.set(key, value);
    return value;
  });
}

export async function fetchWithTimeout(url: string | URL, timeoutMs: number, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
