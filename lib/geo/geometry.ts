/**
 * Small planar geometry helpers for parcel-sized problems (metres in a
 * projected CRS, or degrees for point-in-polygon only). No dependencies, so
 * both the server modules and the browser can use them.
 */
import type { MultiPolygon, Polygon } from "geojson";

export type XY = [number, number];
export type Ring = XY[];
/** One polygon: outer ring first, then holes. */
export type PolygonRings = Ring[];
export type Bbox = [minX: number, minY: number, maxX: number, maxY: number];

export function polygonsOf(geometry: Polygon | MultiPolygon): PolygonRings[] {
  return geometry.type === "Polygon"
    ? [geometry.coordinates as unknown as PolygonRings]
    : (geometry.coordinates as unknown as PolygonRings[]);
}

export function mapPolygons(polygons: PolygonRings[], f: (p: XY) => XY): PolygonRings[] {
  return polygons.map(rings => rings.map(ring => ring.map(p => f(p))));
}

export function bboxOfPoints(points: Iterable<XY>): Bbox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

export function bboxOfPolygons(polygons: PolygonRings[]): Bbox {
  return bboxOfPoints(polygons.flatMap(rings => rings[0] ?? []));
}

export function expandBbox([a, b, c, d]: Bbox, by: number): Bbox {
  return [a - by, b - by, c + by, d + by];
}

/** Even-odd rule over all rings, so holes are handled. */
export function pointInRings(x: number, y: number, rings: Ring[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export function pointInPolygons(x: number, y: number, polygons: PolygonRings[]): boolean {
  return polygons.some(rings => pointInRings(x, y, rings));
}

export function distPointSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  return Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
}

function segmentsIntersect(a: XY, b: XY, c: XY, d: XY): boolean {
  const o1 = orient(a[0], a[1], b[0], b[1], c[0], c[1]);
  const o2 = orient(a[0], a[1], b[0], b[1], d[0], d[1]);
  const o3 = orient(c[0], c[1], d[0], d[1], a[0], a[1]);
  const o4 = orient(c[0], c[1], d[0], d[1], b[0], b[1]);
  return o1 !== o2 && o3 !== o4;
}

function segmentSegmentDistance(a: XY, b: XY, c: XY, d: XY): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    distPointSegment(a[0], a[1], c[0], c[1], d[0], d[1]),
    distPointSegment(b[0], b[1], c[0], c[1], d[0], d[1]),
    distPointSegment(c[0], c[1], a[0], a[1], b[0], b[1]),
    distPointSegment(d[0], d[1], a[0], a[1], b[0], b[1])
  );
}

function* edges(polygons: PolygonRings[]): Generator<[XY, XY]> {
  for (const rings of polygons) {
    for (const ring of rings) {
      for (let i = 1; i < ring.length; i++) yield [ring[i - 1], ring[i]];
    }
  }
}

/** Distance from a segment to polygons; 0 when it touches or lies inside. */
export function segmentDistanceToPolygons(a: XY, b: XY, polygons: PolygonRings[]): number {
  if (pointInPolygons(a[0], a[1], polygons) || pointInPolygons(b[0], b[1], polygons)) return 0;
  let best = Infinity;
  for (const [c, d] of edges(polygons)) {
    const dist = segmentSegmentDistance(a, b, c, d);
    if (dist < best) best = dist;
    if (best === 0) return 0;
  }
  return best;
}

/** Distance between two polygon sets; 0 when they overlap or touch. */
export function polygonsDistance(a: PolygonRings[], b: PolygonRings[]): number {
  const firstA = a[0]?.[0]?.[0];
  const firstB = b[0]?.[0]?.[0];
  if (firstA && pointInPolygons(firstA[0], firstA[1], b)) return 0;
  if (firstB && pointInPolygons(firstB[0], firstB[1], a)) return 0;
  let best = Infinity;
  const edgesB = [...edges(b)];
  for (const [p, q] of edges(a)) {
    for (const [r, s] of edgesB) {
      const dist = segmentSegmentDistance(p, q, r, s);
      if (dist < best) best = dist;
      if (best === 0) return 0;
    }
  }
  return best;
}

export function bboxDistance(a: Bbox, b: Bbox): number {
  const dx = Math.max(0, a[0] - b[2], b[0] - a[2]);
  const dy = Math.max(0, a[1] - b[3], b[1] - a[3]);
  return Math.hypot(dx, dy);
}

export function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(sum / 2);
}

export function polygonsArea(polygons: PolygonRings[]): number {
  return polygons.reduce(
    (total, [outer, ...holes]) => total + ringArea(outer ?? []) - holes.reduce((h, r) => h + ringArea(r), 0),
    0
  );
}

export function segmentLength(a: XY, b: XY) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}
