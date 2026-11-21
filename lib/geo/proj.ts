import "server-only";
import proj4 from "proj4";
import type { XY } from "./geometry";

/** EPSG:2180, PUWG 1992: the Polish national grid used by BDOT10k and GUGiK services. */
const PUWG92 =
  "+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";

const puwg92 = proj4("EPSG:4326", PUWG92);

/** WGS84 lon/lat → EPSG:2180 easting/northing in metres. */
export function toPuwg92(p: XY): XY {
  return puwg92.forward(p) as XY;
}

export function fromPuwg92(p: XY): XY {
  return puwg92.inverse(p) as XY;
}
