/** A town, village or hamlet found by name or postcode (Photon / OpenStreetMap). */
export type Place = {
  /** OSM object, e.g. "N123456" */
  id: string;
  name: string;
  kind: "city" | "town" | "village" | "hamlet";
  postcode: string | null;
  /** Powiat, e.g. "powiat inowrocławski" */
  county: string | null;
  voivodeship: string | null;
  lon: number;
  lat: number;
  /** [west, south, east, north] when OSM has an outline for the place. */
  extent: [number, number, number, number] | null;
};

export type PlacesResponse =
  | { mode: "name"; places: Place[] }
  /** Places sharing the postcode; `area` is the postcode's extent when known. */
  | { mode: "postcode"; postcode: string; area: [number, number, number, number] | null; places: Place[] }
  | { error: string };

/** "88150", "88-150", "88 150" → "88-150"; null when not a full Polish postcode. */
export function normalizePostcode(query: string): string | null {
  const m = query.trim().match(/^(\d{2})\s*-?\s*(\d{3})$/);
  return m ? `${m[1]}-${m[2]}` : null;
}
