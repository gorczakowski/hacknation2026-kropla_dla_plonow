declare module "@terraformer/wkt" {
  import type { Geometry } from "geojson";
  export function wktToGeoJSON(wkt: string): Geometry;
  export function geojsonToWKT(geometry: Geometry): string;
}
