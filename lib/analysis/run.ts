import "server-only";
import { earliestAnalysisDate } from "@/lib/dates";
import type { AnalysisContext, AnalysisModule, DataEnvelope } from "./contract";
import { droughtModule } from "./modules/drought";
import { hydroModule } from "./modules/hydro";
import { landcoverModule } from "./modules/landcover";
import { meteoModule } from "./modules/meteo";
import { parcelModule } from "./modules/parcel";
import { satelliteModule } from "./modules/satellite";
import { soilModule } from "./modules/soil";
import { terrainModule } from "./modules/terrain";

/** Order here is the order of the report's data section. */
export const MODULES: AnalysisModule[] = [
  parcelModule,
  meteoModule,
  soilModule,
  satelliteModule,
  terrainModule,
  hydroModule,
  landcoverModule,
  droughtModule
];

/** Whole-analysis budget; the task prefers < 30 s per parcel. */
const MODULE_TIMEOUT_MS = 20_000;

/**
 * Runs all data modules for one parcel in parallel. A module that throws or
 * times out becomes an "error" envelope; the analysis always completes.
 */
export async function collectParcelData(
  ctx: Omit<AnalysisContext, "signal" | "historyFrom">
): Promise<DataEnvelope[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODULE_TIMEOUT_MS);
  const full: AnalysisContext = { ...ctx, historyFrom: earliestAnalysisDate(ctx.asOf), signal: controller.signal };

  try {
    const settled = await Promise.allSettled(
      MODULES.map(m =>
        Promise.race([
          m.run(full),
          new Promise<never>((_, reject) =>
            controller.signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true })
          )
        ])
      )
    );
    return settled.map((s, i) =>
      s.status === "fulfilled"
        ? s.value
        : {
            module: MODULES[i].id,
            status: "error",
            value: null,
            sources: [],
            fetchedAt: new Date().toISOString(),
            notes: [
              `${MODULES[i].label}: ${
                s.reason instanceof Error && s.reason.message === "timeout"
                  ? "źródło danych nie odpowiedziało w wymaganym czasie"
                  : "błąd pobierania danych"
              }. Wynik nie uwzględnia tych danych.`
            ]
          }
    );
  } finally {
    clearTimeout(timer);
  }
}
