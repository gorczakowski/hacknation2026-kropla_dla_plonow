import { NextResponse, type NextRequest } from "next/server";
import { getPrecinctAt, UldkError } from "@/lib/parcels/uldk";
import type { PrecinctResponse } from "@/lib/parcels/types";

function json(body: PrecinctResponse, status = 200) {
  return NextResponse.json(body, { status });
}

/** GET /api/precincts?lon=<lon>&lat=<lat> → the cadastral precinct (obręb) at the point. */
export async function GET(request: NextRequest) {
  const lon = Number(request.nextUrl.searchParams.get("lon"));
  const lat = Number(request.nextUrl.searchParams.get("lat"));
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < 13.8 || lon > 24.4 || lat < 48.9 || lat > 55.1) {
    return json({ error: "Ten punkt leży poza Polską." }, 400);
  }
  try {
    return json({ precinct: await getPrecinctAt(lon, lat) });
  } catch (error) {
    if (error instanceof UldkError) {
      return json({ error: "Usługa lokalizacji GUGiK (ULDK) nie odpowiada." }, 502);
    }
    throw error;
  }
}
