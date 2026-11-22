import { cropLabel, type CropId } from "@/lib/crops";
import { daysBetween } from "@/lib/dates";
import type { DataEnvelope, FieldObservation, ModuleId, WaterAssessment, WaterScore } from "./contract";
import { recommendRetention, TUZ_RETENTION_FUNDING } from "./retention";
import type { HydroValue, MeteoValue, MeteoWindow, SatelliteValue, SoilValue, TerrainValue } from "./values";

type Bands = ReadonlyArray<readonly [deficitMm: number, WaterScore]>;
/** 30-day climatic deficit (mm) at or above which each score applies; below the last band the score is 5. */
export const BANDS: Bands = [[90, 1], [60, 2], [35, 3], [15, 4]];
/** Light soils hold less water, so the same deficit counts sooner. */
export const LIGHT_SOIL_BANDS: Bands = [[65, 1], [45, 2], [25, 3], [10, 4]];
/** With at least this many years to compare, the season's rank shifts the score by one point. */
const MIN_YEARS_FOR_RANK = 6;
const thresholds = (bands: Bands) => bands.map(([mm]) => mm).reverse().join("/");
const bandScore = (bands: Bands, deficit: number) => bands.find(([min]) => deficit >= min)?.[1] ?? 5;
const clampScore = (score: number) => Math.min(5, Math.max(1, score)) as WaterScore;
const formatMm = (value: number, signDisplay: Intl.NumberFormatOptions["signDisplay"] = "auto") =>
  value.toLocaleString("pl-PL", { maximumFractionDigits: 1, signDisplay });

function completeWindow(meteo: MeteoValue | null, days: number): MeteoWindow | undefined {
  return meteo?.windows.find(w => w.days === days && w.daysWithData === days && Number.isFinite(w.balance));
}

function satelliteEvidence(satellite: SatelliteValue | null, crop: CropId, date: string): string | null {
  const observation = satellite?.current.observation;
  if (!satellite?.inSeason || !observation || daysBetween(observation.date, date) > 14 || observation.date > date) return null;
  if ((observation.ndvi ?? 0) < 0.3 || observation.ndmi === null) return null;
  const prior = satellite.history.flatMap(({ observation }) =>
    observation && (observation.ndvi ?? 0) >= 0.3 && observation.ndmi !== null ? [observation.ndmi] : []
  ).sort((a, b) => a - b);
  if (prior.length < 3) return null;
  const mid = Math.floor(prior.length / 2);
  const median = prior.length % 2 ? prior[mid] : (prior[mid - 1] + prior[mid]) / 2;
  const delta = (observation.ndmi - median).toLocaleString("pl-PL", { maximumFractionDigits: 2, signDisplay: "exceptZero" });
  return `Na zdjęciu Sentinel-2 z ${observation.date} różnica NDMI względem mediany z ${prior.length} porównywalnych okresów z roślinnością wynosi ${delta}. Przy interpretacji dla uprawy „${cropLabel(crop)}” uwzględnij fazę rozwoju i zmianowanie.`;
}

