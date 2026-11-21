/**
 * Crop groups, mirroring the groups used by the IUNG-PIB Agricultural Drought
 * Monitoring System (susza.iung.pulawy.pl), so results can be compared with it.
 * Crop coefficients (Kc, FAO-56) and sensitive periods will be added per crop
 * when the water-balance module lands.
 */
export const CROPS = [
  { id: "zboza-ozime", label: "Zboża ozime" },
  { id: "zboza-jare", label: "Zboża jare" },
  { id: "kukurydza-ziarno", label: "Kukurydza na ziarno" },
  { id: "kukurydza-kiszonka", label: "Kukurydza na kiszonkę" },
  { id: "rzepak", label: "Rzepak i rzepik" },
  { id: "ziemniak", label: "Ziemniak" },
  { id: "burak-cukrowy", label: "Burak cukrowy" },
  { id: "straczkowe", label: "Rośliny strączkowe" },
  { id: "warzywa", label: "Warzywa gruntowe" },
  { id: "truskawki", label: "Truskawki" },
  { id: "krzewy-owocowe", label: "Krzewy owocowe" },
  { id: "drzewa-owocowe", label: "Drzewa owocowe" },
  { id: "chmiel", label: "Chmiel" },
  { id: "tyton", label: "Tytoń" },
  { id: "uzytki-zielone", label: "Łąki i pastwiska" }
] as const;

export type CropId = (typeof CROPS)[number]["id"];

export function isCropId(value: unknown): value is CropId {
  return typeof value === "string" && CROPS.some(c => c.id === value);
}

export function cropLabel(id: CropId) {
  return CROPS.find(c => c.id === id)?.label ?? id;
}
