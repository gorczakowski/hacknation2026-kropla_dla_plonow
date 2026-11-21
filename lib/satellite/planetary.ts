import "server-only";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { createLimiter, fetchJson } from "@/lib/server/http";

/**
 * Sentinel-2 L2A from Microsoft Planetary Computer: a STAC catalogue plus a
 * data API that computes zonal statistics server-side for a GeoJSON polygon.
 * One stats call costs ~0.5 s and a few kB, instead of downloading 1024² COG
 * tiles per band (tens of seconds from Earth Search's us-west-2 bucket).
 * No account needed.
 */
const STAC_SEARCH = "https://planetarycomputer.microsoft.com/api/stac/v1/search";
const ITEM_STATS = "https://planetarycomputer.microsoft.com/api/data/v1/item/statistics";
const COLLECTION = "sentinel-2-l2a";

const limit = createLimiter(8);

export type Scene = { id: string; date: string; cloud: number; baseline: string | null };
export type Window = { from: string; to: string };
type ParcelFeature = Feature<Polygon | MultiPolygon>;

type SearchResponse = {
  features: { id: string; properties: Record<string, unknown> }[];
  links?: { rel: string; href: string; method?: string; body?: unknown }[];
};

/** One search for all windows (CQL2 OR of intervals), scene cloud cover below maxCloud. */
export async function searchScenes(feature: ParcelFeature, windows: Window[], maxCloud: number, signal: AbortSignal) {
  const body = {
    collections: [COLLECTION],
    intersects: feature.geometry,
    "filter-lang": "cql2-json",
    filter: {
      op: "and",
      args: [
        { op: "<", args: [{ property: "eo:cloud_cover" }, maxCloud] },
        {
          op: "or",
          args: windows.map(w => ({
            op: "t_intersects",
            args: [{ property: "datetime" }, { interval: [`${w.from}T00:00:00Z`, `${w.to}T23:59:59Z`] }]
          }))
        }
      ]
    },
    limit: 1000,
    fields: {
      include: ["id", "properties.datetime", "properties.eo:cloud_cover", "properties.s2:processing_baseline"],
      exclude: ["assets", "links", "geometry", "bbox"]
    }
  };
  const res = await limit(() =>
    fetchJson<SearchResponse>(STAC_SEARCH, {
      timeoutMs: 10_000,
      signal,
      init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    })
  );
  return res.features.map(
    (f): Scene => ({
      id: f.id,
      date: String(f.properties.datetime).slice(0, 10),
      cloud: Number(f.properties["eo:cloud_cover"] ?? 100),
      baseline: typeof f.properties["s2:processing_baseline"] === "string" ? (f.properties["s2:processing_baseline"] as string) : null
    })
  );
}

type Stat = { histogram: [number[], number[]]; median: number; mean: number; count: number };
type StatsResponse = { properties?: { statistics?: Record<string, Stat> } };

async function itemStats(scene: Scene, query: string, feature: ParcelFeature, signal: AbortSignal) {
  const url = `${ITEM_STATS}?collection=${COLLECTION}&item=${encodeURIComponent(scene.id)}&${query}`;
  const res = await limit(() =>
    fetchJson<StatsResponse>(url, {
      timeoutMs: 10_000,
      signal,
      init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(feature) }
    })
  );
  return Object.values(res.properties?.statistics ?? {});
}

/** SCL classes counted as a clear view of the ground: 4 vegetation, 5 bare soil, 6 water. */
const CLEAR_SCL = new Set([4, 5, 6]);

export async function sceneClearShare(scene: Scene, feature: ParcelFeature, signal: AbortSignal) {
  const [scl] = await itemStats(scene, "assets=SCL&categorical=true", feature, signal);
  if (!scl) return { clearShare: 0, pixels: 0 };
  const [counts, classes] = scl.histogram;
  let total = 0;
  let clear = 0;
  classes.forEach((cls, i) => {
    if (cls === 0) return; // no data
    total += counts[i];
    if (CLEAR_SCL.has(cls)) clear += counts[i];
  });
  return { clearShare: total ? clear / total : 0, pixels: total };
}

/**
 * Processing baseline 04.00 (from 25 Jan 2022) adds 1000 to every L2A digital
 * number. Subtracting it keeps indices comparable across years.
 */
function offsetFor(scene: Scene) {
  if (scene.baseline) return scene.baseline >= "04.00" ? 1000 : 0;
  return scene.date >= "2022-01-25" ? 1000 : 0;
}

export async function sceneIndices(scene: Scene, feature: ParcelFeature, signal: AbortSignal) {
  const o2 = 2 * offsetFor(scene);
  const ndvi = `(B08_b1*1.0-B04_b1)/(B08_b1*1.0+B04_b1-${o2})`;
  const ndmi = `(B8A_b1*1.0-B11_b1)/(B8A_b1*1.0+B11_b1-${o2})`;
  const [n, m] = await itemStats(scene, `expression=${encodeURIComponent(`${ndvi};${ndmi}`)}`, feature, signal);
  const round = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000);
  return { ndvi: round(n?.median), ndmi: round(m?.median), pixels: n?.count ?? 0 };
}
