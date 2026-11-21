import "server-only";
import { createLimiter, fetchJson, HttpError } from "@/lib/server/http";
import type { DailyRecord, MeteoSeries } from "./series";

/**
 * Open-Meteo: ERA5 reanalysis via the Historical Weather API, plus the
 * forecast API for the last days ERA5 has not reached yet (~5 days lag).
 * The free API limits requests per IP per day and counts a long date range as
 * several requests; a 429 goes through UPSTREAM_PROXY (lib/server/http.ts), and
 * if that is limited too the meteo module falls back to NASA POWER.
 */
const DAILY = "precipitation_sum,et0_fao_evapotranspiration,temperature_2m_mean,temperature_2m_max";

type OpenMeteoResponse = {
  latitude: number;
  longitude: number;
  elevation?: number;
  daily?: {
    time: string[];
    precipitation_sum: (number | null)[];
    et0_fao_evapotranspiration: (number | null)[];
    temperature_2m_mean: (number | null)[];
    temperature_2m_max: (number | null)[];
  };
  error?: boolean;
  reason?: string;
};

function toSeries(body: OpenMeteoResponse, recent: boolean): MeteoSeries {
  if (body.error || !body.daily) throw new Error(`Open-Meteo: ${body.reason ?? "brak danych dziennych"}`);
  const d = body.daily;
  const days: DailyRecord[] = d.time.map((date, i) => ({
    date,
    p: d.precipitation_sum[i] ?? null,
    et0: d.et0_fao_evapotranspiration[i] ?? null,
    tMean: d.temperature_2m_mean[i] ?? null,
    tMax: d.temperature_2m_max[i] ?? null,
    ...(recent ? { recent: true } : {})
  }));
  return { provider: "open-meteo-era5", lat: body.latitude, lon: body.longitude, elevation: body.elevation ?? null, days };
}

/** Open-Meteo also caps concurrent requests per IP ("Too many concurrent requests"). */
const limit = createLimiter(3);
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function call(url: string, signal: AbortSignal, timeoutMs: number): Promise<OpenMeteoResponse> {
  try {
    return await limit(async () => {
      try {
        return await fetchJson<OpenMeteoResponse>(url, { timeoutMs, signal });
      } catch (error) {
        if (!(error instanceof HttpError && error.status === 429 && /concurrent/i.test(error.body ?? ""))) throw error;
        await pause(800);
        return fetchJson<OpenMeteoResponse>(url, { timeoutMs, signal });
      }
    });
  } catch (error) {
    if (error instanceof HttpError && error.body) {
      const reason = /"reason"\s*:\s*"([^"]+)"/.exec(error.body)?.[1];
      if (reason) throw new HttpError(error.status, `Open-Meteo HTTP ${error.status}: ${reason}`, error.body);
    }
    throw error;
  }
}

export async function fetchEra5(lat: number, lon: number, from: string, to: string, signal: AbortSignal) {
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
    `&start_date=${from}&end_date=${to}&daily=${DAILY}&models=era5_seamless&timezone=Europe%2FWarsaw`;
  return toSeries(await call(url, signal, 9_000), false);
}

/** Recent days from the forecast API's best-match model (only the last ~3 months are served). */
export async function fetchRecent(lat: number, lon: number, from: string, to: string, signal: AbortSignal) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&start_date=${from}&end_date=${to}&daily=${DAILY}&timezone=Europe%2FWarsaw`;
  return toSeries(await call(url, signal, 6_000), true);
}
