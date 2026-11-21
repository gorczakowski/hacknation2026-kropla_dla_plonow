/**
 * Reference values from Kuś J. (2016) "Gospodarowanie wodą w rolnictwie",
 * Studia i Raporty IUNG-PIB 47(1): 83–104, doi:10.26114/sir.iung.2016.47.05
 * (https://iung.pl/sir/zeszyt47_5.pdf).
 */
import type { CropId } from "@/lib/crops";

export const KUS_2016 = {
  citation: "Kuś J. (2016), Gospodarowanie wodą w rolnictwie, Studia i Raporty IUNG-PIB 47(1): 83–104",
  url: "https://iung.pl/sir/zeszyt47_5.pdf"
};

/**
 * Table 3: optimal monthly precipitation (mm) for selected crops, April–September,
 * after Dzieżyc (1989). Footnote: 20% more on lighter soils, 20% less on heavier.
 */
export const OPTIMAL_PRECIPITATION: Partial<Record<CropId, { crop: string; months: (number | null)[] }>> = {
  "zboza-ozime": { crop: "pszenica ozima", months: [35, 65, 70, 60, null, null] },
  "zboza-jare": { crop: "pszenica jara", months: [45, 65, 75, 65, null, null] },
  rzepak: { crop: "rzepak ozimy", months: [50, 70, 75, 30, null, null] },
  "kukurydza-ziarno": { crop: "kukurydza", months: [null, 50, 60, 70, 65, 50] },
  "kukurydza-kiszonka": { crop: "kukurydza", months: [null, 50, 60, 70, 65, 50] },
  "burak-cukrowy": { crop: "burak cukrowy", months: [15, 65, 74, 85, 78, 54] },
  "uzytki-zielone": { crop: "trwałe użytki zielone", months: [50, 70, 90, 100, 80, 60] }
};

/** Months of Table 3, as calendar month numbers. */
export const OPTIMAL_PRECIPITATION_MONTHS = [4, 5, 6, 7, 8, 9];

/**
 * Table 4: water held in 0–150 cm by soils of different texture, after Kuś &
 * Nawrocki (1983). PPW field capacity, WTW permanent wilting point, WOD
 * plant-available water; all mm.
 */
export const SOIL_WATER_RESERVE = {
  "bardzo lekka": { ppw: 155, wtw: 40, wod: 115, adjust: 1.2 },
  lekka: { ppw: 245, wtw: 70, wod: 145, adjust: 1.2 },
  "średnia": { ppw: 310, wtw: 100, wod: 210, adjust: 1 },
  "pyłowa (less)": { ppw: 420, wtw: 110, wod: 310, adjust: 1 },
  "ciężka": { ppw: 490, wtw: 240, wod: 250, adjust: 0.8 },
  "bardzo ciężka": { ppw: 540, wtw: 290, wod: 260, adjust: 0.8 }
} as const;

export type KusSoilCategory = keyof typeof SOIL_WATER_RESERVE;
