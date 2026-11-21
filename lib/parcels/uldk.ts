import "server-only";
import { wktToGeoJSON } from "@terraformer/wkt";
import turfArea from "@turf/area";
import turfBbox from "@turf/bbox";
import pointOnFeature from "@turf/point-on-feature";
import type { MultiPolygon, Polygon } from "geojson";
import { cached, createCache, fetchWithTimeout } from "@/lib/server/cache";
import type { ParcelFeature } from "./types";

/**
 * GUGiK ULDK (Usługa Lokalizacji Działek Katastralnych), https://uldk.gugik.gov.pl/opis.html
 *
 * Plain-text responses: the first line is a status ("0" or a result count for
 * success, "-1 <message>" for no result or an error), then one line per parcel
 * with the requested fields joined by "|". With srid=4326 coordinates are lon lat.
 */
const ULDK_URL = "https://uldk.gugik.gov.pl/";
const FIELDS = ["geom_wkt", "teryt", "voivodeship", "county", "commune", "region", "parcel"] as const;
const TIMEOUT_MS = 12_000;
const MAX_RESULTS = 25;

export class UldkError extends Error {}

const cache = createCache<ParcelFeature[]>({ ttlMs: 24 * 3600_000, maxEntries: 2000 });

async function callUldk(params: Record<string, string>): Promise<ParcelFeature[]> {
  const url = new URL(ULDK_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("result", FIELDS.join(","));
  url.searchParams.set("srid", "4326");

  let text: string;
  try {
    const res = await fetchWithTimeout(url, TIMEOUT_MS);
    if (!res.ok) throw new UldkError(`ULDK HTTP ${res.status}`);
    text = await res.text();
  } catch (error) {
    if (error instanceof UldkError) throw error;
    throw new UldkError("ULDK did not respond in time");
  }

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0 || lines[0].startsWith("-1")) return [];

  return lines
    .slice(1, MAX_RESULTS + 1)
    .map(parseLine)
    .filter((f): f is ParcelFeature => f !== null);
}

function parseLine(line: string): ParcelFeature | null {
  const [geomWkt, id, voivodeship, county, commune, precinct, number] = line.split("|");
  if (!geomWkt || !id) return null;
  try {
    const geometry = wktToGeoJSON(geomWkt.replace(/^SRID=\d+;/i, "")) as Polygon | MultiPolygon;
    if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") return null;
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
  } catch {
    return null;
  }
}

/** Parcel under a WGS84 point. */
export function getParcelAt(lon: number, lat: number) {
  const key = `xy:${lon.toFixed(6)},${lat.toFixed(6)}`;
  return cached(cache, key, () =>
    callUldk({ request: "GetParcelByXY", xy: `${lon},${lat},4326` })
  );
}

/** Full TERYT id (040308_5.0004.26212/4) or "<obręb name> <number>" (Przyłubie 26212/4). */
export function searchParcels(query: string) {
  const q = query.trim().replace(/\s+/g, " ");
  return cached(cache, `q:${q.toLowerCase()}`, () =>
    callUldk({ request: "GetParcelByIdOrNr", id: q })
  );
}

/** Exact lookup by full TERYT id; used server-side so analysis never trusts client geometry. */
export async function getParcelById(id: string) {
  const results = await searchParcels(id);
  return results.find(p => p.properties.id === id) ?? null;
}
