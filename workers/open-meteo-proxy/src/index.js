/**
 * Open-Meteo forwarder on Cloudflare Workers.
 *
 * The free Open-Meteo API limits requests per IP per day. At a hackathon venue
 * everyone shares one IP, so our few requests were refused. The app sends its
 * Open-Meteo calls here instead, from Cloudflare's network:
 *
 *   GET https://<worker>/<PROXY_KEY>/https://archive-api.open-meteo.com/v1/archive?…
 *
 * Only GET requests to Open-Meteo hosts are forwarded, and only with the secret
 * key in the path, so this is not a public relay. Successful responses are kept
 * in Cloudflare's cache: past date ranges for a day, recent ones for an hour.
 */
const ALLOWED_HOSTS = new Set([
  "archive-api.open-meteo.com",
  "api.open-meteo.com",
  "historical-forecast-api.open-meteo.com"
]);

const DAY_S = 86_400;

function cacheSeconds(target) {
  const end = target.searchParams.get("end_date");
  if (target.hostname !== "archive-api.open-meteo.com" || !end) return 3600;
  const ageDays = (Date.now() - Date.parse(`${end}T00:00:00Z`)) / (DAY_S * 1000);
  return ageDays > 7 ? DAY_S : 3600;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });

    const url = new URL(request.url);
    const prefix = `/${env.PROXY_KEY}/`;
    if (!env.PROXY_KEY || !url.pathname.startsWith(prefix)) return new Response("Not found", { status: 404 });

    let target;
    try {
      target = new URL(url.pathname.slice(prefix.length) + url.search);
    } catch {
      return new Response("Bad target URL", { status: 400 });
    }
    if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname)) {
      return new Response("Host not allowed", { status: 403 });
    }

    const cache = caches.default;
    const cacheKey = new Request(target.toString(), { method: "GET" });
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    const upstream = await fetch(target.toString(), { headers: { Accept: "application/json" } });
    const response = new Response(upstream.body, upstream);
    if (upstream.ok) {
      response.headers.set("Cache-Control", `public, max-age=${cacheSeconds(target)}`);
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }
    return response;
  }
};
