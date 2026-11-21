/**
 * Daily reference evapotranspiration ET0 (mm/day), FAO-56 Penman–Monteith
 * (Allen et al. 1998, FAO Irrigation and Drainage Paper 56, eq. 6, with
 * radiation from ch. 3). Used when the weather source does not supply ET0
 * itself (NASA POWER). G = 0 for daily steps.
 */
export type Et0Input = {
  tMax: number; // °C
  tMin: number; // °C
  rhMean: number; // %
  windSpeed2m: number; // m/s
  solarRadiation: number; // Rs, MJ m-2 day-1
  latitudeDeg: number;
  elevationM: number;
  dayOfYear: number;
};

const satVapour = (t: number) => 0.6108 * Math.exp((17.27 * t) / (t + 237.3));

export function et0PenmanMonteith(i: Et0Input): number {
  const tMean = (i.tMax + i.tMin) / 2;
  const delta = (4098 * satVapour(tMean)) / (tMean + 237.3) ** 2;
  const pressure = 101.3 * ((293 - 0.0065 * i.elevationM) / 293) ** 5.26;
  const gamma = 0.000665 * pressure;

  const es = (satVapour(i.tMax) + satVapour(i.tMin)) / 2;
  const ea = (i.rhMean / 100) * es;

  // Extraterrestrial radiation Ra (eq. 21) and clear-sky radiation Rso (eq. 37).
  const phi = (i.latitudeDeg * Math.PI) / 180;
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * i.dayOfYear) / 365);
  const decl = 0.409 * Math.sin((2 * Math.PI * i.dayOfYear) / 365 - 1.39);
  const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(decl))));
  const ra =
    ((24 * 60) / Math.PI) * 0.082 * dr * (ws * Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.sin(ws));
  const rso = (0.75 + 2e-5 * i.elevationM) * ra;

  // Net radiation (eq. 38–40), albedo 0.23.
  const rns = 0.77 * i.solarRadiation;
  const ratio = rso > 0 ? Math.min(1, i.solarRadiation / rso) : 0.5;
  const sigma = 4.903e-9;
  const tk4 = ((i.tMax + 273.16) ** 4 + (i.tMin + 273.16) ** 4) / 2;
  const rnl = sigma * tk4 * (0.34 - 0.14 * Math.sqrt(Math.max(ea, 0))) * (1.35 * ratio - 0.35);
  const rn = rns - rnl;

  const u2 = i.windSpeed2m;
  const et0 =
    (0.408 * delta * rn + gamma * (900 / (tMean + 273)) * u2 * (es - ea)) / (delta + gamma * (1 + 0.34 * u2));
  return Math.max(0, et0);
}

export function dayOfYear(date: string): number {
  const d = Date.parse(`${date}T00:00:00Z`);
  const start = Date.parse(`${date.slice(0, 4)}-01-01T00:00:00Z`);
  return Math.round((d - start) / 86_400_000) + 1;
}
