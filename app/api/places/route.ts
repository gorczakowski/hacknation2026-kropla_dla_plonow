import { NextResponse, type NextRequest } from "next/server";
import { PhotonError, searchPlacesByName, searchPlacesByPostcode } from "@/lib/places/photon";
import { normalizePostcode, type PlacesResponse } from "@/lib/places/types";

function json(body: PlacesResponse, status = 200) {
  return NextResponse.json(body, { status });
}

/** GET /api/places?q=<village name | postcode> */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim().replace(/\s+/g, " ") ?? "";
  if (q.length < 2) return json({ error: "Wpisz co najmniej 2 znaki." }, 400);
  if (q.length > 80) return json({ error: "Zapytanie jest za długie." }, 400);

  try {
    const postcode = normalizePostcode(q);
    if (postcode) {
      const { area, places } = await searchPlacesByPostcode(postcode);
      return json({ mode: "postcode", postcode, area, places });
    }
    return json({ mode: "name", places: await searchPlacesByName(q) });
  } catch (error) {
    if (error instanceof PhotonError) {
      return json({ error: "Wyszukiwarka miejscowości nie odpowiada. Spróbuj ponownie za chwilę." }, 502);
    }
    throw error;
  }
}
