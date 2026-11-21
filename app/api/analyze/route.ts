import { NextResponse, type NextRequest } from "next/server";
import type { AnalysisRequest, AnalysisResponse } from "@/lib/analysis/contract";
import { collectParcelData } from "@/lib/analysis/run";
import { isCropId } from "@/lib/crops";
import { isValidAnalysisDate } from "@/lib/dates";
import { getParcelById, UldkError } from "@/lib/parcels/uldk";

const MAX_PARCELS = 10;

function json(body: AnalysisResponse, status = 200) {
  return NextResponse.json(body, { status });
}

function parseRequest(body: unknown): AnalysisRequest | string {
  if (typeof body !== "object" || body === null) return "Nieprawidłowe zapytanie.";
  const { parcelIds, crop, date } = body as Record<string, unknown>;
  if (!Array.isArray(parcelIds) || parcelIds.length === 0) return "Wybierz co najmniej jedną działkę.";
  if (parcelIds.length > MAX_PARCELS) return `Można przeanalizować najwyżej ${MAX_PARCELS} działek naraz.`;
  if (!parcelIds.every(id => typeof id === "string" && id.length > 0 && id.length < 80)) {
    return "Nieprawidłowy identyfikator działki.";
  }
  if (!isCropId(crop)) return "Wybierz uprawę z listy.";
  if (!isValidAnalysisDate(date)) return "Wybierz dzień z ostatnich 10 lat (najpóźniej dzisiaj).";
  return { parcelIds: [...new Set(parcelIds as string[])], crop, date };
}

/**
 * POST /api/analyze  { parcelIds: string[], crop: CropId, date: "YYYY-MM-DD" }
 *
 * Skeleton: re-fetches each parcel from ULDK (client geometry is never
 * trusted) and runs the data modules. Scoring and recommendations come next.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Nieprawidłowe zapytanie." }, 400);
  }
  const parsed = parseRequest(body);
  if (typeof parsed === "string") return json({ error: parsed }, 400);

  try {
    const results = await Promise.all(
      parsed.parcelIds.map(async id => {
        const parcel = await getParcelById(id);
        if (!parcel) throw new NotFound(id);
        return { parcel, modules: await collectParcelData({ parcel, crop: parsed.crop, asOf: parsed.date }) };
      })
    );
    return json({ request: parsed, generatedAt: new Date().toISOString(), results });
  } catch (error) {
    if (error instanceof NotFound) return json({ error: `Nie znaleziono działki ${error.message} w ewidencji.` }, 404);
    if (error instanceof UldkError) {
      return json({ error: "Usługa lokalizacji działek GUGiK (ULDK) nie odpowiada. Spróbuj ponownie za chwilę." }, 502);
    }
    throw error;
  }
}

class NotFound extends Error {}
