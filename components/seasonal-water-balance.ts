import type { MeteoHistoricalMonth, MeteoMonthlyHistory } from "@/lib/analysis/values";

export const MONTHS = ["", "styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"];
export const SEASONAL_WATER_TITLE = "Sezonowy deficyt wody";
export const SEASONAL_WATER_NOTE = "Deficyt oznacza, że opad był niższy od ewapotranspiracji referencyjnej (ET0). Mediana pokazuje typowy bilans dla okolicy działki. Uwzględniono miesiące z danymi za każdy dzień.";
export const SEASONAL_WATER_MISSING = "Brak pełnych danych do porównania miesięcy.";
export const SEASONAL_WATER_COLUMNS = ["Miesiąc", "Mediana bilansu", "Lata z deficytem"];

export function formatHistoricalBalance(balance: number | null) {
  return balance === null ? "—" : `${balance.toLocaleString("pl-PL", { maximumFractionDigits: 1, signDisplay: "exceptZero" })} mm`;
}

export function formatDeficitYears(month: MeteoHistoricalMonth) {
  return month.yearsWithData ? `${month.deficitYears} z ${month.yearsWithData}` : "—";
}

export function seasonalWaterSummary(history: MeteoMonthlyHistory) {
  const expectedYears = history.toYear - history.fromYear + 1;
  if (history.months.some(month => month.yearsWithData < expectedYears)) return null;
  const driest = [...history.months].sort((a, b) => (a.medianBalance ?? 0) - (b.medianBalance ?? 0))[0];
  if (!driest || driest.medianBalance === null || driest.medianBalance >= 0) return null;
  return `Najniższy typowy bilans miał ${MONTHS[driest.month]} (${formatHistoricalBalance(driest.medianBalance)}). Deficyt wystąpił w ${formatDeficitYears(driest)} lat.`;
}
