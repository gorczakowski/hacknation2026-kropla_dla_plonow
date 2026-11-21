import "server-only";
import { cached, createCache, fetchWithTimeout } from "@/lib/server/cache";
import type { Place } from "./types";

/**
 * Photon geocoder (komoot), https://photon.komoot.io/ — OpenStreetMap data, ODbL.
 * The public instance is free for fair use: we debounce in the browser, cache
 * here, and send an identifying User-Agent without personal data.
 */
const PHOTON_URL = "https://photon.komoot.io";
const USER_AGENT = "zatrzymaj-wode/0.1 (HackNation 2026 prototype)";
const TIMEOUT_MS = 8_000;
/** Poland, for Photon's bbox filter: west, south, east, north. */
const PL_BBOX = "14.07,49.0,24.15,54.9";
const PLACE_KINDS = ["city", "town", "village", "hamlet"] as const;

export class PhotonError extends Error {}

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_type?: string;
    osm_id?: number;
    osm_key?: string;
    osm_value?: string;
    name?: string;
    postcode?: string;
    county?: string;
    state?: string;
    countrycode?: string;
    /** [minLon, maxLat, maxLon, minLat] */
    extent?: [number, number, number, number];
  };
};

const cache = createCache<PhotonFeature[]>({ ttlMs: 7 * 24 * 3600_000, maxEntries: 2000 });

async function photon(path: "/api/" | "/reverse", params: [string, string][]): Promise<PhotonFeature[]> {
  const url = new URL(path, PHOTON_URL);
  for (const [k, v] of params) url.searchParams.append(k, v);
  return cached(cache, url.search, async () => {
    let res: Response;
    try {
      res = await fetchWithTimeout(url, TIMEOUT_MS, { headers: { "User-Agent": USER_AGENT } });
    } catch {
      throw new PhotonError("Photon did not respond in time");
    }
    if (!res.ok) throw new PhotonError(`Photon HTTP ${res.status}`);
    const body = (await res.json()) as { features?: PhotonFeature[] };
    return body.features ?? [];
  });
}

const placeTags = (): [string, string][] => PLACE_KINDS.map(k => ["osm_tag", `place:${k}`]);

function toExtent(extent: PhotonFeature["properties"]["extent"]): Place["extent"] {
  if (!extent) return null;
  const [minLon, maxLat, maxLon, minLat] = extent;
  return [minLon, minLat, maxLon, maxLat];
}

function toPlace(f: PhotonFeature): Place | null {
  const p = f.properties;
  const kind = PLACE_KINDS.find(k => k === p.osm_value);
  if (!kind || !p.name || p.countrycode !== "PL") return null;
  const [lon, lat] = f.geometry.coordinates;
  return {
    id: `${p.osm_type ?? "X"}${p.osm_id ?? `${lon},${lat}`}`,
    name: p.name,
    kind,
    postcode: p.postcode ?? null,
    county: p.county ?? null,
    voivodeship: p.state ?? null,
    lon,
    lat,
    extent: toExtent(p.extent)
  };
}

function uniquePlaces(places: (Place | null)[]): Place[] {
  const seen = new Set<string>();
  return places.filter((p): p is Place => {
    if (!p) return false;
    const key = `${p.name}|${p.postcode}|${p.county}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Towns and villages whose name matches (Photon handles prefixes and missing diacritics). */
export async function searchPlacesByName(query: string): Promise<Place[]> {
  const features = await photon("/api/", [
    ["q", query],
    ["limit", "20"],
    ["bbox", PL_BBOX],
    ...placeTags()
  ]);
  return uniquePlaces(features.map(toPlace));
}

function distanceKm([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

/**
 * Towns and villages with a postcode. Photon knows the postcode as an area, not
 * which places use it, so we take the area and list the places inside it
 * (reverse search), keeping those tagged with this postcode, plus untagged
 * places inside the area (small towns often carry no postcode tag in OSM).
 */
export async function searchPlacesByPostcode(postcode: string) {
  const [area] = (
    await photon("/api/", [
      ["q", postcode],
      ["limit", "3"],
      ["bbox", PL_BBOX],
      ["osm_tag", "place:postcode"]
    ])
  ).filter(f => f.properties.name === postcode && f.properties.countrycode === "PL");
  if (!area) return { area: null, places: [] as Place[] };

  const extent = toExtent(area.properties.extent);
  const center = area.geometry.coordinates;
  const radiusKm = extent
    ? Math.min(30, Math.max(3, distanceKm([extent[0], extent[1]], [extent[2], extent[3]]) / 2 + 1))
    : 6;

  const nearby = await photon("/reverse", [
    ["lon", String(center[0])],
    ["lat", String(center[1])],
    ["radius", radiusKm.toFixed(1)],
    ["limit", "50"],
    ...placeTags()
  ]);

  const inside = (p: Place) =>
    !!extent && p.lon >= extent[0] && p.lon <= extent[2] && p.lat >= extent[1] && p.lat <= extent[3];

  const places = uniquePlaces(nearby.map(toPlace))
    .filter(p => p.postcode === postcode || (!p.postcode && inside(p)))
    .sort((a, b) => a.name.localeCompare(b.name, "pl"));

  return { area: extent, places };
}
