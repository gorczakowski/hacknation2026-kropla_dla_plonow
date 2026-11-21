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

/** YYYY-MM-DD plus n days (n may be negative). */
export function addDays(value: string, n: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

/** The same calendar day k years later (k may be negative); 29 Feb becomes 28 Feb. */
export function shiftYears(value: string, k: number): string {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y + k, m - 1, d));
  if (date.getUTCMonth() !== m - 1) date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function minDate(a: string, b: string) {
  return a < b ? a : b;
}

export function formatDatePl(value: string) {
  return new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`)
  );
}
