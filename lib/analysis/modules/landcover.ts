import "server-only";
import { BDOT_SOURCE, bdotLayer, countyOfParcel, formatVersion, queryLayer } from "@/lib/bdot10k/source";
import {
  bboxOfPolygons,
  distPointSegment,
  expandBbox,
  mapPolygons,
  pointInPolygons,
  pointInRings,
  polygonsArea,
  polygonsOf,
  type Bbox,
  type PolygonRings
} from "@/lib/geo/geometry";
import { toPuwg92 } from "@/lib/geo/proj";
import { MODULE_LABELS, type AnalysisModule, type DataEnvelope } from "../contract";
import type { LandCoverShare, LandCoverValue } from "../values";

const RADIUS_M = 500;
const RING_SPACING_M = 25;

/** BDOT10k land-cover classes (OT_PT*_A) and how each is named in the summary. */
const LAYERS: [string, (rodzaj: unknown) => string][] = [
  ["OT_PTTR_A", r => (r === "uprawa na gruntach ornych" ? "grunty orne" : "roślinność trawiasta (łąki, pastwiska)")],
  ["OT_PTUT_A", r => `uprawy trwałe${typeof r === "string" ? `: ${r}` : ""}`],
  ["OT_PTLZ_A", r => (r === "las" ? "las" : r === "zagajnik" ? "zagajnik" : "zadrzewienie")],
  ["OT_PTRK_A", () => "krzewy"],
  ["OT_PTWP_A", () => "wody powierzchniowe"],
  ["OT_PTZB_A", () => "zabudowa"],
  ["OT_PTKM_A", () => "drogi i tereny komunikacyjne"],
  ["OT_PTPL_A", () => "place"],
  ["OT_PTGN_A", () => "grunty nieużytkowane"],
  ["OT_PTNZ_A", () => "tereny techniczne i przemysłowe"],
  ["OT_PTWZ_A", () => "wyrobiska i zwałowiska"],
  ["OT_PTSO_A", () => "składowiska"]
];

type Patch = { label: string; box: Bbox; polygons: PolygonRings[] };

function classify(x: number, y: number, patches: Patch[]): string {
  for (const p of patches) {
    if (x < p.box[0] || x > p.box[2] || y < p.box[1] || y > p.box[3]) continue;
    if (p.polygons.some(rings => pointInRings(x, y, rings))) return p.label;
  }
  return "brak obiektu w BDOT10k";
}

function shares(counts: Map<string, number>, total: number): LandCoverShare[] {
  const list = [...counts.entries()].map(([label, n]) => ({ label, share: n / total })).sort((a, b) => b.share - a.share);
  const main = list.filter(s => s.share >= 0.01);
  const rest = list.filter(s => s.share < 0.01).reduce((s, x) => s + x.share, 0);
  if (rest > 0) main.push({ label: "inne (< 1% każde)", share: rest });
  return main.map(s => ({ ...s, share: Math.round(s.share * 1000) / 1000 }));
}

/** Land cover on the parcel and in a 500 m ring around it (BDOT10k OT_PT* layers). */
export const landcoverModule: AnalysisModule<LandCoverValue> = {
  id: "landcover",
  label: MODULE_LABELS.landcover,
  async run(ctx): Promise<DataEnvelope<LandCoverValue>> {
    const county = countyOfParcel(ctx.parcel.properties.id);
    if (!county) {
      return {
        module: "landcover",
        status: "missing",
        value: null,
        sources: [BDOT_SOURCE],
        fetchedAt: new Date().toISOString(),
        notes: ["Nie rozpoznano kodu powiatu w identyfikatorze działki, więc nie pobrano BDOT10k."]
      };
    }
    const files = await Promise.all(LAYERS.map(([layer]) => bdotLayer(county, layer, ctx.signal)));

    const parcel = mapPolygons(polygonsOf(ctx.parcel.geometry), toPuwg92);
    const parcelBox = bboxOfPolygons(parcel);
    const window = expandBbox(parcelBox, RADIUS_M);

    const patches: Patch[] = [];
    LAYERS.forEach(([, name], i) => {
      for (const f of queryLayer(files[i], window, ["RODZAJ"])) {
        if (f.geom.kind !== "polygons") continue;
        patches.push({ label: name(f.props.RODZAJ), box: bboxOfPolygons(f.geom.polygons), polygons: f.geom.polygons });
      }
    });

    const edges: [number, number, number, number][] = [];
    for (const rings of parcel) for (const ring of rings) for (let i = 1; i < ring.length; i++) edges.push([...ring[i - 1], ...ring[i]]);
    const distToParcel = (x: number, y: number) => edges.reduce((m, [ax, ay, bx, by]) => Math.min(m, distPointSegment(x, y, ax, ay, bx, by)), Infinity);

    const spacing = Math.min(25, Math.max(3, Math.sqrt(polygonsArea(parcel)) / 25));
    const inside = new Map<string, number>();
    const ring = new Map<string, number>();
    let nInside = 0;
    let nRing = 0;
    for (let x = parcelBox[0] + spacing / 2; x < parcelBox[2]; x += spacing) {
      for (let y = parcelBox[1] + spacing / 2; y < parcelBox[3]; y += spacing) {
        if (!pointInPolygons(x, y, parcel)) continue;
        const label = classify(x, y, patches);
        inside.set(label, (inside.get(label) ?? 0) + 1);
        nInside++;
      }
    }
    for (let x = window[0] + RING_SPACING_M / 2; x < window[2]; x += RING_SPACING_M) {
      for (let y = window[1] + RING_SPACING_M / 2; y < window[3]; y += RING_SPACING_M) {
        if (pointInPolygons(x, y, parcel) || distToParcel(x, y) > RADIUS_M) continue;
        const label = classify(x, y, patches);
        ring.set(label, (ring.get(label) ?? 0) + 1);
        nRing++;
      }
    }

    const version = formatVersion(files[0].version);
    const value: LandCoverValue = {
      county,
      bdotVersion: version,
      radiusM: RADIUS_M,
      parcel: nInside ? shares(inside, nInside) : [],
      ring: nRing ? shares(ring, nRing) : [],
      samples: { parcel: nInside, ring: nRing, spacingParcelM: Math.round(spacing * 10) / 10, spacingRingM: RING_SPACING_M }
    };

    return {
      module: "landcover",
      status: nInside ? "ok" : "partial",
      value,
      sources: [BDOT_SOURCE],
      fetchedAt: files[0].fetchedAt,
      uncertainty: "medium",
      notes: [
        `Pokrycie terenu z BDOT10k powiatu ${county} (warstwy OT_PT*), wersja pliku z ${version}. To klasy mapy topograficznej, a nie bieżąca uprawa na polu; dla dat historycznych użyto bieżącej wersji.`,
        `Udziały oszacowano siatką punktów co ${value.samples.spacingParcelM.toLocaleString("pl-PL")} m na działce i co ${RING_SPACING_M} m w pasie ${RADIUS_M} m wokół niej.`
      ]
    };
  }
};
