// Minimal Sweet Home 3D (.sh3d) importer.
// A .sh3d file is a ZIP; walls live in Home.xml. We read the ZIP central directory ourselves and
// inflate the one entry we need with the browser's DecompressionStream, so no library is required.

import { Project, Wall } from './model';

export interface Sh3dVariant {
  /** walls in meters, translated so the min corner is at (0,0) */
  walls: Wall[];
  widthM: number;
  depthM: number;
  wallHeightM: number;
}

async function readZipEntry(buf: ArrayBuffer, wanted: string): Promise<Uint8Array | null> {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  // find End Of Central Directory
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 70000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Не е ZIP файл');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const localOff = dv.getUint32(off + 42, true);
    const name = dec.decode(u8.subarray(off + 46, off + 46 + nameLen));
    off += 46 + nameLen + extraLen + commentLen;
    if (name !== wanted) continue;
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const data = u8.slice(start, start + csize);
    if (method === 0) return data;
    if (method !== 8) throw new Error('Неподдържана компресия в ZIP');
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([data]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return null;
}

interface RawWall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  h: number;
}

/** Group walls into separate drawings (Sweet Home 3D files often hold several variants side by side). */
function cluster(walls: RawWall[], margin = 60): RawWall[][] {
  const n = walls.length;
  const parent = walls.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const bb = (w: RawWall) => [Math.min(w.x1, w.x2), Math.min(w.y1, w.y2), Math.max(w.x1, w.x2), Math.max(w.y1, w.y2)];
  for (let i = 0; i < n; i++) {
    const a = bb(walls[i]);
    for (let j = i + 1; j < n; j++) {
      const b = bb(walls[j]);
      if (a[0] - margin < b[2] && b[0] - margin < a[2] && a[1] - margin < b[3] && b[1] - margin < a[3]) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, RawWall[]>();
  walls.forEach((w, i) => {
    const k = find(i);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(w);
  });
  return [...groups.values()].sort((g1, g2) => {
    const y1 = Math.min(...g1.map((w) => Math.min(w.y1, w.y2)));
    const y2 = Math.min(...g2.map((w) => Math.min(w.y1, w.y2)));
    if (Math.abs(y1 - y2) > 200) return y1 - y2;
    return Math.min(...g1.map((w) => w.x1)) - Math.min(...g2.map((w) => w.x1));
  });
}

export async function parseSh3d(buf: ArrayBuffer): Promise<Sh3dVariant[]> {
  const xmlBytes = await readZipEntry(buf, 'Home.xml');
  if (!xmlBytes) throw new Error('Няма Home.xml във файла (запазете го с по-нова версия на Sweet Home 3D)');
  const xml = new DOMParser().parseFromString(new TextDecoder().decode(xmlBytes), 'application/xml');
  const home = xml.documentElement;
  const defaultH = Number(home.getAttribute('wallHeight') ?? 250);
  const raw: RawWall[] = [...xml.getElementsByTagName('wall')].map((w) => ({
    x1: Number(w.getAttribute('xStart')),
    y1: Number(w.getAttribute('yStart')),
    x2: Number(w.getAttribute('xEnd')),
    y2: Number(w.getAttribute('yEnd')),
    h: Number(w.getAttribute('height') ?? defaultH),
  }));
  if (!raw.length) throw new Error('Няма стени във файла');
  return cluster(raw).map((g, gi) => {
    const mx = Math.min(...g.map((w) => Math.min(w.x1, w.x2)));
    const my = Math.min(...g.map((w) => Math.min(w.y1, w.y2)));
    const Mx = Math.max(...g.map((w) => Math.max(w.x1, w.x2)));
    const My = Math.max(...g.map((w) => Math.max(w.y1, w.y2)));
    const hs = g.map((w) => w.h).sort((a, b) => a - b);
    const r = (v: number) => Math.round(v) / 100;
    return {
      walls: g.map((w, i) => ({ id: `sh${gi + 1}_${i + 1}`, x1: r(w.x1 - mx), z1: r(w.y1 - my), x2: r(w.x2 - mx), z2: r(w.y2 - my) })),
      widthM: r(Mx - mx),
      depthM: r(My - my),
      wallHeightM: Math.round(hs[hs.length >> 1] / 5) * 5 / 100,
    };
  });
}

export function projectFromVariant(v: Sh3dVariant): Project {
  return { version: 1, ceilingHeight: v.wallHeightM, walls: v.walls, devices: [], cables: [] };
}
