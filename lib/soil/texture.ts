import type { KusSoilCategory } from "@/lib/reference/kus2016";

type TextureClass = { usda: string; pl: string; kus: KusSoilCategory };

/**
 * USDA soil texture triangle (sand 0.05–2 mm, silt 0.002–0.05 mm, clay < 0.002 mm, %).
 * `kus` maps each class to the nearest category of Kuś (2016) Table 4. The
 * Polish agronomic categories are defined on a different particle-size scheme,
 * so this mapping is an approximation and is labelled as one in the report.
 */
export function usdaTexture(sand: number, silt: number, clay: number): TextureClass {
  const total = sand + silt + clay;
  if (total > 0 && Math.abs(total - 100) > 0.5) {
    sand = (sand / total) * 100;
    silt = (silt / total) * 100;
    clay = (clay / total) * 100;
  }
  if (silt + 1.5 * clay < 15) return { usda: "sand", pl: "piasek", kus: "bardzo lekka" };
  if (silt + 1.5 * clay >= 15 && silt + 2 * clay < 30) return { usda: "loamy sand", pl: "piasek gliniasty", kus: "lekka" };
  if ((clay >= 7 && clay < 20 && sand > 52 && silt + 2 * clay >= 30) || (clay < 7 && silt < 50 && silt + 2 * clay >= 30)) {
    return { usda: "sandy loam", pl: "glina piaszczysta", kus: "lekka" };
  }
  if (clay >= 7 && clay < 27 && silt >= 28 && silt < 50 && sand <= 52) return { usda: "loam", pl: "glina zwykła", kus: "średnia" };
  if ((silt >= 50 && clay >= 12 && clay < 27) || (silt >= 50 && silt < 80 && clay < 12)) {
    return { usda: "silt loam", pl: "pył gliniasty", kus: "pyłowa (less)" };
  }
  if (silt >= 80 && clay < 12) return { usda: "silt", pl: "pył zwykły", kus: "pyłowa (less)" };
  if (clay >= 20 && clay < 35 && silt < 28 && sand > 45) return { usda: "sandy clay loam", pl: "glina piaszczysto-ilasta", kus: "średnia" };
  if (clay >= 27 && clay < 40 && sand > 20 && sand <= 45) return { usda: "clay loam", pl: "glina ilasta", kus: "ciężka" };
  if (clay >= 27 && clay < 40 && sand <= 20) return { usda: "silty clay loam", pl: "glina pylasto-ilasta", kus: "ciężka" };
  if (clay >= 35 && sand > 45) return { usda: "sandy clay", pl: "ił piaszczysty", kus: "ciężka" };
  if (clay >= 40 && silt >= 40) return { usda: "silty clay", pl: "ił pylasty", kus: "bardzo ciężka" };
  return { usda: "clay", pl: "ił", kus: "bardzo ciężka" };
}
