/**
 * The module contract: every data/analysis module returns a DataEnvelope.
 *
 * Why: the report must state sources, dates and limitations, and say plainly
 * when data is missing (task §3.3 pt 5). If every module reports through the
 * same envelope, the "Źródła", "Ograniczenia" and "Brak danych" parts of the
 * report are generated from the envelopes rather than written by hand, and a
 * module that is not built yet is still an honest "missing".
 */
import type { CropId } from "@/lib/crops";
import type { ParcelFeature } from "@/lib/parcels/types";

export type ModuleId =
  | "parcel" // geometry and location (ULDK)
  | "meteo" // precipitation, temperature, ET0, climatic water balance (Open-Meteo / IMGW)
  | "soil" // texture, water capacity, IUNG soil drought category (SoilGrids / IUNG)
  | "satellite" // NDVI / NDMI anomalies (Copernicus Sentinel-2)
  | "terrain" // slope, depressions, flow (GUGiK NMT)
  | "hydro" // watercourses, ditches, water bodies (BDOT10k)
  | "landcover" // land cover on and around the parcel (BDOT10k)
  | "drought"; // background drought indicators (EDO / IUNG)

/** Names shown to the farmer in the report. */
export const MODULE_LABELS: Record<ModuleId, string> = {
  parcel: "Działka ewidencyjna",
  meteo: "Dane meteorologiczne",
  soil: "Dane glebowe",
  satellite: "Dane satelitarne",
  terrain: "Ukształtowanie terenu",
  hydro: "Dane hydrologiczne",
  landcover: "Użytkowanie terenu",
  drought: "Tło suszowe"
};

export type DataStatus =
  | "ok" // data present and used
  | "partial" // some of the data missing or degraded; see notes
  | "missing" // no data for this place/date (said plainly in the report)
  | "error"; // the source failed; the report says so and carries on

export type Uncertainty = "low" | "medium" | "high";

export type DataSource = {
  name: string; // e.g. "GUGiK ULDK"
  url: string;
  license: string; // e.g. "CC BY 4.0", "dane publiczne"
  /** "live" = fetched for this request; "prepared" = pre-downloaded file (README lists dates). */
  mode: "live" | "prepared";
};

export type DataEnvelope<T = unknown> = {
  module: ModuleId;
  status: DataStatus;
  value: T | null;
  sources: DataSource[];
  /** ISO timestamp of the fetch (or of the prepared file). */
  fetchedAt: string;
  /** The period the data describes, YYYY-MM-DD. */
  period?: { from: string; to: string };
  uncertainty?: Uncertainty;
  /** Plain-Polish notes for the report's limitations section. */
  notes: string[];
};

export type AnalysisRequest = {
  parcelIds: string[];
  crop: CropId;
  /** Analysis day, YYYY-MM-DD; no data after this day may be used. */
  date: string;
  /** Farmer-confirmed field observations, by parcel id. */
  observations?: Partial<Record<string, FieldObservation[]>>;
};

export const FIELD_OBSERVATIONS = {
  bareAfterHarvest: "Po zbiorze gleba jest odsłonięta",
  runoffRills: "Po deszczu widać żłobiny po spływie",
  lowOrganicMatter: "Badanie gleby wykazało mało materii organicznej",
  compactedLayer: "Odkrywka potwierdziła zbitą warstwę gleby",
  ponding: "Na polu długo utrzymują się zastoiska wody",
  windExposure: "Silny wiatr przesusza odsłonięte pole",
  activeDrainage: "Dreny lub rów odprowadzają wodę z pola",
  reliableInflow: "Woda regularnie dopływa do obniżenia"
} as const;

export type FieldObservation = keyof typeof FIELD_OBSERVATIONS;
export type WaterScore = 1 | 2 | 3 | 4 | 5;

export const WATER_SCORE_LABELS: Record<WaterScore, string> = {
  1: "Bardzo słabe",
  2: "Słabe",
  3: "Umiarkowane",
  4: "Dość dobre",
  5: "Dobre"
};

export const WATER_SCORE_SCALE = Object.entries(WATER_SCORE_LABELS).map(([score, label]) => `${score} ${label.toLowerCase()}`).join(" · ");
export const WATER_SCORE_NOTE = "Ocena orientacyjna niedoboru wody na wybrany dzień: bilans pogody z 30 dni na tle tego samego okresu w poprzednich latach i kategoria gleby. Zgłoszone zastoiska pokazujemy osobno jako nadmiar wody. Wilgotność w strefie korzeni wymaga osobnego pomiaru.";
export const WATER_UNCERTAINTY_LABELS = { medium: "umiarkowana", high: "wysoka" } as const;
export const EXCESS_WATER_LABEL = "Nadmiar wody";
export const EXCESS_WATER_NOTE = "Zgłoszono długo utrzymujące się zastoiska. Ocena niedoboru tego nie obejmuje.";

export type RetentionRecommendation = {
  title: string;
  kind: "agrotechnical" | "retention";
  why: string;
  nextStep: string;
  /** Indicative cost before subsidies, as given in the guide. */
  cost: string;
  sourcePage: number;
  /** Matching subsidy from the guide's funding page, if any. */
  funding?: string;
  needsCheck?: true;
};

export const PRACTICE_KIND_LABELS: Record<RetentionRecommendation["kind"], string> = {
  agrotechnical: "Agrotechnika",
  retention: "Retencja"
};
export const FIELD_CHECK_LABEL = "Do sprawdzenia w terenie";
export const COST_LABEL = "Orientacyjny koszt przed dopłatami";
export const FUNDING_LABEL = "Dopłaty";

export type WaterAssessment = {
  /** Water-deficit score; excess water is reported separately in `excessWater`. */
  score: WaterScore | null;
  /** The farmer reported persistent ponding. */
  excessWater: boolean;
  uncertainty: Exclude<Uncertainty, "low"> | null;
  summary: string;
  evidence: string[];
  recommendations: RetentionRecommendation[];
};

export type AnalysisContext = {
  parcel: ParcelFeature;
  crop: CropId;
  /** Analysis day (inclusive upper bound for all data). */
  asOf: string;
  /** Start of the 10-year history window. */
  historyFrom: string;
  signal: AbortSignal;
};

export type AnalysisModule<T = unknown> = {
  id: ModuleId;
  label: string;
  run(ctx: AnalysisContext): Promise<DataEnvelope<T>>;
};

export type ParcelAnalysis = {
  parcel: ParcelFeature;
  modules: DataEnvelope[];
  assessment: WaterAssessment;
};

export type AnalysisResponse =
  | { request: AnalysisRequest; generatedAt: string; results: ParcelAnalysis[] }
  | { error: string };
