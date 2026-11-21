import type { Feature, MultiPolygon, Polygon } from "geojson";

/** A cadastral parcel (działka ewidencyjna) as returned by our /api/parcels. */
export type ParcelProps = {
  /** Full TERYT parcel id, e.g. 040308_5.0004.26212/4 */
  id: string;
  /** Parcel number within its precinct, e.g. 26212/4 */
  number: string;
  /** Obręb ewidencyjny */
  precinct: string;
  /** Gmina */
  commune: string;
  /** Powiat */
  county: string;
  /** Województwo */
  voivodeship: string;
  /** Area in hectares, computed from the WGS84 geometry (±0.5%). */
  areaHa: number;
  /** A WGS84 point guaranteed inside the parcel: map label, and where point data (weather, soil) is read. */
  labelPoint: [number, number];
  /** [west, south, east, north] in WGS84 */
  bbox: [number, number, number, number];
};

export type ParcelFeature = Feature<Polygon | MultiPolygon, ParcelProps>;

export type ParcelsResponse = { parcels: ParcelFeature[] } | { error: string };

/** A cadastral precinct (obręb ewidencyjny), usually one village in the countryside. */
export type PrecinctProps = {
  /** TERYT precinct id, e.g. 040706_5.0020 */
  id: string;
  name: string;
  commune: string;
  county: string;
  voivodeship: string;
  bbox: [number, number, number, number];
};

export type PrecinctFeature = Feature<Polygon | MultiPolygon, PrecinctProps>;

export type PrecinctResponse = { precinct: PrecinctFeature | null } | { error: string };
