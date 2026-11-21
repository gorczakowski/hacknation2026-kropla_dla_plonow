import type { MeteoProvider } from "@/lib/analysis/values";

export type DailyRecord = {
  date: string;
  p: number | null; // precipitation, mm
  et0: number | null; // mm
  tMean: number | null; // °C
  tMax: number | null; // °C
  /** True when the day came from the forecast model, not the reanalysis. */
  recent?: boolean;
};

export type MeteoSeries = {
  provider: MeteoProvider;
  lat: number;
  lon: number;
  elevation: number | null;
  days: DailyRecord[];
};

export const isComplete = (d: DailyRecord) => d.p !== null && d.et0 !== null;
