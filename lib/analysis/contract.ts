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
};

export type AnalysisResponse =
  | { request: AnalysisRequest; generatedAt: string; results: ParcelAnalysis[] }
  | { error: string };
