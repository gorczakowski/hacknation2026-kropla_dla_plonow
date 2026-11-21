import "server-only";
import type { GpkgFeature } from "@/lib/bdot10k/gpkg";
import { BDOT_SOURCE, bdotLayer, countyOfParcel, formatVersion, queryLayer } from "@/lib/bdot10k/source";
import {
  bboxDistance,
  bboxOfPolygons,
  expandBbox,
  mapPolygons,
  polygonsArea,
  polygonsDistance,
  polygonsOf,
  segmentDistanceToPolygons,
  segmentLength,
  type PolygonRings
} from "@/lib/geo/geometry";
import { toPuwg92 } from "@/lib/geo/proj";
import { MODULE_LABELS, type AnalysisModule, type DataEnvelope } from "../contract";
import type { HydroValue, LineFeatureSummary, WaterBodySummary } from "../values";

const SEARCH_M = 1500;
const NEAR_M = 500;
const CLOSE_M = 100;

const LINE_COLUMNS = ["NAZWA", "RODZAJ", "POLOZENIE"];

function summarizeLines(features: GpkgFeature[], parcel: PolygonRings[], kind: (p: Record<string, unknown>) => string): LineFeatureSummary {
  const s: LineFeatureSummary = {
    count500: 0,
    lengthInside: 0,
    length100: 0,
    length500: 0,
    nearestM: null,
    nearestName: null,
    nearestKind: null
  };
  let nearest = Infinity;
  for (const f of features) {
    if (f.geom.kind !== "lines" || f.props.POLOZENIE === "pod powierzchnią") continue;
    let featureMin = Infinity;
    for (const line of f.geom.lines) {
      for (let i = 1; i < line.length; i++) {
        const d = segmentDistanceToPolygons(line[i - 1], line[i], parcel);
        const len = segmentLength(line[i - 1], line[i]);
        if (d === 0) s.lengthInside += len;
        if (d <= CLOSE_M) s.length100 += len;
        if (d <= NEAR_M) s.length500 += len;
        if (d < featureMin) featureMin = d;
      }
    }
    if (featureMin <= NEAR_M) s.count500++;
    if (featureMin < nearest) {
      nearest = featureMin;
      s.nearestName = typeof f.props.NAZWA === "string" && f.props.NAZWA ? f.props.NAZWA : null;
      s.nearestKind = kind(f.props);
    }
  }
  s.nearestM = Number.isFinite(nearest) ? Math.round(nearest) : null;
  s.lengthInside = Math.round(s.lengthInside);
  s.length100 = Math.round(s.length100);
  s.length500 = Math.round(s.length500);
  return s;
}

function summarizeWaterBodies(features: GpkgFeature[], parcel: PolygonRings[]): WaterBodySummary {
  const s: WaterBodySummary = {
    count500: 0,
    standing500: 0,
    areaHa500: 0,
    nearestM: null,
    nearestKind: null,
    nearestName: null,
    nearestAreaHa: null
  };
  const parcelBox = bboxOfPolygons(parcel);
  let nearest = Infinity;
  for (const f of features) {
    if (f.geom.kind !== "polygons") continue;
    const polygons = f.geom.polygons;
    if (bboxDistance(bboxOfPolygons(polygons), parcelBox) > Math.min(nearest, SEARCH_M)) continue;
    const d = polygonsDistance(polygons, parcel);
    const areaHa = polygonsArea(polygons) / 10_000;
    if (d <= NEAR_M) {
      s.count500++;
      s.areaHa500 += areaHa;
      if (f.props.RODZAJ === "woda stojąca") s.standing500++;
    }
    if (d < nearest) {
      nearest = d;
      s.nearestKind = typeof f.props.RODZAJ === "string" ? f.props.RODZAJ : null;
      s.nearestName = typeof f.props.NAZWA === "string" && f.props.NAZWA ? f.props.NAZWA : null;
      s.nearestAreaHa = Math.round(areaHa * 100) / 100;
    }
  }
  s.nearestM = Number.isFinite(nearest) ? Math.round(nearest) : null;
  s.areaHa500 = Math.round(s.areaHa500 * 100) / 100;
  return s;
}

/** Ditches, watercourses, canals and water bodies on and around the parcel (BDOT10k). */
export const hydroModule: AnalysisModule<HydroValue> = {
  id: "hydro",
  label: MODULE_LABELS.hydro,
  async run(ctx): Promise<DataEnvelope<HydroValue>> {
    const county = countyOfParcel(ctx.parcel.properties.id);
    if (!county) {
      return {
        module: "hydro",
        status: "missing",
        value: null,
        sources: [BDOT_SOURCE],
        fetchedAt: new Date().toISOString(),
        notes: ["Nie rozpoznano kodu powiatu w identyfikatorze działki, więc nie pobrano BDOT10k."]
      };
    }
    const [ditchL, riverL, canalL, waterL] = await Promise.all(
      ["OT_SWRM_L", "OT_SWRS_L", "OT_SWKN_L", "OT_PTWP_A"].map(l => bdotLayer(county, l, ctx.signal))
    );

    const parcel = mapPolygons(polygonsOf(ctx.parcel.geometry), toPuwg92);
    const search = expandBbox(bboxOfPolygons(parcel), SEARCH_M);

    const value: HydroValue = {
      county,
      bdotVersion: formatVersion(ditchL.version),
      searchRadiusM: SEARCH_M,
      ditches: summarizeLines(queryLayer(ditchL, search, LINE_COLUMNS), parcel, () => "rów melioracyjny"),
      watercourses: summarizeLines(queryLayer(riverL, search, LINE_COLUMNS), parcel, p =>
        typeof p.RODZAJ === "string" ? p.RODZAJ : "ciek"
      ),
      canals: summarizeLines(queryLayer(canalL, search, LINE_COLUMNS), parcel, () => "kanał"),
      waterBodies: summarizeWaterBodies(queryLayer(waterL, search, ["RODZAJ", "NAZWA"]), parcel)
    };

    return {
      module: "hydro",
      status: "ok",
      value,
      sources: [BDOT_SOURCE],
      fetchedAt: ditchL.fetchedAt,
      uncertainty: "medium",
      notes: [
        `BDOT10k powiatu ${county}, wersja pliku z ${value.bdotVersion}: rowy melioracyjne (OT_SWRM_L), rzeki i strumienie (OT_SWRS_L), kanały (OT_SWKN_L), wody powierzchniowe (OT_PTWP_A). Rowy podziemne pominięto.`,
        `Najbliższe obiekty szukane w promieniu ${SEARCH_M} m. Długości liczone odcinkami: odcinek wchodzi w całości, gdy jakakolwiek jego część jest w danej odległości, więc są przybliżone.`,
        "BDOT10k nie opisuje stanu rowów ani urządzeń piętrzących (zastawek); najmniejsze rowy i oczka wodne mogą nie być ujęte. Dla dat historycznych użyto bieżącej wersji bazy."
      ]
    };
  }
};

