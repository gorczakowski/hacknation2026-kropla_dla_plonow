const ha = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const m2 = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 });

export function formatArea(areaHa: number) {
  return areaHa < 0.1 ? `${m2.format(areaHa * 10_000)} m²` : `${ha.format(areaHa)} ha`;
}

/** Polish plural for "działka": 1 działkę, 2–4 działki, 5+ działek (accusative). */
export function parcelsAccusative(n: number) {
  if (n === 1) return "działkę";
  const lastTwo = n % 100;
  const last = n % 10;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return `${n} działki`;
  return `${n} działek`;
}
