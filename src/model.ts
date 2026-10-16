// Data model. Units: meters. Y is up. Floor plan lives in the XZ plane.

export type WallId = string;
export type DeviceId = string;
export type CableId = string;

export interface Wall {
  id: WallId;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

export type DeviceKind = 'panel' | 'outlet' | 'switch' | 'box' | 'lamp';

/** A point glued to a surface. */
export type Anchor =
  | {
      surface: 'wall';
      wallId: WallId;
      /** distance from wall start along the wall, meters */
      t: number;
      /** height above floor, meters */
      h: number;
      /** which face of the wall: +1 = left of start→end direction, -1 = right */
      side: 1 | -1;
    }
  | { surface: 'ceiling'; x: number; z: number };

export interface Device {
  id: DeviceId;
  kind: DeviceKind;
  anchor: Anchor;
  label: string;
}

export type CableType = '3x1.5' | '3x2.5' | '5x2.5' | '5x4';

/** A cable waypoint is either a free point on a surface or a reference to a device. */
export type CablePoint = Anchor | { ref: DeviceId };

export interface Cable {
  id: CableId;
  type: CableType;
  points: CablePoint[];
}

export interface Project {
  version: 1;
  ceilingHeight: number;
  walls: Wall[];
  devices: Device[];
  cables: Cable[];
}

export const DEVICE_INFO: Record<
  DeviceKind,
  { name: string; defaultHeight: number; onCeiling: boolean; onWall: boolean; color: number }
> = {
  panel: { name: 'Табло', defaultHeight: 1.5, onCeiling: false, onWall: true, color: 0x4a5a6e },
  outlet: { name: 'Контакт', defaultHeight: 0.3, onCeiling: false, onWall: true, color: 0xf2f2f2 },
  switch: { name: 'Ключ', defaultHeight: 1.1, onCeiling: false, onWall: true, color: 0xf2f2f2 },
  box: { name: 'Разкл. кутия', defaultHeight: 2.3, onCeiling: true, onWall: true, color: 0xf08a24 },
  lamp: { name: 'Лампа', defaultHeight: 2.6, onCeiling: true, onWall: false, color: 0xffe08a },
};

export const CABLE_INFO: Record<CableType, { color: number; name: string }> = {
  '3x1.5': { color: 0x2f7fd8, name: '3×1.5 (осветление)' },
  '3x2.5': { color: 0xd8392f, name: '3×2.5 (контакти)' },
  '5x2.5': { color: 0x8a3fd8, name: '5×2.5 (трифазен)' },
  '5x4': { color: 0x1f9e6b, name: '5×4 (кухня/бойлер)' },
};

export const WALL_THICKNESS = 0.1;
/** Devices and cables sit this far off the wall face. */
export const SURFACE_OFFSET = 0.012;

let counter = 0;
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export function emptyProject(): Project {
  return { version: 1, ceilingHeight: 2.6, walls: [], devices: [], cables: [] };
}

export function wallLength(w: Wall): number {
  return Math.hypot(w.x2 - w.x1, w.z2 - w.z1);
}

export function isRef(p: CablePoint): p is { ref: DeviceId } {
  return (p as { ref?: string }).ref !== undefined;
}
