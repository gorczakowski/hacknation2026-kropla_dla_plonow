import "server-only";
import { addDays, daysBetween, minDate, shiftYears, todayInPoland } from "@/lib/dates";
import { fetchNasaPower } from "@/lib/meteo/nasapower";
import { fetchEra5, fetchRecent } from "@/lib/meteo/openmeteo";
import { isComplete, type MeteoSeries } from "@/lib/meteo/series";
import { summarizeMeteo } from "@/lib/meteo/stats";
import { DAY, diskCached, HOUR } from "@/lib/server/disk-cache";
import { MODULE_LABELS, type AnalysisModule, type DataEnvelope, type DataSource } from "../contract";
import type { MeteoValue } from "../values";

const SOURCES = {
  era5: {
    name: "Open-Meteo Historical Weather API: reanaliza ERA5 / ERA5-Land (ECMWF, Copernicus)",
    url: "https://open-meteo.com/en/docs/historical-weather-api",
    license: "Dane CC BY 4.0; darmowe API do użytku niekomercyjnego",
    mode: "live"
  },
  recent: {
    name: "Open-Meteo Forecast API (ostatnie dni, model best match)",
    url: "https://open-meteo.com/en/docs",
    license: "Dane CC BY 4.0; darmowe API do użytku niekomercyjnego",
    mode: "live"
  },
  power: {
    name: "NASA POWER Daily API (MERRA-2, CERES)",
    url: "https://power.larc.nasa.gov/docs/services/api/",
    license: "Dane NASA bez ograniczeń wykorzystania; wymagane podanie źródła",
    mode: "live"
  }
} satisfies Record<string, DataSource>;

/**
 * ERA5 fetched in calendar-year requests. Open-Meteo counts a long date range as
 * many calls (10 years ≈ 270 of the free daily quota), so the URLs are kept the
 * same for any analysis day: finished years are cached for a year (on disk and
 * in the Cloudflare Worker) and only the running year is fetched again.
 */
