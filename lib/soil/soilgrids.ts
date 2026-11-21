import "server-only";
import { fromArrayBuffer } from "geotiff";
import { createLimiter, fetchBuffer } from "@/lib/server/http";

/**
 * ISRIC SoilGrids 2.0 (250 m) through its WCS (the REST API is paused). Each
 * request returns a tiny GeoTIFF around the point; we read the pixel that
 * contains it.
 */
export const SOILGRIDS_WCS = "https://maps.isric.org/";

/** ISRIC asks for moderate use; 25 small requests per parcel go through 6 at a time. */
const limit = createLimiter(6);
const HALF = 0.003; // ° around the point: a few 250 m pixels

export type SoilProperty = "sand" | "silt" | "clay" | "soc" | "phh2o" | "wv0033" | "wv1500";

/** Mapped units → conventional units (SoilGrids "conversion factor"). */
export const SOIL_FACTOR: Record<SoilProperty, number> = {
  sand: 10, // g/kg → %
  silt: 10,
  clay: 10,
  soc: 10, // dg/kg → g/kg
  phh2o: 10, // pH×10 → pH
  wv0033: 1, // 10⁻³ cm³/cm³ = mm of water per m of soil
  wv1500: 1
};

export async function readSoilGrids(
  property: SoilProperty,
  depth: string,
  lon: number,
  lat: number,
  signal: AbortSignal
): Promise<number | null> {
  const url =
    `${SOILGRIDS_WCS}mapserv?map=/map/${property}.map&SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage` +
    `&COVERAGEID=${property}_${depth}_mean&FORMAT=image/tiff` +
    `&SUBSET=long(${(lon - HALF).toFixed(5)},${(lon + HALF).toFixed(5)})` +
    `&SUBSET=lat(${(lat - HALF).toFixed(5)},${(lat + HALF).toFixed(5)})` +
    `&SUBSETTINGCRS=http://www.opengis.net/def/crs/EPSG/0/4326&OUTPUTCRS=http://www.opengis.net/def/crs/EPSG/0/4326`;

  // ISRIC's mapserver is slow (0.5–1.6 s per request) and drops some under load: one retry.
  const buffer = await limit(() =>
    fetchBuffer(url, { timeoutMs: 7_000, signal }).catch(() => fetchBuffer(url, { timeoutMs: 7_000, signal }))
  );
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const [minX, minY, maxX, maxY] = image.getBoundingBox();
  const width = image.getWidth();
  const height = image.getHeight();
  const nodata = image.getGDALNoData();
  const raster = (await image.readRasters({ samples: [0] }))[0] as ArrayLike<number>;

  const isValid = (v: number) => Number.isFinite(v) && v !== nodata && v > -32768;
  const col = Math.min(width - 1, Math.max(0, Math.floor(((lon - minX) / (maxX - minX)) * width)));
  const row = Math.min(height - 1, Math.max(0, Math.floor(((maxY - lat) / (maxY - minY)) * height)));
  const center = raster[row * width + col];
  if (isValid(center)) return center / SOIL_FACTOR[property];

  // Point pixel masked (water, town): fall back to the mean of valid neighbours.
  let sum = 0;
  let n = 0;
  for (let i = 0; i < raster.length; i++) {
    if (isValid(raster[i])) {
      sum += raster[i];
      n++;
    }
  }
  return n ? sum / n / SOIL_FACTOR[property] : null;
}
