import { MODULE_LABELS, type AnalysisModule, type ModuleId } from "../contract";

/** Placeholder for a module that is not built yet: reports "missing", never invents data. */
export function pendingModule(id: ModuleId): AnalysisModule<null> {
  const label = MODULE_LABELS[id];
  return {
    id,
    label,
    async run(ctx) {
      return {
        module: id,
        status: "missing",
        value: null,
        sources: [],
        fetchedAt: new Date().toISOString(),
        period: { from: ctx.historyFrom, to: ctx.asOf },
        notes: [`${label}: moduł w przygotowaniu, dane nie zostały uwzględnione.`]
      };
    }
  };
}
