import "server-only";
import { fetchJson } from "@/lib/server/http";
import { dayOfYear, et0PenmanMonteith } from "./et0";
import type { DailyRecord, MeteoSeries } from "./series";

/**
 * NASA POWER daily point API (MERRA-2 meteorology, CERES/MERRA-2 radiation,
 * ~0.5° grid). No key, no daily quota for this use. POWER has no ET0, so it is
 * computed here with FAO-56 Penman–Monteith from Tmax, Tmin, RH, wind and Rs.
 */
const PARAMS = "PRECTOTCORR,T2M,T2M_MAX,T2M_MIN,RH2M,WS2M,ALLSKY_SFC_SW_DWN";

type PowerResponse = {
  geometry?: { coordinates: [number, number, number] };
  properties?: { parameter: Record<string, Record<string, number>> };
  messages?: string[];
};

const compact = (date: string) => date.replaceAll("-", "");
const valid = (v: number | undefined) => (v === undefined || v <= -990 ? null : v);

export async function fetchNasaPower(lat: number, lon: number, from: string, to: string, signal: AbortSignal) {
  const url =
    `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=${PARAMS}&community=AG` +
    `&longitude=${lon}&latitude=${lat}&start=${compact(from)}&end=${compact(to)}&format=JSON`;
  const body = await fetchJson<PowerResponse>(url, { timeoutMs: 12_000, signal });
  const p = body.properties?.parameter;
  if (!p?.PRECTOTCORR) throw new Error(`NASA POWER: ${body.messages?.join("; ") || "brak danych"}`);

  const [gLon, gLat, gElev] = body.geometry?.coordinates ?? [lon, lat, 0];
  const elevation = Number.isFinite(gElev) ? gElev : 0;

  const days: DailyRecord[] = Object.keys(p.PRECTOTCORR)
    .sort()
    .map(key => {
      const date = `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
      const tMax = valid(p.T2M_MAX?.[key]);
      const tMin = valid(p.T2M_MIN?.[key]);
      const rh = valid(p.RH2M?.[key]);
      const wind = valid(p.WS2M?.[key]);
      const rs = valid(p.ALLSKY_SFC_SW_DWN?.[key]);
      const et0 =
        tMax !== null && tMin !== null && rh !== null && wind !== null && rs !== null
          ? et0PenmanMonteith({
              tMax,
              tMin,
              rhMean: rh,
              windSpeed2m: wind,
              solarRadiation: rs,
              latitudeDeg: gLat,
              elevationM: elevation,
              dayOfYear: dayOfYear(date)
            })
          : null;
      const precip = valid(p.PRECTOTCORR[key]);
      return { date, p: precip === null ? null : Math.max(0, precip), et0, tMean: valid(p.T2M?.[key]), tMax };
    });

  const series: MeteoSeries = { provider: "nasa-power", lat: gLat, lon: gLon, elevation, days };
  return series;
}
