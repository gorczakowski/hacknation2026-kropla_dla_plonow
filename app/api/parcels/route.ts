import { NextResponse, type NextRequest } from "next/server";
import { getParcelAt, searchParcels, UldkError } from "@/lib/parcels/uldk";
import type { ParcelsResponse } from "@/lib/parcels/types";

// Rough bounding box of Poland with a margin; outside it ULDK has nothing.
const PL = { west: 13.8, south: 48.9, east: 24.4, north: 55.1 };

function json(body: ParcelsResponse, status = 200) {
  return NextResponse.json(body, { status });
}

function inPoland(lon: number, lat: number) {
  return lon >= PL.west && lon <= PL.east && lat >= PL.south && lat <= PL.north;
}

/** "53.05, 18.3" or "53.05 18.3" → [lat, lon] */
function parseCoordinates(q: string): [number, number] | null {
  const m = q.match(/^\s*(-?\d{1,2}(?:[.]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.]\d+)?)\s*$/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  // Accept either order; in Poland latitude (49–55) is always larger than longitude (14–24).
  return a > b ? [a, b] : [b, a];
}

/**
 * GET /api/parcels?q=<TERYT id | obręb + numer | "lat, lon">
 * GET /api/parcels?lon=<lon>&lat=<lat>
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const q = params.get("q")?.trim();

  try {
    if (q) {
      if (q.length > 120) return json({ error: "Zapytanie jest za długie." }, 400);
      const coords = parseCoordinates(q);
      if (coords) {
        const [lat, lon] = coords;
        if (!inPoland(lon, lat)) return json({ error: "Te współrzędne leżą poza Polską." }, 400);
        return json({ parcels: await getParcelAt(lon, lat) });
      }
      return json({ parcels: await searchParcels(q) });
    }

    const lon = Number(params.get("lon"));
    const lat = Number(params.get("lat"));
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      return json({ error: "Podaj numer działki albo punkt na mapie." }, 400);
    }
    if (!inPoland(lon, lat)) return json({ error: "Ten punkt leży poza Polską." }, 400);
    return json({ parcels: await getParcelAt(lon, lat) });
  } catch (error) {
    if (error instanceof UldkError) {
      return json(
        { error: "Usługa lokalizacji działek GUGiK (ULDK) nie odpowiada. Spróbuj ponownie za chwilę." },
        502
      );
    }
    throw error;
  }
}
