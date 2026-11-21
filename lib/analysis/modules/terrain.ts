import "server-only";
import { fromUrl, type GeoTIFF } from "geotiff";
import { bboxOfPolygons, pointInPolygons, polygonsOf } from "@/lib/geo/geometry";
import { DAY, diskCached } from "@/lib/server/disk-cache";
import { upstreamUrl } from "@/lib/server/http";
import { MODULE_LABELS, type AnalysisModule, type DataEnvelope } from "../contract";
import type { TerrainValue } from "../values";

/**
 * Copernicus DEM GLO-30 (Cloud Optimized GeoTIFF, AWS Open Data, eu-central-1).
 * GUGiK's 1 m NMT would be better, but its WCS did not return coverage in
 * tests on 21.11.2026 (capabilities answered, GetCoverage hung >60 s).
 */
const RADIUS_M = 500;
const STEEP_PCT = 5;

const tiles = new Map<string, Promise<GeoTIFF>>();

function tileUrl(lat: number, lon: number) {
  const la = Math.floor(lat);
  const lo = Math.floor(lon);
  const name = `Copernicus_DSM_COG_10_${la >= 0 ? "N" : "S"}${String(Math.abs(la)).padStart(2, "0")}_00_${lo >= 0 ? "E" : "W"}${String(Math.abs(lo)).padStart(3, "0")}_00_DEM`;
  return `https://copernicus-dem-30m.s3.amazonaws.com/${name}/${name}.tif`;
}

function openTile(url: string) {
  let tiff = tiles.get(url);
  if (!tiff) {
    tiff = fromUrl(upstreamUrl(url));
    tiff.catch(() => tiles.delete(url));
    tiles.set(url, tiff);
  }
  return tiff;
}

const COMPASS = ["północ", "północny wschód", "wschód", "południowy wschód", "południe", "południowy zachód", "zachód", "północny zachód"];
const r1 = (v: number) => Math.round(v * 10) / 10;

async function loadTerrain(geometry: Parameters<typeof polygonsOf>[0], labelPoint: [number, number]): Promise<TerrainValue> {
  const polygons = polygonsOf(geometry);
  const [minLon, minLat, maxLon, maxLat] = bboxOfPolygons(polygons);
  const [lon0, lat0] = labelPoint;

  const tiff = await openTile(tileUrl(lat0, lon0));
  const image = await tiff.getImage();
  const [ox, oy] = image.getOrigin();
  const [rx, ry] = image.getResolution(); // ry < 0
  const half = image.getGeoKeys()?.GTRasterTypeGeoKey === 2 ? 0 : 0.5;
  const width = image.getWidth();
  const height = image.getHeight();

  const cos = Math.cos((lat0 * Math.PI) / 180);
  const dLat = RADIUS_M / 110_574;
  const dLon = RADIUS_M / (111_320 * cos);
  let c0 = Math.floor((minLon - dLon - ox) / rx - half);
  let c1 = Math.ceil((maxLon + dLon - ox) / rx - half);
  let r0 = Math.floor((maxLat + dLat - oy) / ry - half);
  let r1_ = Math.ceil((minLat - dLat - oy) / ry - half);
  const clipped = c0 < 0 || r0 < 0 || c1 > width - 1 || r1_ > height - 1;
  c0 = Math.max(0, c0);
  r0 = Math.max(0, r0);
  c1 = Math.min(width - 1, c1);
  r1_ = Math.min(height - 1, r1_);

  const raster = await image.readRasters({ window: [c0, r0, c1 + 1, r1_ + 1], samples: [0] });
  const z = raster[0] as Float32Array;
  const w = raster.width;
  const h = raster.height;
  const dx = Math.abs(rx) * 111_320 * cos;
  const dy = Math.abs(ry) * 110_574;
  const lonOf = (c: number) => ox + (c0 + c + half) * rx;
  const latOf = (r: number) => oy + (r0 + r + half) * ry;
  const at = (c: number, r: number) => z[r * w + c];

  const slope = new Float32Array(w * h).fill(NaN);
  for (let r = 1; r < h - 1; r++) {
    for (let c = 1; c < w - 1; c++) {
      // Horn (1981) 3×3 gradient.
      const a = at(c - 1, r - 1), b = at(c, r - 1), cc = at(c + 1, r - 1);
      const d = at(c - 1, r), f = at(c + 1, r);
      const g = at(c - 1, r + 1), hh = at(c, r + 1), i = at(c + 1, r + 1);
      const gx = (cc + 2 * f + i - (a + 2 * d + g)) / (8 * dx);
      const gy = (g + 2 * hh + i - (a + 2 * b + cc)) / (8 * dy);
      slope[r * w + c] = 100 * Math.hypot(gx, gy);
    }
  }

  const inParcel: number[] = [];
  const outside: number[] = [];
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      (pointInPolygons(lonOf(c), latOf(r), polygons) ? inParcel : outside).push(r * w + c);
    }
  }
  if (inParcel.length === 0) {
    // Parcel smaller than a DEM cell: use the cell under the label point.
    const c = Math.min(w - 1, Math.max(0, Math.round((lon0 - ox) / rx - half) - c0));
    const r = Math.min(h - 1, Math.max(0, Math.round((lat0 - oy) / ry - half) - r0));
    inParcel.push(r * w + c);
    const k = outside.indexOf(r * w + c);
    if (k >= 0) outside.splice(k, 1);
  }

  const stats = (idx: number[]) => {
    let min = Infinity, max = -Infinity, sum = 0;
    for (const k of idx) {
      const v = z[k];
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
    return { min: r1(min), max: r1(max), mean: r1(sum / idx.length) };
  };
  const elevation = stats(inParcel);
  const surroundings = outside.length ? stats(outside) : elevation;

  const slopes = inParcel.map(k => slope[k]).filter(Number.isFinite);
  const slopeMean = slopes.length ? slopes.reduce((s, v) => s + v, 0) / slopes.length : 0;
  const slopeMax = slopes.length ? Math.max(...slopes) : 0;
  const steepShare = slopes.length ? slopes.filter(v => v > STEEP_PCT).length / slopes.length : 0;

  // Plane fit over the parcel's cells: the direction water drains across the field.
  let drainsTowards: string | null = null;
  if (inParcel.length >= 3) {
    let sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0;
    const n = inParcel.length;
    for (const k of inParcel) {
      const x = (k % w) * dx;
      const y = -Math.floor(k / w) * dy; // north positive
      const v = z[k];
      sx += x; sy += y; sz += v; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * v; syz += y * v;
    }
    const cxx = sxx - (sx * sx) / n, cyy = syy - (sy * sy) / n, cxy = sxy - (sx * sy) / n;
    const cxz = sxz - (sx * sz) / n, cyz = syz - (sy * sz) / n;
    const det = cxx * cyy - cxy * cxy;
    if (Math.abs(det) > 1e-9) {
      const a = (cxz * cyy - cyz * cxy) / det; // dz/dx (east)
      const b = (cyz * cxx - cxz * cxy) / det; // dz/dy (north)
      if (Math.hypot(a, b) * 100 >= 0.5) {
        const bearing = (Math.atan2(-a, -b) * 180) / Math.PI;
        drainsTowards = COMPASS[Math.round(((bearing + 360) % 360) / 45) % 8];
      }
    }
  }

  let lowest = inParcel[0];
  for (const k of inParcel) if (z[k] < z[lowest]) lowest = k;

  const relativeElevation = r1(elevation.mean - surroundings.mean);
  const position =
    relativeElevation <= -1.5
      ? "niżej niż otoczenie (obniżenie terenu)"
      : relativeElevation >= 1.5
        ? "wyżej niż otoczenie (wyniesienie)"
        : slopeMean >= 3
          ? "na stoku"
          : "teren płaski, na poziomie otoczenia";

  return {
    dataset: "Copernicus DEM GLO-30",
    cellSizeM: [Math.round(dx), Math.round(dy)],
    parcelCells: inParcel.length,
    elevation,
    slopePct: { mean: r1(slopeMean), max: r1(slopeMax) },
    steepShare: Math.round(steepShare * 100) / 100,
    surroundings: { radiusM: RADIUS_M, ...surroundings },
    relativeElevation,
    position,
    drainsTowards,
    lowestPoint: [Number(lonOf(lowest % w).toFixed(6)), Number(latOf(Math.floor(lowest / w)).toFixed(6))],
    clipped
  };
}