/** A screening score, based on a complete recent climatic balance and field context. */
export function assessParcelWater(
  modules: DataEnvelope[], crop: CropId, date: string, fieldObservations: FieldObservation[] = []
): WaterAssessment {
  const data = <T>(id: ModuleId) => {
    const envelope = modules.find(module => module.module === id) as DataEnvelope<T> | undefined;
    return envelope?.status === "ok" || envelope?.status === "partial" ? envelope.value : null;
  };
  const meteo = data<MeteoValue>("meteo");
  const recent = completeWindow(meteo, 30);
  if (!recent || daysBetween(recent.to, date) > 7 || recent.to > date) {
    return {
      score: null,
      excessWater: fieldObservations.includes("ponding"),
      uncertainty: null,
      summary: "Brak pełnego 30-dniowego bilansu pogody kończącego się w dniu analizy lub do 7 dni wcześniej.",
      evidence: [],
      recommendations: []
    };
  }

  const observations = new Set(fieldObservations);
  const soil = data<SoilValue>("soil");
  const lightSoil = soil?.kusCategory === "bardzo lekka" || soil?.kusCategory === "lekka";
  const deficit = Math.max(0, -recent.balance);
  let score = bandScore(lightSoil ? LIGHT_SOIL_BANDS : BANDS, deficit);
  const summary = [`Bilans 30 dni do ${recent.to} wyniósł ${formatMm(recent.balance, "exceptZero")} mm (opad minus ET0).`];
  const evidence: string[] = [];
  if (lightSoil) {
    if (score < bandScore(BANDS, deficit)) summary.push("Lekka gleba obniża ocenę.");
    evidence.push(`Model wskazuje lekką lub bardzo lekką glebę o mniejszym zapasie wody, więc progi deficytu są niższe: ${thresholds(LIGHT_SOIL_BANDS)} mm zamiast ${thresholds(BANDS)} mm.`);
  }

  // The same deficit means more in spring than in a typical July: compare with the same
  // 60-day window in earlier years (rank 1 = driest).
  const last60 = completeWindow(meteo, 60);
  const rank = meteo?.sameWindowRank;
  if (rank && rank.of >= MIN_YEARS_FOR_RANK && last60) {
    if (rank.rank <= Math.floor(rank.of * 0.2) && last60.balance < 0 && score > 1) {
      score = clampScore(score - 1);
      summary.push(`To jeden z najsuchszych okresów o tej porze roku (${rank.rank}. na ${rank.of} lat), więc ocena jest niższa o 1.`);
    } else if (rank.rank > Math.ceil(rank.of * 0.6) && score < 5) {
      score = clampScore(score + 1);
      summary.push(`O tej porze roku jest wilgotniej niż zwykle (${rank.of - rank.rank + 1}. najwilgotniejszy na ${rank.of} lat), więc ocena jest wyższa o 1.`);
    }
  }

  const excessWater = observations.has("ponding");
  if (excessWater) {
    summary.push("Zgłoszono też długie zastoiska, czyli okresowy nadmiar wody.");
    evidence.push("Zastoiska oceniamy osobno od niedoboru. Mogą wynikać ze zbitej warstwy, nieprzepuszczalnego podłoża albo położenia w obniżeniu.");
    if (crop === "uzytki-zielone") evidence.push(TUZ_RETENTION_FUNDING);
  }

  const prior = (meteo?.sameWindow ?? []).filter(window => window.to < recent.from);
  const dryYears = prior.filter(window => window.balance <= -70).length;
  if (last60) evidence.push(`Bilans ostatnich 60 dni wyniósł ${formatMm(last60.balance, "exceptZero")} mm.`);
  if (prior.length) {
    evidence.push(`W ${dryYears} z ${prior.length} wcześniejszych lat ten sam okres 60 dni miał bilans co najmniej 70 mm poniżej zera.`);
  }
  if (soil?.availableWater0to100 != null) {
    evidence.push(`SoilGrids szacuje pojemność wodną dostępną dla roślin w warstwie 0–100 cm na ${formatMm(soil.availableWater0to100)} mm.`);
  } else if (!soil?.kusCategory) {
    evidence.push("Brak danych o kategorii gleby. Ocena pomija jej wpływ.");
  }
  const satellite = satelliteEvidence(data<SatelliteValue>("satellite"), crop, date);
  if (satellite) evidence.push(satellite);

  const dry = deficit >= 35 || (prior.length >= 3 && dryYears >= Math.ceil(prior.length / 2));
  return {
    score,
    excessWater,
    uncertainty: !soil?.kusCategory || meteo?.provider === "nasa-power" || daysBetween(recent.to, date) > 2 ? "high" : "medium",
    summary: summary.join(" "),
    evidence,
    recommendations: recommendRetention({ crop, observations, lightSoil, dry, terrain: data<TerrainValue>("terrain"), hydro: data<HydroValue>("hydro") })
  };
}
