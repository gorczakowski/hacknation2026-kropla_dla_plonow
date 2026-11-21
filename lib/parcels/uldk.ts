import "server-only";
import { wktToGeoJSON } from "@terraformer/wkt";
import turfArea from "@turf/area";
import turfBbox from "@turf/bbox";
import pointOnFeature from "@turf/point-on-feature";
import type { MultiPolygon, Polygon } from "geojson";
import { cached, createCache, fetchWithTimeout } from "@/lib/server/cache";
import type { ParcelFeature, PrecinctFeature } from "./types";

/**
 * GUGiK ULDK (Usługa Lokalizacji Działek Katastralnych), https://uldk.gugik.gov.pl/opis.html
 *
 * Plain-text responses: the first line is a status ("0" or a result count for
 * success, "-1 <message>" for no result or an error), then one line per object
 * with the requested fields joined by "|". With srid=4326 coordinates are lon lat.
 */
const ULDK_URL = "https://uldk.gugik.gov.pl/";
const PARCEL_FIELDS = ["geom_wkt", "teryt", "voivodeship", "county", "commune", "region", "parcel"];
const PRECINCT_FIELDS = ["geom_wkt", "teryt", "region", "commune", "county", "voivodeship"];
const TIMEOUT_MS = 12_000;
const MAX_RESULTS = 25;

export class UldkError extends Error {}

const parcelCache = createCache<ParcelFeature[]>({ ttlMs: 24 * 3600_000, maxEntries: 2000 });
const precinctCache = createCache<PrecinctFeature | null>({ ttlMs: 24 * 3600_000, maxEntries: 500 });

/** Returns the result lines (status line removed); [] when ULDK found nothing. */
async function callUldk(params: Record<string, string>, fields: string[]): Promise<string[][]> {
  const url = new URL(ULDK_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("result", fields.join(","));
  url.searchParams.set("srid", "4326");

  let text: string;
  try {
    const res = await fetchWithTimeout(url, TIMEOUT_MS);
    if (!res.ok) throw new UldkError(`ULDK HTTP ${res.status}`);
    // When GUGiK throttles an IP it redirects to integracja01.gugik.gov.pl/resp/…,
    // which answers "0" plus megabytes of filler. Treat that as an outage, not "no parcel".
    if (res.redirected && new URL(res.url).pathname.startsWith("/resp/")) {
      await res.body?.cancel();
      throw new UldkError("ULDK throttled this IP");
    }
    text = await res.text();
  } catch (error) {
    if (error instanceof UldkError) throw error;
    throw new UldkError("ULDK did not respond in time");
  }

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0 || lines[0].startsWith("-1")) return [];
  return lines.slice(1, MAX_RESULTS + 1).map(line => line.split("|"));
}

function parseGeometry(wkt: string): Polygon | MultiPolygon | null {
  try {
    const geometry = wktToGeoJSON(wkt.replace(/^SRID=\d+;/i, ""));
    return geometry.type === "Polygon" || geometry.type === "MultiPolygon" ? geometry : null;
  } catch {
    return null;
  }
}

function toParcel([geomWkt, id, voivodeship, county, commune, precinct, number]: string[]): ParcelFeature | null {
  const geometry = geomWkt && id ? parseGeometry(geomWkt) : null;
  if (!geometry) return null;
  const [w, s, e, n] = turfBbox(geometry);
  return {
    type: "Feature",
    id,
    geometry,
    properties: {
      id,
      number: number || id.split(".").pop() || id,
      precinct: precinct ?? "",
      commune: commune ?? "",
      county: county ?? "",
      voivodeship: voivodeship ?? "",
      areaHa: turfArea(geometry) / 10_000,
      labelPoint: pointOnFeature(geometry).geometry.coordinates as [number, number],
      bbox: [w, s, e, n]
    }
  };
}

function toPrecinct([geomWkt, id, name, commune, county, voivodeship]: string[]): PrecinctFeature | null {
  const geometry = geomWkt && id ? parseGeometry(geomWkt) : null;
  if (!geometry) return null;
  const [w, s, e, n] = turfBbox(geometry);
  return {
    type: "Feature",
    id,
    geometry,
    properties: {
      id,
      name: name ?? "",
      commune: commune ?? "",
      county: county ?? "",
      voivodeship: voivodeship ?? "",
      bbox: [w, s, e, n]
    }
  };
}

async function fetchParcels(params: Record<string, string>) {
  const rows = await callUldk(params, PARCEL_FIELDS);
  return rows.map(toParcel).filter((f): f is ParcelFeature => f !== null);
}

/** Parcel under a WGS84 point. */
export function getParcelAt(lon: number, lat: number) {
  const key = `xy:${lon.toFixed(6)},${lat.toFixed(6)}`;
  return cached(parcelCache, key, () => fetchParcels({ request: "GetParcelByXY", xy: `${lon},${lat},4326` }));
}

/** Full TERYT id (040308_5.0004.26212/4) or "<obręb name> <number>" (Przyłubie 26212/4). */
export function searchParcels(query: string) {
  const q = query.trim().replace(/\s+/g, " ");
  return cached(parcelCache, `q:${q.toLowerCase()}`, () => fetchParcels({ request: "GetParcelByIdOrNr", id: q }));
}

/** Exact lookup by full TERYT id; used server-side so analysis never trusts client geometry. */
export async function getParcelById(id: string) {
  const results = await searchParcels(id);
  return results.find(p => p.properties.id === id) ?? null;
}

/**
 * Cadastral precinct (obręb ewidencyjny) under a WGS84 point. In the countryside
 * a precinct is usually one village, so this outlines "the village" on the map.
 */
export function getPrecinctAt(lon: number, lat: number) {
  const key = `${lon.toFixed(5)},${lat.toFixed(5)}`;
  return cached(precinctCache, key, async () => {
    const rows = await callUldk({ request: "GetRegionByXY", xy: `${lon},${lat},4326` }, PRECINCT_FIELDS);
    return rows.length ? toPrecinct(rows[0]) : null;
  });
}
