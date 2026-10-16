import { Project } from './model';

/** A small two-room flat so the POC isn't empty on first open. */
export function sampleProject(): Project {
  return {
    version: 1,
    ceilingHeight: 2.6,
    walls: [
      { id: 'w_s', x1: 0, z1: 0, x2: 6, z2: 0 },
      { id: 'w_e', x1: 6, z1: 0, x2: 6, z2: 4 },
      { id: 'w_n', x1: 6, z1: 4, x2: 0, z2: 4 },
      { id: 'w_w', x1: 0, z1: 4, x2: 0, z2: 0 },
      { id: 'w_mid', x1: 3, z1: 0, x2: 3, z2: 2.8 },
    ],
    devices: [
      { id: 'd_panel', kind: 'panel', label: 'Табло', anchor: { surface: 'wall', wallId: 'w_w', t: 0.6, h: 1.5, side: -1 } },
      { id: 'd_box1', kind: 'box', label: 'Кутия 1', anchor: { surface: 'ceiling', x: 1.5, z: 1.2 } },
      { id: 'd_box2', kind: 'box', label: 'Кутия 2', anchor: { surface: 'ceiling', x: 4.5, z: 1.2 } },
      { id: 'd_o1', kind: 'outlet', label: 'Контакт', anchor: { surface: 'wall', wallId: 'w_s', t: 1.0, h: 0.3, side: -1 } },
      { id: 'd_o2', kind: 'outlet', label: 'Контакт', anchor: { surface: 'wall', wallId: 'w_mid', t: 1.5, h: 0.3, side: -1 } },
      { id: 'd_o3', kind: 'outlet', label: 'Контакт', anchor: { surface: 'wall', wallId: 'w_mid', t: 1.5, h: 0.3, side: 1 } },
      { id: 'd_o4', kind: 'outlet', label: 'Контакт', anchor: { surface: 'wall', wallId: 'w_e', t: 2.0, h: 0.3, side: -1 } },
      { id: 'd_o5', kind: 'outlet', label: 'Контакт', anchor: { surface: 'wall', wallId: 'w_n', t: 1.0, h: 1.1, side: -1 } },
      { id: 'd_sw1', kind: 'switch', label: 'Ключ', anchor: { surface: 'wall', wallId: 'w_mid', t: 2.5, h: 1.1, side: -1 } },
      { id: 'd_sw2', kind: 'switch', label: 'Ключ', anchor: { surface: 'wall', wallId: 'w_mid', t: 2.5, h: 1.1, side: 1 } },
      { id: 'd_l1', kind: 'lamp', label: 'Лампа', anchor: { surface: 'ceiling', x: 1.5, z: 2.2 } },
      { id: 'd_l2', kind: 'lamp', label: 'Лампа', anchor: { surface: 'ceiling', x: 4.5, z: 2.2 } },
    ],
    cables: [
      { id: 'c1', type: '3x2.5', points: [{ ref: 'd_panel' }, { ref: 'd_box1' }] },
      { id: 'c2', type: '3x2.5', points: [{ ref: 'd_box1' }, { ref: 'd_o1' }] },
      { id: 'c3', type: '3x2.5', points: [{ ref: 'd_box1' }, { ref: 'd_o2' }] },
      { id: 'c4', type: '3x2.5', points: [{ ref: 'd_box1' }, { ref: 'd_box2' }] },
      { id: 'c5', type: '3x2.5', points: [{ ref: 'd_box2' }, { ref: 'd_o3' }] },
      { id: 'c6', type: '3x2.5', points: [{ ref: 'd_box2' }, { ref: 'd_o4' }] },
      { id: 'c7', type: '3x2.5', points: [{ ref: 'd_box2' }, { ref: 'd_o5' }] },
      { id: 'c8', type: '3x1.5', points: [{ ref: 'd_box1' }, { ref: 'd_l1' }] },
      { id: 'c9', type: '3x1.5', points: [{ ref: 'd_box1' }, { ref: 'd_sw1' }] },
      { id: 'c10', type: '3x1.5', points: [{ ref: 'd_box2' }, { ref: 'd_l2' }] },
      { id: 'c11', type: '3x1.5', points: [{ ref: 'd_box2' }, { ref: 'd_sw2' }] },
    ],
  };
}
