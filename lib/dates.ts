/** Analysis dates are calendar days in Poland, as YYYY-MM-DD strings. */
const TZ = "Europe/Warsaw";
export const HISTORY_YEARS = 10;

export function todayInPoland(now = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);
}

/** The earliest analysis date the jury may ask for: today minus 10 years. */
export function earliestAnalysisDate(today = todayInPoland()): string {
  const [y, m, d] = today.split("-").map(Number);
  // 29 Feb → 28 Feb when the target year is not a leap year.
  const date = new Date(Date.UTC(y - HISTORY_YEARS, m - 1, d));
  if (date.getUTCMonth() !== m - 1) date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

export function isValidAnalysisDate(value: unknown, today = todayInPoland()): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return false;
  return value >= earliestAnalysisDate(today) && value <= today;
}

export function formatDatePl(value: string) {
  return new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`)
  );
}
