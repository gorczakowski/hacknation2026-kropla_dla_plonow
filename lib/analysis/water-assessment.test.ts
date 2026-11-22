import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DataEnvelope, FieldObservation, ModuleId } from "./contract";
import { recommendRetention } from "./retention";
import type { HydroValue, MeteoValue, MeteoWindow, SoilValue, TerrainValue } from "./values";
import { assessParcelWater, BANDS, LIGHT_SOIL_BANDS } from "./water-assessment";

const DATE = "2026-07-15";

function envelope<T>(module: ModuleId, value: T): DataEnvelope<T> {
  return { module, status: "ok", value, sources: [], fetchedAt: `${DATE}T12:00:00Z`, notes: [] };
}

function meteoWindow(days: number, balance: number, to: string): MeteoWindow {
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  return {
    days, from, to, daysWithData: days, precipitation: 0, et0: -balance, balance,
    tMean: 18, hotDays: 0, wetDays: 0, longestDrySpell: 0
  };
}

function meteo({ balance30, balance60 = balance30 * 2, rank = null, to = DATE }: {
  balance30: number;
  balance60?: number;
  rank?: MeteoValue["sameWindowRank"];
  to?: string;
}) {
  return envelope<MeteoValue>("meteo", {
    provider: "open-meteo-era5",
    gridPoint: { lat: 52, lon: 21, elevation: 100 },
    lastDay: to,
    recentDaysFromForecast: 0,
    windows: [meteoWindow(30, balance30, to), meteoWindow(60, balance60, to)],
    sameWindow: [],
    sameWindowRank: rank,
    seasons: [],
    seasonMonths: []
  });
}

function soil(kusCategory: string | null) {
  return envelope<SoilValue>("soil", {
    point: [21, 52], topsoil: { sand: null, silt: null, clay: null, soc: null, ph: null }, layers: [],
    texture: null, kusCategory, availableWater0to100: null, waterLayers: []
  });
}

function score(balance30: number, options: { light?: boolean; rank?: MeteoValue["sameWindowRank"]; balance60?: number; observations?: FieldObservation[] } = {}) {
  const modules = [meteo({ balance30, balance60: options.balance60, rank: options.rank }), soil(options.light ? "lekka" : "średnia")];
  return assessParcelWater(modules, "zboza-ozime", DATE, options.observations);
}

describe("assessParcelWater", () => {
  it("maps the 30-day deficit to the documented bands", () => {
    const cases: [number, number][] = [[25, 5], [-14, 5], [-15, 4], [-34, 4], [-35, 3], [-60, 2], [-89, 2], [-90, 1], [-200, 1]];
    for (const [balance, expected] of cases) assert.equal(score(balance).score, expected, `balance ${balance}`);
  });

  it("uses lower thresholds on light soil without jumping two points", () => {
    assert.equal(score(-9, { light: true }).score, 5);
    assert.equal(score(-10, { light: true }).score, 4);
    assert.equal(score(-15, { light: true }).score, 4);
    for (let deficit = 0; deficit <= 120; deficit++) {
      const light = score(-deficit, { light: true }).score!;
      const standard = score(-deficit).score!;
      assert.ok(light <= standard && standard - light <= 1, `deficit ${deficit}: ${light} vs ${standard}`);
      if (deficit > 0) assert.ok(score(-(deficit - 1), { light: true }).score! - light <= 1, `step at ${deficit}`);
    }
  });

  it("has light-soil thresholds below the standard ones", () => {
    LIGHT_SOIL_BANDS.forEach(([mm, value], i) => {
      assert.equal(value, BANDS[i][1]);
      assert.ok(mm < BANDS[i][0]);
    });
  });

  it("shifts the score by one point for an unusually dry or wet season", () => {
    assert.equal(score(-40, { rank: { rank: 1, of: 11 } }).score, 2);
    assert.equal(score(-40, { rank: { rank: 2, of: 11 } }).score, 2);
    assert.equal(score(-40, { rank: { rank: 6, of: 11 } }).score, 3);
    assert.equal(score(-40, { rank: { rank: 11, of: 11 } }).score, 4);
    assert.equal(score(-100, { rank: { rank: 1, of: 11 } }).score, 1);
    assert.equal(score(10, { rank: { rank: 11, of: 11 } }).score, 5);
  });

  it("ignores the season rank with too few years or a positive 60-day balance", () => {
    assert.equal(score(-40, { rank: { rank: 1, of: 5 } }).score, 3);
    assert.equal(score(-20, { balance60: 5, rank: { rank: 1, of: 11 } }).score, 4);
  });

  it("reports ponding as excess water without changing the deficit score", () => {
    const dryish = score(-10, { observations: ["ponding"] });
    assert.equal(dryish.score, 5);
    assert.equal(dryish.excessWater, true);
    assert.equal(score(-40, { observations: ["ponding"] }).score, 3);
    assert.equal(score(-40).excessWater, false);
  });

  it("gives no score without a complete, recent weather window", () => {
    assert.equal(assessParcelWater([], "zboza-ozime", DATE).score, null);
    const stale = assessParcelWater([meteo({ balance30: -50, to: "2026-07-05" })], "zboza-ozime", DATE, ["ponding"]);
    assert.equal(stale.score, null);
    assert.equal(stale.excessWater, true);
    assert.deepEqual(stale.recommendations, []);
  });
});

