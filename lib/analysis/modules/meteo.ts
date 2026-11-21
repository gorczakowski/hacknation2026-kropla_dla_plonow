import { pendingModule } from "./pending";

// TODO: Open-Meteo (ERA5) or IMGW: P, T, ET0 FAO-56, KBW = P - Kc*ET0 vs the same window in the past 10 years.
export const meteoModule = pendingModule("meteo");
