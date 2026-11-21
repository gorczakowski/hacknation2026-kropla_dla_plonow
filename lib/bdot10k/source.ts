import "server-only";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { CACHE_DIR, DAY } from "@/lib/server/disk-cache";
import { fetchOk } from "@/lib/server/http";

/**
 * GUGiK BDOT10k (topographic database 1:10 000), one GeoPackage zip per county
 * (~80 MB) at opendata.geoportal.gov.pl. The zip holds one .gpkg per feature
 * class, so we read the zip's central directory with an HTTP Range request and
 * download only the classes we need (a few MB), then keep them on disk.
 */
const BASE = "https://opendata.geoportal.gov.pl/bdot10k/schemat2021/GPKG";
const REFRESH_AFTER = 60 * DAY;

export const BDOT_SOURCE = {
  name: "GUGiK BDOT10k (Baza Danych Obiektów Topograficznych 1:10 000), GeoPackage wg powiatów",
  url: "https://www.geoportal.gov.pl/pl/dane/baza-danych-obiektow-topograficznych-bdot10k/",
  license: "Dane publiczne, bezpłatne (ustawa Prawo geodezyjne i kartograficzne)",
  mode: "live" as const
};

/** County (powiat) TERYT code from a parcel id like 040308_5.0004.26212/4 → 0403. */
export function countyOfParcel(parcelId: string): string | null {
  return /^(\d{4})\d{2}_\d/.exec(parcelId)?.[1] ?? null;
}

type Entry = { offset: number; compressedSize: number; method: number };
type Directory = { entries: Record<string, Entry>; lastModified: string; length: number };

const directories = new Map<string, Promise<Directory>>();
const inflight = new Map<string, Promise<string>>();

const zipUrl = (county: string) => `${BASE}/${county.slice(0, 2)}/${county}_GPKG.zip`;

async function range(url: string, from: number, to: number, signal: AbortSignal) {
  const res = await fetchOk(url, { timeoutMs: 15_000, signal, init: { headers: { Range: `bytes=${from}-${to}` } } });
  if (res.status !== 206) throw new Error("BDOT10k: serwer nie obsłużył zapytania Range");
  return Buffer.from(await res.arrayBuffer());
}

async function readDirectory(county: string, signal: AbortSignal): Promise<Directory> {
  const url = zipUrl(county);
  const head = await fetchOk(url, { timeoutMs: 10_000, signal, init: { method: "HEAD" } });
  const length = Number(head.headers.get("content-length"));
  if (!length) throw new Error("BDOT10k: brak rozmiaru pliku");
  const lastModified = head.headers.get("last-modified") ?? "";

  const tailStart = Math.max(0, length - 66_000);
  const tail = await range(url, tailStart, length - 1, signal);
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("BDOT10k: nie znaleziono katalogu ZIP");
  const count = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  const cd = cdOffset >= tailStart ? tail.subarray(cdOffset - tailStart) : await range(url, cdOffset, cdOffset + cdSize - 1, signal);

  const entries: Record<string, Entry> = {};
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.length; i++) {
    const method = cd.readUInt16LE(p + 10);
    const compressedSize = cd.readUInt32LE(p + 20);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const offset = cd.readUInt32LE(p + 42);
    const name = cd.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const layer = /__([A-Z0-9_]+)\.gpkg$/i.exec(name)?.[1];
    if (layer) entries[layer.toUpperCase()] = { offset, compressedSize, method };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { entries, lastModified, length };
}

function directory(county: string, signal: AbortSignal) {
  let dir = directories.get(county);
  if (!dir) {
    dir = readDirectory(county, signal);
    dir.catch(() => directories.delete(county));
    directories.set(county, dir);
  }
  return dir;
}

async function downloadLayer(county: string, layer: string, file: string, signal: AbortSignal): Promise<string> {
  const dir = await directory(county, signal);
  const entry = dir.entries[layer];
  if (!entry) throw new Error(`BDOT10k: brak warstwy ${layer} dla powiatu ${county}`);
  const url = zipUrl(county);
  // Local header (30 B + name + extra) precedes the data; 1 kB of slack covers it.
  const chunk = await range(url, entry.offset, Math.min(dir.length - 1, entry.offset + 30 + 1024 + entry.compressedSize), signal);
  const dataStart = 30 + chunk.readUInt16LE(26) + chunk.readUInt16LE(28);
  const compressed = chunk.subarray(dataStart, dataStart + entry.compressedSize);
  const data = entry.method === 8 ? inflateRawSync(compressed) : compressed;

  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
  await writeFile(`${file}.json`, JSON.stringify({ lastModified: dir.lastModified, fetchedAt: new Date().toISOString() }));
  return file;
}

export type LayerFile = { file: string; version: string; fetchedAt: string };

/** Path to the county's layer GeoPackage, downloading it first when needed. */
export async function bdotLayer(county: string, layer: string, signal: AbortSignal): Promise<LayerFile> {
  const file = path.join(CACHE_DIR, "bdot10k", county, `${layer}.gpkg`);
  const fresh = await stat(file)
    .then(s => Date.now() - s.mtimeMs < REFRESH_AFTER)
    .catch(() => false);
  if (!fresh) {
    const key = `${county}/${layer}`;
    let task = inflight.get(key);
    if (!task) {
      task = downloadLayer(county, layer, file, signal).finally(() => inflight.delete(key));
      inflight.set(key, task);
    }
    await task;
  }
  const meta = await readFile(`${file}.json`, "utf8")
    .then(t => JSON.parse(t) as { lastModified: string; fetchedAt: string })
    .catch(() => ({ lastModified: "", fetchedAt: new Date().toISOString() }));
  return { file, version: meta.lastModified, fetchedAt: meta.fetchedAt };
}

export function formatVersion(lastModified: string) {
  const t = Date.parse(lastModified);
  return Number.isNaN(t) ? "nieznana" : new Date(t).toISOString().slice(0, 10);
}
