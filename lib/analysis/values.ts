/**
 * The `value` each data module puts in its envelope. Plain data, no runtime
 * code: the server modules produce it and the browser turns it into the PDF
 * data summary.
 */
import type { ParcelProps } from "@/lib/parcels/types";

export type ParcelValue = ParcelProps;

// ---------- Meteo ----------

export type MeteoProvider = "open-meteo-era5" | "nasa-power";

export type MeteoWindow = {
  days: number;
  from: string;
  to: string;
  /** Days in the window that had data. */
  daysWithData: number;
  precipitation: number;
  et0: number;
  /** Climatic water balance P − ET0, mm. */
  balance: number;
  tMean: number | null;
  /** Days with Tmax ≥ 30 °C. */
  hotDays: number;
  /** Days with P ≥ 1 mm. */
  wetDays: number;
  /** Longest run of days with P < 1 mm. */
  longestDrySpell: number;
};

export type MeteoYearWindow = { year: number; from: string; to: string; precipitation: number; et0: number; balance: number };

export type MeteoSeason = {
  year: number;
  from: string;
  to: string;
  /** False when the season was still running on the analysis day. */
  complete: boolean;
  precipitation: number;
  et0: number;
  balance: number;
  longestDrySpell: number;
  hotDays: number;
};

export type MeteoMonth = { month: string; precipitation: number; et0: number; complete: boolean };

export type MeteoHistoricalMonth = {
  month: number;
  yearsWithData: number;
  deficitYears: number;
  medianBalance: number | null;
};

export type MeteoMonthlyHistory = {
  fromYear: number;
  toYear: number;
  months: MeteoHistoricalMonth[];
};

export type MeteoValue = {
  provider: MeteoProvider;
  gridPoint: { lat: number; lon: number; elevation: number | null };
  /** Last day with data (≤ analysis day). */
  lastDay: string;
  /** Days taken from the Open-Meteo forecast model because ERA5 lags ~5 days. */
  recentDaysFromForecast: number;
  windows: MeteoWindow[];
  /** The same 60-day window (ending on the same calendar day) in each year, newest first. */
  sameWindow: MeteoYearWindow[];
  /** Rank of this year's 60-day balance among `sameWindow` (1 = driest). */
  sameWindowRank: { rank: number; of: number } | null;
  /** Growing seasons (1 Apr – 30 Sep), newest first. */
  seasons: MeteoSeason[];
  /** Months Apr–Sep of the latest season that started on or before the analysis day. */
  seasonMonths: MeteoMonth[];
  /** Calendar months from the ten years before the analysis year. */
  monthlyHistory?: MeteoMonthlyHistory;
};

// ---------- Soil ----------

export type SoilTopsoil = { sand: number | null; silt: number | null; clay: number | null; soc: number | null; ph: number | null };

export type SoilWaterLayer = { depth: string; thicknessCm: number; fieldCapacity: number | null; wiltingPoint: number | null };

export type SoilValue = {
  point: [number, number];
  /** Thickness-weighted 0–30 cm. Texture %, SOC g/kg, pH in water. */
  topsoil: SoilTopsoil;
  layers: (SoilTopsoil & { depth: string })[];
  texture: { usda: string; pl: string } | null;
  /** Polish agronomic category inferred from texture (approximation), see lib/reference/kus2016. */
  kusCategory: string | null;
  /** Plant-available water 0–100 cm from SoilGrids water content at 33 and 1500 kPa, mm. */
  availableWater0to100: number | null;
  waterLayers: SoilWaterLayer[];
};

// ---------- Satellite ----------

export type S2Observation = {
  date: string;
  sceneId: string;
  sceneCloud: number;
  /** Share of the parcel's pixels classified as vegetation, bare soil or water by SCL. */
  clearShare: number;
  ndvi: number | null;
  ndmi: number | null;
  pixels: number;
};

export type S2Window = {
  year: number;
  from: string;
  to: string;
  candidates: number;
  observation: S2Observation | null;
};

export type SatelliteValue = {
  windowDays: number;
  minClearShare: number;
  current: S2Window;
  history: S2Window[];
  ndviHistoryMedian: number | null;
  ndmiHistoryMedian: number | null;
  /** Analysis day falls in April–October. */
  inSeason: boolean;
};

// ---------- Terrain ----------

export type TerrainValue = {
  dataset: string;
  cellSizeM: [number, number];
  parcelCells: number;
  elevation: { min: number; mean: number; max: number };
  slopePct: { mean: number; max: number };
  /** Share of the parcel with slope above 5 %. */
  steepShare: number;
  surroundings: { radiusM: number; mean: number; min: number; max: number };
  /** Parcel mean minus surroundings mean, m. */
  relativeElevation: number;
  position: string;
  /** Compass direction water drains to across the parcel, or null when flat. */
  drainsTowards: string | null;
  lowestPoint: [number, number];
  clipped: boolean;
};

// ---------- Hydrology ----------

export type LineFeatureSummary = {
  count500: number;
  /** Metres of the feature inside the parcel / within 100 m / within 500 m (segment-based, approximate). */
  lengthInside: number;
  length100: number;
  length500: number;
  nearestM: number | null;
  nearestName: string | null;
  nearestKind: string | null;
};

export type WaterBodySummary = {
  count500: number;
  standing500: number;
  areaHa500: number;
  nearestM: number | null;
  nearestKind: string | null;
  nearestName: string | null;
  nearestAreaHa: number | null;
};

export type HydroValue = {
  county: string;
  bdotVersion: string;
  searchRadiusM: number;
  ditches: LineFeatureSummary;
  watercourses: LineFeatureSummary;
  canals: LineFeatureSummary;
  waterBodies: WaterBodySummary;
};

// ---------- Land cover ----------

export type LandCoverShare = { label: string; share: number };

export type LandCoverValue = {
  county: string;
  bdotVersion: string;
  radiusM: number;
  parcel: LandCoverShare[];
  ring: LandCoverShare[];
  samples: { parcel: number; ring: number; spacingParcelM: number; spacingRingM: number };
};
