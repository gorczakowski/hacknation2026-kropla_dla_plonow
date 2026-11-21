import "server-only";
import { KUS_2016 } from "@/lib/reference/kus2016";
import { DAY, diskCached } from "@/lib/server/disk-cache";
import { readSoilGrids, type SoilProperty } from "@/lib/soil/soilgrids";
import { usdaTexture } from "@/lib/soil/texture";
import { MODULE_LABELS, type AnalysisModule, type DataEnvelope } from "../contract";
import type { SoilTopsoil, SoilValue, SoilWaterLayer } from "../values";

/*
 * ISRIC's WCS answers in 0.5–1.6 s per layer and drops requests under load, so
 * the set is kept to 18: sand, clay and SOC in three topsoil layers (silt =
 * 100 − sand − clay), pH once, and water content in four layers to 1 m (the
 * 5–15 cm value stands for 0–15 cm).
 */
const TOPSOIL_DEPTHS = [
  { depth: "0-5cm", cm: 5 },
  { depth: "5-15cm", cm: 10 },
  { depth: "15-30cm", cm: 15 }
];
const WATER_DEPTHS = [
  { depth: "5-15cm", cm: 15 },
  { depth: "15-30cm", cm: 15 },
  { depth: "30-60cm", cm: 30 },
  { depth: "60-100cm", cm: 40 }
];
const PH_DEPTH = "5-15cm";

class IncompleteSoil extends Error {
  constructor(public value: SoilValue) {
    super("incomplete SoilGrids read");
  }
}

const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

function weighted(values: (number | null)[], weights: number[]): number | null {
  let sum = 0;
  let w = 0;
  values.forEach((v, i) => {
    if (v !== null) {
      sum += v * weights[i];
      w += weights[i];
    }
  });
  return w ? sum / w : null;
}

/** Reads all layers; failed requests become nulls and are counted in `failed`. */
async function loadSoil(lon: number, lat: number, signal: AbortSignal): Promise<{ value: SoilValue; failed: number }> {
  let failed = 0;
  const read = (p: SoilProperty, depth: string) =>
    readSoilGrids(p, depth, lon, lat, signal).catch(() => {
      failed++;
      return null;
    });

  const topsoilReads = TOPSOIL_DEPTHS.map(({ depth }) =>
    Promise.all([read("sand", depth), read("clay", depth), read("soc", depth), depth === PH_DEPTH ? read("phh2o", depth) : null]).then(
      ([sand, clay, soc, ph]) => ({
        depth,
        sand,
        silt: sand !== null && clay !== null ? Math.max(0, 100 - sand - clay) : null,
        clay,
        soc,
        ph
      })
    )
  );
  const waterReads = WATER_DEPTHS.map(({ depth, cm }) =>
    Promise.all([read("wv0033", depth), read("wv1500", depth)]).then(
      ([fc, wp]): SoilWaterLayer => ({ depth, thicknessCm: cm, fieldCapacity: fc, wiltingPoint: wp })
    )
  );
  const [layers, waterLayers] = await Promise.all([Promise.all(topsoilReads), Promise.all(waterReads)]);

  const weights = TOPSOIL_DEPTHS.map(d => d.cm);
  const pick = (k: keyof SoilTopsoil) => r1(weighted(layers.map(l => l[k]), weights));
  const topsoil: SoilTopsoil = { sand: pick("sand"), silt: pick("silt"), clay: pick("clay"), soc: pick("soc"), ph: pick("ph") };

  const texture =
    topsoil.sand !== null && topsoil.silt !== null && topsoil.clay !== null
      ? usdaTexture(topsoil.sand, topsoil.silt, topsoil.clay)
      : null;

  const complete = waterLayers.every(l => l.fieldCapacity !== null && l.wiltingPoint !== null);
  const availableWater0to100 = complete
    ? Math.round(waterLayers.reduce((s, l) => s + (l.fieldCapacity! - l.wiltingPoint!) * (l.thicknessCm / 100), 0))
    : null;

  const value: SoilValue = {
    point: [lon, lat],
    topsoil,
    layers: layers.map(l => ({ ...l, sand: r1(l.sand), silt: r1(l.silt), clay: r1(l.clay), soc: r1(l.soc), ph: r1(l.ph) })),
    texture: texture ? { usda: texture.usda, pl: texture.pl } : null,
    kusCategory: texture?.kus ?? null,
    availableWater0to100,
    waterLayers
  };
  return { value, failed };
}

/** Soil texture, organic carbon, pH and plant-available water at the parcel (SoilGrids 250 m). */
export const soilModule: AnalysisModule<SoilValue> = {
  id: "soil",
  label: MODULE_LABELS.soil,
  async run(ctx): Promise<DataEnvelope<SoilValue>> {
    const [lon, lat] = ctx.parcel.properties.labelPoint;
    const key = `${lon.toFixed(3)},${lat.toFixed(3)}`;
    // A read with failed requests is used once but not cached, so the next run retries.
    const { value, savedAt } = await diskCached("soilgrids", key, 180 * DAY, async () => {
      const { value, failed } = await loadSoil(lon, lat, ctx.signal);
      if (failed > 0) throw new IncompleteSoil(value);
      return value;
    }).catch(error => {
      if (error instanceof IncompleteSoil) return { value: error.value, savedAt: Date.now() };
      throw error;
    });

    const gaps = value.layers.some(l => l.sand === null || l.clay === null) || value.availableWater0to100 === null;
    const notes = [
      "SoilGrids to globalna prognoza modelowa w siatce 250 m, a nie pomiar na działce. Na małych działkach i w dolinach może odbiegać od mapy glebowo-rolniczej.",
      "Woda dostępna = wilgotność przy 33 kPa (pF 2,5) minus przy 1500 kPa (pF 4,2), zsumowana dla 0–100 cm.",
      `Kategoria gleby (bardzo lekka … bardzo ciężka) jest przybliżeniem z klasy uziarnienia USDA, dla porównania z tabelą 4 w: ${KUS_2016.citation}.`
    ];
    if (gaps) notes.push("Część warstw nie ma wartości: SoilGrids nie odpowiedział na część zapytań albo maskuje ten punkt (zabudowa, woda).");

    return {
      module: "soil",
      status: value.texture === null ? "missing" : gaps ? "partial" : "ok",
      value,
      sources: [
        {
          name: "ISRIC SoilGrids 2.0 (WCS): uziarnienie, węgiel organiczny, pH, retencja wody",
          url: "https://docs.isric.org/globaldata/soilgrids/",
          license: "CC BY 4.0",
          mode: "live"
        }
      ],
      fetchedAt: new Date(savedAt).toISOString(),
      uncertainty: "high",
      notes
    };
  }
};
