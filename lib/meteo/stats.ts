import type { MeteoMonth, MeteoMonthlyHistory, MeteoSeason, MeteoValue, MeteoWindow, MeteoYearWindow } from "@/lib/analysis/values";
import { addDays, daysBetween, HISTORY_YEARS, minDate, shiftYears } from "@/lib/dates";
import { isComplete, type DailyRecord, type MeteoSeries } from "./series";

const WINDOWS = [30, 60, 90];
const SAME_WINDOW_DAYS = 60;
/** A day with less precipitation counts as dry (IMGW convention for "dzień bez opadu" is 0.1 mm; 1 mm is the agronomic one). */
const WET_DAY_MM = 1;
const HOT_DAY_C = 30;

const r1 = (v: number) => Math.round(v * 10) / 10;

type Totals = Omit<MeteoWindow, "days" | "from" | "to">;

function accumulate(byDate: Map<string, DailyRecord>, from: string, to: string): Totals {
  let precipitation = 0, et0 = 0, tSum = 0, tN = 0, hotDays = 0, wetDays = 0, daysWithData = 0, run = 0, longest = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const r = byDate.get(d);
    if (!r || !isComplete(r)) continue;
    daysWithData++;
    precipitation += r.p!;
    et0 += r.et0!;
    if (r.tMean !== null) {
      tSum += r.tMean;
      tN++;
    }
    if (r.tMax !== null && r.tMax >= HOT_DAY_C) hotDays++;
    if (r.p! >= WET_DAY_MM) {
      wetDays++;
      run = 0;
    } else {
      run++;
      if (run > longest) longest = run;
    }
  }
  return {
    daysWithData,
    precipitation: r1(precipitation),
    et0: r1(et0),
    balance: precipitation - et0,
    tMean: tN ? r1(tSum / tN) : null,
    hotDays,
    wetDays,
    longestDrySpell: longest
  };
}

function summarizeMonthlyHistory(days: DailyRecord[], analysisYear: number): MeteoMonthlyHistory {
  const fromYear = analysisYear - HISTORY_YEARS;
  const toYear = analysisYear - 1;
  const byDate = new Map(days.filter(d => !d.recent).map(d => [d.date, d]));

  const months = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const balances: number[] = [];
    for (let year = fromYear; year <= toYear; year++) {
      const from = `${year}-${String(month).padStart(2, "0")}-01`;
      const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
      const to = addDays(nextMonth, -1);
      const total = accumulate(byDate, from, to);
      if (total.daysWithData === daysBetween(from, nextMonth)) {
        // Discard floating-point noise without rounding away small deficits.
        balances.push(Math.abs(total.balance) < 1e-9 ? 0 : total.balance);
      }
    }
    if (balances.length === 0) return { month, yearsWithData: 0, deficitYears: 0, medianBalance: null };
    balances.sort((a, b) => a - b);
    const mid = Math.floor(balances.length / 2);
    const median = balances.length % 2 ? balances[mid] : (balances[mid - 1] + balances[mid]) / 2;
    const medianBalance = r1(median) || 0;
    return { month, yearsWithData: balances.length, deficitYears: balances.filter(balance => balance < 0).length, medianBalance };
  });

  return { fromYear, toYear, months };
}

/** Summarises a daily series up to the analysis day; null when there is no usable day. */
export function summarizeMeteo(series: MeteoSeries, asOf: string, through = asOf): Omit<MeteoValue, "provider" | "gridPoint"> | null {
  const end = minDate(asOf, through);
  const days = series.days.filter(d => d.date <= end);
  const usable = days.filter(isComplete);
  if (usable.length === 0) return null;
  const byDate = new Map(days.map(d => [d.date, d]));
  const first = usable[0].date;
  const lastDay = usable[usable.length - 1].date;

  const windows: MeteoWindow[] = WINDOWS.map(n => {
    const from = addDays(lastDay, -(n - 1));
    const total = accumulate(byDate, from, lastDay);
    return { days: n, from, to: lastDay, ...total, balance: r1(total.balance) };
  });

  const sameWindow: MeteoYearWindow[] = [];
  for (let k = 0; k <= 10; k++) {
    const to = shiftYears(lastDay, -k);
    const from = addDays(to, -(SAME_WINDOW_DAYS - 1));
    if (from < first) break;
    const t = accumulate(byDate, from, to);
    if (t.daysWithData < SAME_WINDOW_DAYS - 5) continue;
    sameWindow.push({ year: Number(to.slice(0, 4)), from, to, precipitation: t.precipitation, et0: t.et0, balance: r1(t.balance) });
  }
  const ranked = [...sameWindow].sort((a, b) => a.balance - b.balance);
  const current = sameWindow[0];
  const sameWindowRank =
    current && current.to === lastDay ? { rank: ranked.indexOf(current) + 1, of: ranked.length } : null;

  const seasons: MeteoSeason[] = [];
  for (let y = Number(lastDay.slice(0, 4)); y >= Number(first.slice(0, 4)); y--) {
    const from = `${y}-04-01`;
    if (from > lastDay) continue;
    if (from < first) break;
    const to = minDate(`${y}-09-30`, lastDay);
    const t = accumulate(byDate, from, to);
    seasons.push({
      year: y,
      from,
      to,
      complete: `${y}-09-30` <= lastDay,
      precipitation: t.precipitation,
      et0: t.et0,
      balance: r1(t.balance),
      longestDrySpell: t.longestDrySpell,
      hotDays: t.hotDays
    });
  }

  const seasonYear = Number(lastDay.slice(5, 7)) >= 4 ? Number(lastDay.slice(0, 4)) : Number(lastDay.slice(0, 4)) - 1;
  const seasonMonths: MeteoMonth[] = [];
  for (let m = 4; m <= 9; m++) {
    const from = `${seasonYear}-${String(m).padStart(2, "0")}-01`;
    if (from > lastDay || from < first) continue;
    const monthEnd = addDays(m === 12 ? `${seasonYear + 1}-01-01` : `${seasonYear}-${String(m + 1).padStart(2, "0")}-01`, -1);
    const t = accumulate(byDate, from, minDate(monthEnd, lastDay));
    seasonMonths.push({ month: from.slice(0, 7), precipitation: t.precipitation, et0: t.et0, complete: monthEnd <= lastDay });
  }

  const recentDaysFromForecast = days.filter(d => d.recent && d.date <= lastDay && isComplete(d)).length;

  const monthlyHistory = summarizeMonthlyHistory(usable, Number(asOf.slice(0, 4)));
  return { lastDay, recentDaysFromForecast, windows, sameWindow, sameWindowRank, seasons, seasonMonths, monthlyHistory };
}
