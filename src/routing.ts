import { Vector3 } from 'three';
import {
  Anchor,
  Cable,
  CablePoint,
  Project,
  SURFACE_OFFSET,
  WALL_THICKNESS,
  Wall,
  isRef,
  wallLength,
} from './model';

/** A resolved anchor: the anchor plus its 3D position on the surface (offset off the face). */
export interface Resolved {
  anchor: Anchor;
  pos: Vector3;
  wall?: Wall;
}

export function wallDir(w: Wall): Vector3 {
  const len = wallLength(w) || 1;
  return new Vector3((w.x2 - w.x1) / len, 0, (w.z2 - w.z1) / len);
}

/** Outward normal of a wall face. side=+1 is the face on the left of start→end. */
export function wallNormal(w: Wall, side: 1 | -1): Vector3 {
  const d = wallDir(w);
  // left of (dx, dz) in XZ with Y up: (dz, -dx)
  return new Vector3(d.z * side, 0, -d.x * side);
}

export function anchorPosition(p: Project, a: Anchor): Vector3 {
  if (a.surface === 'ceiling') return new Vector3(a.x, p.ceilingHeight - SURFACE_OFFSET, a.z);
  const w = p.walls.find((x) => x.id === a.wallId);
  if (!w) return new Vector3(0, a.h, 0);
  const d = wallDir(w);
  const n = wallNormal(w, a.side);
  return new Vector3(w.x1, a.h, w.z1)
    .addScaledVector(d, a.t)
    .addScaledVector(n, WALL_THICKNESS / 2 + SURFACE_OFFSET);
}

export function resolvePoint(p: Project, cp: CablePoint): Resolved | null {
  const a: Anchor | undefined = isRef(cp) ? p.devices.find((d) => d.id === cp.ref)?.anchor : cp;
  if (!a) return null;
  const wall = a.surface === 'wall' ? p.walls.find((w) => w.id === a.wallId) : undefined;
  if (a.surface === 'wall' && !wall) return null;
  return { anchor: a, pos: anchorPosition(p, a), wall };
}

/**
 * Expand two consecutive waypoints into an orthogonal path that stays on surfaces.
 * Rules (POC):
 *  - same wall face: vertical run first, then horizontal.
 *  - anything else: go up to the ceiling, cross the ceiling in an L, come down.
 */
function expandSegment(p: Project, a: Resolved, b: Resolved): Vector3[] {
  const H = p.ceilingHeight - SURFACE_OFFSET;
  const out: Vector3[] = [];

  const sameFace =
    a.anchor.surface === 'wall' &&
    b.anchor.surface === 'wall' &&
    a.anchor.wallId === b.anchor.wallId &&
    a.anchor.side === b.anchor.side;

  if (sameFace) {
    out.push(new Vector3(a.pos.x, b.pos.y, a.pos.z));
    out.push(b.pos.clone());
    return out;
  }

  // Up to ceiling (if on a wall)
  const aTop = a.anchor.surface === 'wall' ? new Vector3(a.pos.x, H, a.pos.z) : a.pos.clone();
  const bTop = b.anchor.surface === 'wall' ? new Vector3(b.pos.x, H, b.pos.z) : b.pos.clone();
  if (a.anchor.surface === 'wall') out.push(aTop);
  // L across the ceiling: along X first, then Z
  out.push(new Vector3(bTop.x, H, aTop.z));
  out.push(bTop);
  if (b.anchor.surface === 'wall') out.push(b.pos.clone());
  return out;
}

export function cablePath(p: Project, c: Cable): Vector3[] {
  const resolved = c.points.map((cp) => resolvePoint(p, cp)).filter((r): r is Resolved => !!r);
  if (resolved.length === 0) return [];
  const pts: Vector3[] = [resolved[0].pos.clone()];
  for (let i = 1; i < resolved.length; i++) {
    for (const v of expandSegment(p, resolved[i - 1], resolved[i])) {
      if (v.distanceToSquared(pts[pts.length - 1]) > 1e-8) pts.push(v);
    }
  }
  return pts;
}

export function pathLength(pts: Vector3[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += pts[i].distanceTo(pts[i - 1]);
  return L;
}

/** Project a world point onto a wall face, returning an anchor. */
export function wallAnchorFromPoint(p: Project, w: Wall, point: Vector3, side: 1 | -1, snap = 0.05): Extract<Anchor, { surface: 'wall' }> {
  const d = wallDir(w);
  const rel = new Vector3(point.x - w.x1, 0, point.z - w.z1);
  let t = rel.dot(d);
  t = Math.min(wallLength(w), Math.max(0, Math.round(t / snap) * snap));
  const h = Math.min(p.ceilingHeight, Math.max(0, Math.round(point.y / snap) * snap));
  return { surface: 'wall', wallId: w.id, t, h, side };
}