const terrain = (overrides: Partial<TerrainValue> = {}): TerrainValue => ({
  dataset: "NMT", cellSizeM: [1, 1], parcelCells: 100,
  elevation: { min: 100, mean: 101, max: 102 }, slopePct: { mean: 1, max: 3 }, steepShare: 0,
  surroundings: { radiusM: 200, mean: 101, min: 99, max: 103 }, relativeElevation: 0,
  position: "równina", drainsTowards: null, lowestPoint: [21, 52], clipped: false,
  ...overrides
});

const line = { count500: 0, lengthInside: 0, length100: 0, length500: 0, nearestM: null, nearestName: null, nearestKind: null };
const hydro = (ditchM: number | null): HydroValue => ({
  county: "x", bdotVersion: "x", searchRadiusM: 500,
  ditches: { ...line, nearestM: ditchM }, watercourses: line, canals: line,
  waterBodies: { count500: 0, standing500: 0, areaHa500: 0, nearestM: null, nearestKind: null, nearestName: null, nearestAreaHa: null }
});

function recommend(observations: FieldObservation[], options: Partial<Parameters<typeof recommendRetention>[0]> = {}) {
  return recommendRetention({
    crop: "zboza-ozime", observations: new Set(observations), lightSoil: false, dry: false, terrain: null, hydro: null, ...options
  });
}
const titles = (list: ReturnType<typeof recommend>) => list.map(practice => practice.title);

describe("recommendRetention", () => {
  it("suggests checking for a compacted layer when ponding is reported", () => {
    const [practice] = recommend(["ponding"]);
    assert.equal(practice.title, "Miejscowe głęboszowanie");
    assert.equal(practice.needsCheck, true);
    const [confirmed] = recommend(["compactedLayer", "ponding"]);
    assert.equal(confirmed.title, "Miejscowe głęboszowanie");
    assert.equal(confirmed.needsCheck, undefined);
  });

  it("returns at most three practices, mixing both kinds", () => {
    const list = recommend(["bareAfterHarvest", "runoffRills", "lowOrganicMatter", "windExposure"], { terrain: terrain() });
    assert.equal(list.length, 3);
    assert.deepEqual(list.map(practice => practice.kind), ["agrotechnical", "retention", "agrotechnical"]);
  });

  it("does not suggest field-crop practices for perennial crops", () => {
    assert.deepEqual(recommend(["bareAfterHarvest", "compactedLayer"], { crop: "drzewa-owocowe" }), []);
  });

  it("suggests controlled drainage only when dry and not ponding", () => {
    assert.ok(titles(recommend(["activeDrainage"], { dry: true })).includes("Ocena możliwości sterowania odpływem"));
    assert.ok(!titles(recommend(["activeDrainage"], { dry: false })).includes("Ocena możliwości sterowania odpływem"));
    assert.ok(!titles(recommend(["activeDrainage", "ponding"], { dry: true })).includes("Ocena możliwości sterowania odpływem"));
    assert.ok(titles(recommend([], { dry: true, terrain: terrain(), hydro: hydro(50) })).includes("Ocena możliwości sterowania odpływem"));
  });

  it("suggests a pond for a dry parcel lying below its surroundings", () => {
    const [practice] = recommend([], { dry: true, terrain: terrain({ relativeElevation: -2 }) });
    assert.equal(practice.title, "Ocena możliwości budowy małego zbiornika");
    assert.ok(practice.funding);
  });

  it("lists the buffer strip once and attaches subsidies from the guide", () => {
    const list = recommend(["runoffRills", "bareAfterHarvest"], { terrain: terrain({ drainsTowards: "północ" }), hydro: hydro(30) });
    assert.equal(titles(list).filter(title => title === "Zadarniony pas buforowy").length, 1);
    const cover = recommend(["bareAfterHarvest"]).find(practice => practice.title === "Międzyplon ozimy lub wsiewka");
    assert.match(cover?.funding ?? "", /484,30 zł\/ha/);
  });
});
