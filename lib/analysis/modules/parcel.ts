import { MODULE_LABELS, type AnalysisModule } from "../contract";
import type { ParcelProps } from "@/lib/parcels/types";

/** The parcel itself: location and area from ULDK (already fetched before modules run). */
export const parcelModule: AnalysisModule<ParcelProps> = {
  id: "parcel",
  label: MODULE_LABELS.parcel,
  async run(ctx) {
    return {
      module: "parcel",
      status: "ok",
      value: ctx.parcel.properties,
      sources: [
        {
          name: "GUGiK ULDK (Usługa Lokalizacji Działek Katastralnych)",
          url: "https://uldk.gugik.gov.pl/",
          license: "Dane publiczne, bezpłatne (ustawa Prawo geodezyjne i kartograficzne)",
          mode: "live"
        }
      ],
      fetchedAt: new Date().toISOString(),
      uncertainty: "low",
      notes: ["Powierzchnia obliczona z geometrii WGS84 (dokładność ok. 0,5%); dane ewidencyjne mogą różnić się od stanu w terenie."]
    };
  }
};
