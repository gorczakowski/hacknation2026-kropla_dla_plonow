import "server-only";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { addDays, shiftYears, todayInPoland } from "@/lib/dates";
import { sceneClearShare, sceneIndices, searchScenes, type Scene } from "@/lib/satellite/planetary";
import { DAY, diskCached, HOUR } from "@/lib/server/disk-cache";
import { MODULE_LABELS, type AnalysisModule, type DataEnvelope } from "../contract";
import type { S2Observation, S2Window, SatelliteValue } from "../values";

const WINDOW_DAYS = 30;
const YEARS_BACK = 10;
/** Scene-level cloud cover filter; the parcel itself is checked with SCL. */
const MAX_SCENE_CLOUD = 70;
const MIN_CLEAR_SHARE = 0.8;
const BATCH = 3;

class IncompleteRead extends Error {
  constructor(public result: { value: SatelliteValue; failures: number }) {
    super("incomplete Sentinel-2 read");
  }
}
const MAX_BATCHES = 2;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return Math.round((s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2) * 1000) / 1000;
}

/** Latest scene in the window whose parcel pixels are at least 80% clear. */
async function pickObservation(
  candidates: Scene[],
  feature: Feature<Polygon | MultiPolygon>,
  signal: AbortSignal,
  failures: { n: number }
): Promise<S2Observation | null> {
  for (let b = 0; b < MAX_BATCHES; b++) {
    const batch = candidates.slice(b * BATCH, (b + 1) * BATCH);
    if (batch.length === 0) return null;
    const checks = await Promise.all(
      batch.map(scene =>
        sceneClearShare(scene, feature, signal).catch(() => {
          failures.n++;
          return null;
        })
      )
    );
    const index = checks.findIndex(c => c !== null && c.pixels > 0 && c.clearShare >= MIN_CLEAR_SHARE);
    if (index === -1) continue;
    const scene = batch[index];
    try {
      const indices = await sceneIndices(scene, feature, signal);
      return {
        date: scene.date,
        sceneId: scene.id,
        sceneCloud: Math.round(scene.cloud),
        clearShare: Math.round(checks[index]!.clearShare * 100) / 100,
        ...indices
      };
    } catch {
      failures.n++;
      return null;
    }
  }
  return null;
}

async function loadSatellite(feature: Feature<Polygon | MultiPolygon>, asOf: string, signal: AbortSignal) {
  const windows = Array.from({ length: YEARS_BACK + 1 }, (_, k) => {
    const to = shiftYears(asOf, -k);
    return { year: Number(to.slice(0, 4)), from: addDays(to, -(WINDOW_DAYS - 1)), to };
  });
  const scenes = await searchScenes(feature, windows, MAX_SCENE_CLOUD, signal);
  const failures = { n: 0 };

  const results: S2Window[] = await Promise.all(
    windows.map(async w => {
      // One scene per day (two tiles can cover the parcel), lowest cloud first, then newest first.
      const byDate = new Map<string, Scene>();
      for (const s of scenes) {
        if (s.date < w.from || s.date > w.to) continue;
        const seen = byDate.get(s.date);
        if (!seen || s.cloud < seen.cloud) byDate.set(s.date, s);
      }
      const candidates = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
      const observation = await pickObservation(candidates, feature, signal, failures);
      return { ...w, candidates: candidates.length, observation };
    })
  );

  const [current, ...history] = results;
  const pickValues = (k: "ndvi" | "ndmi") =>
    history.map(h => h.observation?.[k]).filter((v): v is number => typeof v === "number");
  const month = Number(asOf.slice(5, 7));
  const value: SatelliteValue = {
    windowDays: WINDOW_DAYS,
    minClearShare: MIN_CLEAR_SHARE,
    current,
    history,
    ndviHistoryMedian: median(pickValues("ndvi")),
    ndmiHistoryMedian: median(pickValues("ndmi")),
    inSeason: month >= 4 && month <= 10
  };
  return { value, failures: failures.n };
}

/** Vegetation (NDVI) and canopy water (NDMI) over the parcel now and in the same 30-day window of the past 10 years. */
export const satelliteModule: AnalysisModule<SatelliteValue> = {
  id: "satellite",
  label: MODULE_LABELS.satellite,
  async run(ctx): Promise<DataEnvelope<SatelliteValue>> {
    const feature: Feature<Polygon | MultiPolygon> = { type: "Feature", properties: {}, geometry: ctx.parcel.geometry };
    const recent = ctx.asOf >= addDays(todayInPoland(), -5);
    // Results with failed scene requests are used once but not cached, so the next run retries.
    const { value: loaded, savedAt } = await diskCached(
      "s2-planetary",
      `${ctx.parcel.properties.id}:${ctx.asOf}`,
      recent ? 6 * HOUR : 30 * DAY,
      async () => {
        const result = await loadSatellite(feature, ctx.asOf, ctx.signal);
        if (result.failures > 0) throw new IncompleteRead(result);
        return result;
      }
    ).catch(error => {
      if (error instanceof IncompleteRead) return { value: error.result, savedAt: Date.now() };
      throw error;
    });
    const { value, failures } = loaded;

    const found = value.history.filter(h => h.observation).length;
    const notes = [
      `Sentinel-2 L2A (ESA, Copernicus) z katalogu Microsoft Planetary Computer; statystyki liczone dla granicy działki. NDVI z pasm B04/B08 (10 m), NDMI z B8A/B11 (20 m); podajemy medianę pikseli działki.`,
      `Okno ${value.windowDays} dni przed dniem analizy i te same dni w poprzednich latach. Obserwację przyjmujemy, gdy co najmniej ${Math.round(value.minClearShare * 100)}% pikseli działki to wg maski SCL roślinność, gleba lub woda (bez chmur, cieni i śniegu).`,
      "Od 25.01.2022 (baseline 04.00) od wartości pasm odjęto przesunięcie 1000, by lata były porównywalne."
    ];
    if (!value.current.observation) {
      notes.push(`Brak bezchmurnej obserwacji działki w ${value.windowDays} dniach przed dniem analizy.`);
    }
    if (!value.inSeason) {
      notes.push(
        "Dzień analizy wypada poza sezonem wegetacji (kwiecień–październik): niskie NDVI może oznaczać goły grunt lub spoczynek roślin, a nie suszę."
      );
    }
    if (failures > 0) notes.push(`${failures} zapytań o sceny nie powiodło się; te sceny pominięto.`);
    notes.push("Indeksy opisują stan roślinności, ale nie odróżniają suszy od innych przyczyn (choroby, zabiegi, zbiór).");

    const status = value.current.observation && found >= 5 ? "ok" : value.current.observation || found > 0 ? "partial" : "missing";
    return {
      module: "satellite",
      status,
      value,
      sources: [
        {
          name: "Sentinel-2 L2A (Copernicus) przez Microsoft Planetary Computer (STAC + data API)",
          url: "https://planetarycomputer.microsoft.com/dataset/sentinel-2-l2a",
          license: "Dane Copernicus Sentinel: bezpłatne, licencja Copernicus; serwis zgodnie z Microsoft Planetary Computer Terms of Use",
          mode: "live"
        }
      ],
      fetchedAt: new Date(savedAt).toISOString(),
      period: { from: value.history.at(-1)?.from ?? value.current.from, to: value.current.to },
      uncertainty: "medium",
      notes
    };
  }
};