async function loadEra5ByYear(lat: number, lon: number, start: string, end: string, today: string, signal: AbortSignal) {
  const firstYear = Number(start.slice(0, 4));
  const lastYear = Number(end.slice(0, 4));
  const settled = addDays(today, -10); // ERA5 is final about 5 days after the fact
  const chunks = await Promise.all(
    Array.from({ length: lastYear - firstYear + 1 }, (_, i) => {
      const year = firstYear + i;
      const yearEnd = `${year}-12-31`;
      const closed = yearEnd < settled;
      const to = closed ? yearEnd : minDate(yearEnd, end);
      return diskCached("open-meteo-era5", `${lat},${lon}:${year}:${to}`, closed ? 365 * DAY : 6 * HOUR, () =>
        fetchEra5(lat, lon, `${year}-01-01`, to, signal)
      );
    })
  );
  const days = chunks.flatMap(c => c.value.days).filter(d => d.date >= start && d.date <= end);
  const series: MeteoSeries = { ...chunks[0].value, days };
  return { series, savedAt: Math.max(...chunks.map(c => c.savedAt)) };
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const pl = (v: number) => v.toFixed(2).replace(".", ",");
const reason = (e: unknown) => (e instanceof Error ? e.message : "nieznany błąd").replace(/\.+$/, "");

/** Weather: precipitation, ET0 and the climatic water balance P − ET0 for the analysis day and the 10 years before it. */
export const meteoModule: AnalysisModule<MeteoValue> = {
  id: "meteo",
  label: MODULE_LABELS.meteo,
  async run(ctx): Promise<DataEnvelope<MeteoValue>> {
    const [lon, lat] = ctx.parcel.properties.labelPoint;
    const qLat = round2(lat);
    const qLon = round2(lon);
    const today = todayInPoland();
    // Whole days only: today's values would still be partly forecast.
    const end = minDate(ctx.asOf, addDays(today, -1));
    // 10 years back from the analysis day, plus room for the first 90-day window.
    const start = addDays(shiftYears(ctx.asOf, -10), -95);
    const ttl = end >= addDays(today, -10) ? 6 * HOUR : 180 * DAY;
    const notes: string[] = [];
    const sources: DataSource[] = [];
    let series: MeteoSeries;
    let savedAt: number;

    try {
      ({ series, savedAt } = await loadEra5ByYear(qLat, qLon, start, end, today, ctx.signal));
      sources.push(SOURCES.era5);

      // ERA5 lags ~5 days: fill the gap from the forecast model when the day is recent.
      const lastComplete = series.days.filter(isComplete).at(-1)?.date ?? start;
      if (lastComplete < end && daysBetween(lastComplete, today) <= 60) {
        try {
          const from = addDays(lastComplete, 1);
          const { value: recent } = await diskCached("open-meteo-recent", `${qLat},${qLon}:${from}:${end}`, 3 * HOUR, () =>
            fetchRecent(qLat, qLon, from, end, ctx.signal)
          );
          const byDate = new Map(recent.days.filter(isComplete).map(d => [d.date, d]));
          series = { ...series, days: series.days.map(d => (d.date > lastComplete && byDate.get(d.date)) || d) };
          sources.push(SOURCES.recent);
        } catch (error) {
          notes.push(`Nie udało się uzupełnić ostatnich dni modelem prognostycznym Open-Meteo (${reason(error)}).`);
        }
      }
    } catch (error) {
      notes.push(`Open-Meteo (ERA5) niedostępne: ${reason(error)}. Użyto zapasowego źródła NASA POWER.`);
      try {
        ({ value: series, savedAt } = await diskCached("nasa-power", `${qLat},${qLon}:${start}:${end}`, ttl, () =>
          fetchNasaPower(qLat, qLon, start, end, ctx.signal)
        ));
        sources.push(SOURCES.power);
      } catch (fallbackError) {
        notes.push(`NASA POWER również niedostępne: ${reason(fallbackError)}.`);
        return {
          module: "meteo",
          status: "error",
          value: null,
          sources: [],
          fetchedAt: new Date().toISOString(),
          notes: [...notes, "Dane meteorologiczne: brak danych, wynik ich nie uwzględnia."]
        };
      }
    }

    const summary = summarizeMeteo(series, end);
    if (!summary) {
      return {
        module: "meteo",
        status: "missing",
        value: null,
        sources,
        fetchedAt: new Date(savedAt).toISOString(),
        notes: [...notes, "Źródło nie zwróciło żadnego pełnego dnia dla tego miejsca i okresu."]
      };
    }

    if (series.provider === "open-meteo-era5") {
      notes.push(
        `Opad, temperatura i ET0 (FAO-56 Penman–Monteith, obliczone przez Open-Meteo) z reanalizy ERA5/ERA5-Land dla punktu siatki ${pl(series.lat)}° N, ${pl(series.lon)}° E (oczko ok. 9–25 km). Wartości opisują okolicę, nie samo pole; lokalne burze mogą być niedoszacowane.`
      );
    } else {
      notes.push(
        `Dane NASA POWER dla oczka siatki ok. 0,5° (ok. 50 km) wokół ${pl(series.lat)}° N, ${pl(series.lon)}° E. ET0 obliczone w aplikacji metodą FAO-56 Penman–Monteith (Allen i in. 1998) z temperatury, wilgotności, wiatru i promieniowania. Opad z modelu MERRA-2 jest mniej dokładny niż ERA5 i pomiary stacyjne.`
      );
    }
    if (summary.recentDaysFromForecast > 0) {
      notes.push(
        `Ostatnie ${summary.recentDaysFromForecast} dni pochodzi z modelu prognostycznego (analiza bieżąca), bo ERA5 publikowane jest z ok. 5-dniowym opóźnieniem.`
      );
    }
    if (ctx.asOf >= today) notes.push("Dzień analizy to dziś: zestawienie kończy się na wczoraj (pełne doby).");
    const lag = daysBetween(summary.lastDay, end);
    if (lag > 0) notes.push(`Dane kończą się ${summary.lastDay}, ${lag} dni przed dniem analizy.`);
    if (summary.sameWindow.length < 10) {
      notes.push(`Porównanie z poprzednimi latami obejmuje ${summary.sameWindow.length} lat (pełne okna 60-dniowe).`);
    }

    return {
      module: "meteo",
      status: lag > 7 ? "partial" : "ok",
      value: {
        provider: series.provider,
        gridPoint: { lat: series.lat, lon: series.lon, elevation: series.elevation },
        ...summary
      },
      sources,
      fetchedAt: new Date(savedAt).toISOString(),
      period: { from: series.days.find(isComplete)?.date ?? start, to: summary.lastDay },
      uncertainty: series.provider === "open-meteo-era5" ? "medium" : "high",
      notes
    };
  }
};
