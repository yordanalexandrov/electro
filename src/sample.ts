import { Project, Wall } from './model';
import walls from './sample-walls.json';

/**
 * Sample: the "Rila" apartment, variant with the joined living room + kitchen and the larger
 * bathroom, imported from the Sweet Home 3D sketch (Rila.sh3d). Walls only, plus the panel.
 */
export function sampleProject(): Project {
  return {
    version: 1,
    ceilingHeight: 2.7,
    walls: (walls as Wall[]).map((w) => ({ ...w })),
    devices: [{ id: 'd_panel', kind: 'panel', label: 'Табло', anchor: { surface: 'wall', wallId: 'w3', t: 0.6, h: 1.5, side: -1 } }],
    cables: [],
  };
}
