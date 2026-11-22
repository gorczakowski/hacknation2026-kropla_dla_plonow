import { NextResponse, type NextRequest } from "next/server";
import { FIELD_OBSERVATIONS, type AnalysisRequest, type AnalysisResponse, type FieldObservation } from "@/lib/analysis/contract";
import { collectParcelData } from "@/lib/analysis/run";
import { assessParcelWater } from "@/lib/analysis/water-assessment";
import { isCropId } from "@/lib/crops";
import { isValidAnalysisDate } from "@/lib/dates";
import { getParcelById, UldkError } from "@/lib/parcels/uldk";

const MAX_PARCELS = 10;

function json(body: AnalysisResponse, status = 200) {
  return NextResponse.json(body, { status });
}

function isFieldObservation(value: unknown): value is FieldObservation {
  return typeof value === "string" && Object.hasOwn(FIELD_OBSERVATIONS, value);
}

function parseRequest(body: unknown): AnalysisRequest | string {
  if (typeof body !== "object" || body === null) return "Nieprawidłowe zapytanie.";
  const { parcelIds, crop, date, observations } = body as Record<string, unknown>;
  if (!Array.isArray(parcelIds) || parcelIds.length === 0) return "Wybierz co najmniej jedną działkę.";
  if (parcelIds.length > MAX_PARCELS) return `Można przeanalizować najwyżej ${MAX_PARCELS} działek naraz.`;
  if (!parcelIds.every(id => typeof id === "string" && id.length > 0 && id.length < 80)) {
    return "Nieprawidłowy identyfikator działki.";
  }
  if (!isCropId(crop)) return "Wybierz uprawę z listy.";
  if (!isValidAnalysisDate(date)) return "Wybierz dzień z ostatnich 10 lat (najpóźniej dzisiaj).";
  const ids = [...new Set(parcelIds as string[])];
  if (observations === undefined) return { parcelIds: ids, crop, date };
  if (observations === null || typeof observations !== "object" || Array.isArray(observations)) {
    return "Nieprawidłowe obserwacje z pola.";
  }
  const valid: [string, FieldObservation[]][] = [];
  for (const [id, values] of Object.entries(observations)) {
    if (!Array.isArray(values) || !values.every(isFieldObservation)) return "Nieprawidłowe obserwacje z pola.";
    // Observations for a parcel that is not analysed are dropped, not an error.
    if (ids.includes(id) && values.length) valid.push([id, [...new Set(values)]]);
  }
  return { parcelIds: ids, crop, date, observations: Object.fromEntries(valid) };
}

/**
 * POST /api/analyze  { parcelIds: string[], crop: CropId, date: "YYYY-MM-DD",
 *                      observations?: { [parcelId]: FieldObservation[] } }
 *
 * Re-fetches each parcel from ULDK, collects source data and assesses conditions.
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
        const modules = await collectParcelData({ parcel, crop: parsed.crop, asOf: parsed.date });
        const assessment = assessParcelWater(modules, parsed.crop, parsed.date, parsed.observations?.[id]);
        return { parcel, modules, assessment };
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
