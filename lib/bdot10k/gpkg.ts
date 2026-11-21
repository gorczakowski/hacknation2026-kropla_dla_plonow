import "server-only";
import type { DatabaseSync as Database } from "node:sqlite";
import type { Bbox, XY } from "@/lib/geo/geometry";

/**
 * Minimal GeoPackage reader on Node's built-in SQLite (node:sqlite, Node ≥ 22.13):
 * bbox query through the layer's R-tree, geometry blobs decoded from
 * GeoPackage/WKB. Coordinates stay in the layer's CRS (EPSG:2180 for BDOT10k).
 */
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

export type Geom = { kind: "lines"; lines: XY[][] } | { kind: "polygons"; polygons: XY[][][] } | { kind: "points"; points: XY[] };
export type GpkgFeature = { geom: Geom; props: Record<string, unknown> };

type Layer = { db: Database; table: string; column: string; columns: Set<string> };
const layers = new Map<string, Layer>();

function open(file: string): Layer {
  let layer = layers.get(file);
  if (!layer) {
    const db = new DatabaseSync(file, { readOnly: true });
    const g = db.prepare("SELECT table_name, column_name FROM gpkg_geometry_columns LIMIT 1").get() as
      | { table_name: string; column_name: string }
      | undefined;
    if (!g) throw new Error(`GeoPackage bez warstwy: ${file}`);
    const columns = new Set(
      (db.prepare(`PRAGMA table_info("${g.table_name}")`).all() as { name: string }[]).map(c => c.name)
    );
    layer = { db, table: g.table_name, column: g.column_name, columns };
    layers.set(file, layer);
  }
  return layer;
}

/** Features whose bounding box intersects `bbox` (layer CRS). Unknown columns are skipped. */
export function queryBbox(file: string, [minX, minY, maxX, maxY]: Bbox, wanted: string[]): GpkgFeature[] {
  const { db, table, column, columns } = open(file);
  const cols = wanted.filter(c => columns.has(c));
  const select = [`t."${column}" AS __g`, ...cols.map(c => `t."${c}"`)].join(", ");
  const rtree = `rtree_${table}_${column}`;
  const rows = db
    .prepare(
      `SELECT ${select} FROM "${table}" t JOIN "${rtree}" r ON t.rowid = r.id
       WHERE r.maxx >= ? AND r.minx <= ? AND r.maxy >= ? AND r.miny <= ?`
    )
    .all(minX, maxX, minY, maxY) as Record<string, unknown>[];

  const out: GpkgFeature[] = [];
  for (const row of rows) {
    const blob = row.__g;
    if (!(blob instanceof Uint8Array)) continue;
    const geom = parseGpkgGeometry(blob);
    if (!geom) continue;
    const props: Record<string, unknown> = {};
    for (const c of cols) props[c] = row[c];
    out.push({ geom, props });
  }
  return out;
}

const ENVELOPE_BYTES = [0, 32, 48, 48, 64];

/** GeoPackage binary header + (ISO/EWKB) WKB → lines, polygons or points; 2D only. */
export function parseGpkgGeometry(blob: Uint8Array): Geom | null {
  if (blob[0] !== 0x47 || blob[1] !== 0x50) return null; // "GP"
  const flags = blob[3];
  if (flags & 0x10) return null; // empty geometry
  const envelope = ENVELOPE_BYTES[(flags >> 1) & 0x07] ?? 0;
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  let pos = 8 + envelope;

  const lines: XY[][] = [];
  const polygons: XY[][][] = [];
  const points: XY[] = [];

  const readGeometry = (): void => {
    const le = view.getUint8(pos) === 1;
    pos += 1;
    let type = view.getUint32(pos, le);
    pos += 4;
    let dims = 2;
    if (type & 0x80000000) dims++; // EWKB Z
    if (type & 0x40000000) dims++; // EWKB M
    if (type & 0x20000000) pos += 4; // EWKB SRID
    type &= 0x0fffffff;
    if (type >= 3000) {
      dims = 4;
      type -= 3000;
    } else if (type >= 2000) {
      dims = 3;
      type -= 2000;
    } else if (type >= 1000) {
      dims = 3;
      type -= 1000;
    }
    const readPoint = (): XY => {
      const x = view.getFloat64(pos, le);
      const y = view.getFloat64(pos + 8, le);
      pos += 8 * dims;
      return [x, y];
    };
    const readRing = (): XY[] => {
      const n = view.getUint32(pos, le);
      pos += 4;
      const ring: XY[] = new Array(n);
      for (let i = 0; i < n; i++) ring[i] = readPoint();
      return ring;
    };
    const readMany = () => {
      const n = view.getUint32(pos, le);
      pos += 4;
      for (let i = 0; i < n; i++) readGeometry();
    };
    switch (type) {
      case 1:
        points.push(readPoint());
        break;
      case 2:
        lines.push(readRing());
        break;
      case 3: {
        const n = view.getUint32(pos, le);
        pos += 4;
        const rings: XY[][] = [];
        for (let i = 0; i < n; i++) rings.push(readRing());
        polygons.push(rings);
        break;
      }
      case 4:
      case 5:
      case 6:
      case 7:
        readMany();
        break;
      default:
        throw new Error(`Nieobsługiwany typ WKB ${type}`);
    }
  };

  try {
    readGeometry();
  } catch {
    return null;
  }
  if (polygons.length) return { kind: "polygons", polygons };
  if (lines.length) return { kind: "lines", lines };
  if (points.length) return { kind: "points", points };
  return null;
}
