import { MODULE_LABELS, type AnalysisModule } from "../contract";

/**
 * Not built yet. EDO's WMS lists the Combined Drought Indicator (layer cdiad),
 * but GetFeatureInfo answered "Invalid request type" in tests on 21.11.2026;
 * the WCS route is the next thing to try.
 */
export const droughtModule: AnalysisModule<null> = {
  id: "drought",
  label: MODULE_LABELS.drought,
  async run(ctx) {
    return {
      module: "drought",
      status: "missing",
      value: null,
      sources: [],
      fetchedAt: new Date().toISOString(),
      period: { from: ctx.historyFrom, to: ctx.asOf },
      notes: [
        "Tło suszowe (wskaźnik CDI Europejskiego Obserwatorium Suszy) nie jest jeszcze pobierane; zestawienie go nie zawiera."
      ]
    };
  }
};