/** Elevation, slope and position in the landscape (30 m surface model). */
export const terrainModule: AnalysisModule<TerrainValue> = {
  id: "terrain",
  label: MODULE_LABELS.terrain,
  async run(ctx): Promise<DataEnvelope<TerrainValue>> {
    const { value, savedAt } = await diskCached("copdem", ctx.parcel.properties.id, 180 * DAY, () =>
      loadTerrain(ctx.parcel.geometry, ctx.parcel.properties.labelPoint)
    );
    const notes = [
      `Copernicus DEM GLO-30 to model powierzchni (DSM) o oczku ok. ${value.cellSizeM[0]}×${value.cellSizeM[1]} m: obejmuje budynki i korony drzew, nie sam grunt. Działka pokrywa ${value.parcelCells} oczek; dla małych działek spadki są uśrednione.`,
      `Otoczenie: pas ${value.surroundings.radiusM} m wokół działki. Kierunek odpływu wyznaczono z płaszczyzny dopasowanej do wysokości w obrębie działki.`,
      "Dokładniejszy NMT GUGiK (1 m) nie był dostępny: usługa WCS nie zwracała danych w testach 21.11.2026."
    ];
    if (value.clipped) notes.push("Otoczenie przycięte do granicy kafla DEM (działka przy granicy stopnia siatki).");
    return {
      module: "terrain",
      status: value.parcelCells < 3 ? "partial" : "ok",
      value,
      sources: [
        {
          name: "Copernicus DEM GLO-30 (AWS Open Data, Cloud Optimized GeoTIFF)",
          url: "https://registry.opendata.aws/copernicus-dem/",
          license: "Licencja Copernicus DEM GLO-30: bezpłatnie, z podaniem źródła (© DLR e.V. 2010–2014 i © Airbus Defence and Space GmbH 2014–2018, Copernicus, UE i ESA)",
          mode: "live"
        }
      ],
      fetchedAt: new Date(savedAt).toISOString(),
      uncertainty: value.parcelCells < 10 ? "high" : "medium",
      notes
    };
  }
};
