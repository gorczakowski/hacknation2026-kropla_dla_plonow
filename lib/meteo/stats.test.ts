import assert from "node:assert/strict";
import { it } from "node:test";
import { addDays } from "@/lib/dates";
import type { DailyRecord, MeteoSeries } from "./series";
import { summarizeMeteo } from "./stats";

it("compares complete calendar months from the ten previous years", () => {
  const days: DailyRecord[] = [];
  for (let date = "2015-01-01"; date <= "2026-11-21"; date = addDays(date, 1)) {
    const year = Number(date.slice(0, 4));
    const month = Number(date.slice(5, 7));
    const p = month === 7 && year >= 2018 && year < 2026 ? 1 : 5;
    days.push({
      date, p: date === "2020-02-29" ? null : p, et0: 3, tMean: 15, tMax: 21, recent: date === "2025-12-31"
    });
  }
  const series: MeteoSeries = { provider: "open-meteo-era5", lat: 52, lon: 21, elevation: null, days };
  const history = summarizeMeteo(series, "2026-11-22")?.monthlyHistory;
  assert.ok(history);
  assert.equal(history.fromYear, 2016);
  assert.equal(history.toYear, 2025);
  assert.equal(history.months.length, 12);
  assert.deepEqual(history.months[0], { month: 1, yearsWithData: 10, deficitYears: 0, medianBalance: 62 });
  assert.equal(history.months[1].yearsWithData, 9);
  assert.deepEqual(history.months[6], { month: 7, yearsWithData: 10, deficitYears: 8, medianBalance: -62 });
  assert.equal(history.months[11].yearsWithData, 9);
});

it("keeps the new year's historical baseline when the latest data is from December", () => {
  const series: MeteoSeries = {
    provider: "nasa-power", lat: 52, lon: 21, elevation: null,
    days: [{ date: "2025-12-31", p: 1, et0: 0.5, tMean: 0, tMax: 2 }]
  };
  const summary = summarizeMeteo(series, "2026-01-01");
  assert.equal(summary?.lastDay, "2025-12-31");
  assert.equal(summary?.monthlyHistory?.toYear, 2025);
  assert.deepEqual(summary?.monthlyHistory?.months[11], { month: 12, yearsWithData: 0, deficitYears: 0, medianBalance: null });
});

it("uses the unrounded sign for deficit counts and reports the median to one decimal", () => {
  const days: DailyRecord[] = [];
  for (let date = "2024-01-01"; date < "2024-02-01"; date = addDays(date, 1)) {
    days.push({ date, p: 1, et0: date === "2024-01-01" ? 1.04 : 1, tMean: 0, tMax: 2 });
  }
  const series: MeteoSeries = { provider: "open-meteo-era5", lat: 52, lon: 21, elevation: null, days };
  const january = summarizeMeteo(series, "2025-01-01")?.monthlyHistory?.months[0];
  assert.deepEqual(january, { month: 1, yearsWithData: 1, deficitYears: 1, medianBalance: 0 });
});

it("keeps the analysis year but respects the last available full day", () => {
  const series: MeteoSeries = {
    provider: "open-meteo-era5", lat: 52, lon: 21, elevation: null,
    days: [
      { date: "2025-12-31", p: 1, et0: 0.5, tMean: 0, tMax: 2 },
      { date: "2026-01-01", p: 2, et0: 0.5, tMean: 0, tMax: 2, recent: true }
    ]
  };
  const summary = summarizeMeteo(series, "2026-01-01", "2025-12-31");
  assert.equal(summary?.lastDay, "2025-12-31");
  assert.equal(summary?.recentDaysFromForecast, 0);
  assert.equal(summary?.monthlyHistory?.toYear, 2025);
});
