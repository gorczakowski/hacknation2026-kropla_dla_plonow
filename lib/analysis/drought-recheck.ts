import { addDays } from "@/lib/dates";
import type { MeteoMonthlyHistory } from "./values";

export const PREPARATION_DAYS = 14;
const FALLBACK_DAYS = 7;
const MIN_YEARS_WITH_DATA = 6;

/** Select the next recurring deficit month in the application's April–September season. */
export function planDroughtRecheck(generatedOn: string, history?: MeteoMonthlyHistory) {
  const riskMonths = (history?.months ?? [])
    .filter(month => month.month >= 4 && month.month <= 9 &&
      month.yearsWithData >= MIN_YEARS_WITH_DATA && month.deficitYears > month.yearsWithData / 2)
    .sort((a, b) => a.month - b.month);
  const [year, month] = generatedOn.split("-").map(Number);
  const nextThisYear = riskMonths.find(candidate => candidate.month >= month);
  const risk = nextThisYear ?? riskMonths[0];
  if (!risk) return { date: addDays(generatedOn, FALLBACK_DAYS), risk: null };

  const riskYear = nextThisYear ? year : year + 1;
  const monthStart = `${riskYear}-${String(risk.month).padStart(2, "0")}-01`;
  const preparationDate = addDays(monthStart, -PREPARATION_DAYS);
  const withLeadTime = preparationDate > generatedOn;
  return {
    date: withLeadTime ? preparationDate : addDays(generatedOn, 1),
    risk: { ...risk, year: riskYear, withLeadTime }
  };
}
