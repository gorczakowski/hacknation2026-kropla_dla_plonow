import "server-only";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: string
  ) {
    super(message);
  }
}

type Options = { timeoutMs: number; signal?: AbortSignal; init?: RequestInit };

function combinedSignal({ timeoutMs, signal }: Options) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/*
 * Optional forwarding proxies, for networks where public APIs throttle the shared
 * IP (a hackathon venue). The target URL is appended: <proxy>/https://host/path?query.
 *   OPEN_METEO_PROXY  Open-Meteo hosts (the Cloudflare Worker in workers/open-meteo-proxy)
 *   UPSTREAM_PROXY    every other upstream service
 * Unset: requests go straight to the services. Planetary Computer always goes
 * direct (it uses POST, which the upstream proxy does not forward).
 */
const DIRECT_HOSTS = new Set(["planetarycomputer.microsoft.com"]);

const base = (value: string | undefined) => value?.trim().replace(/\/+$/, "") || null;

function proxyFor(host: string): string | null {
  if (DIRECT_HOSTS.has(host)) return null;
  if (host === "open-meteo.com" || host.endsWith(".open-meteo.com")) {
    return base(process.env.OPEN_METEO_PROXY) ?? base(process.env.UPSTREAM_PROXY);
  }
  return base(process.env.UPSTREAM_PROXY);
}

/** The URL to request: through the configured proxy for this host, or the URL itself. */
export function upstreamUrl(url: string): string {
  const proxy = proxyFor(new URL(url).host);
  return proxy ? `${proxy}/${url}` : url;
}

export function upstreamFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(upstreamUrl(url), init);
}

/** fetch with a timeout and the analysis' abort signal; throws HttpError on non-2xx. */
export async function fetchOk(url: string, options: Options): Promise<Response> {
  const res = await upstreamFetch(url, { ...options.init, signal: combinedSignal(options) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new HttpError(res.status, `${new URL(url).host} HTTP ${res.status}`, body.slice(0, 300));
  }
  return res;
}

export async function fetchJson<T>(url: string, options: Options): Promise<T> {
  return (await (await fetchOk(url, options)).json()) as T;
}

export async function fetchBuffer(url: string, options: Options): Promise<ArrayBuffer> {
  return (await fetchOk(url, options)).arrayBuffer();
}

/** Runs at most `max` tasks at once; used to stay polite with public services. */
export function createLimiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>(resolve => queue.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}
