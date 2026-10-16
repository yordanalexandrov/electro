import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { CABLE_INFO, DEVICE_INFO, Device, Project, SURFACE_OFFSET, WALL_THICKNESS, Wall, wallLength } from './model';
import { anchorPosition, cablePath, wallDir, wallNormal } from './routing';

export type ViewMode = 'plan' | '3d';

export interface Hit {
  kind: 'floor' | 'wall' | 'ceiling' | 'device' | 'cable';
  point: THREE.Vector3;
  id?: string;
  /** for walls: which face was hit (+1/-1), or 0 for top */
  side?: 1 | -1 | 0;
}

export interface Selection {
  kind: 'wall' | 'device' | 'cable';
  id: string;
}

const COLORS = {
  floor: 0xe9ebef,
  wall: 0xc9ced8,
  wallSelected: 0xf08a24,
  ceiling: 0xf4f5f8,
  grid: 0xb9bfca,
  gridCenter: 0x8d95a3,
};

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly persp: THREE.PerspectiveCamera;
  readonly ortho: THREE.OrthographicCamera;
  readonly controls: OrbitControls;
  mode: ViewMode = '3d';

  private floor: THREE.Mesh;
  private ceiling: THREE.Mesh;
  private grid: THREE.GridHelper;
  private walls = new THREE.Group();
  private devices = new THREE.Group();
  private cables = new THREE.Group();
  readonly preview = new THREE.Group();
  private raycaster = new THREE.Raycaster();
  private lineMaterials: LineMaterial[] = [];
  private wallMeshes = new Map<string, THREE.Mesh>();
  private deviceMeshes = new Map<string, THREE.Object3D>();
  private cableLines = new Map<string, Line2>();

  showCeiling = false;
  showGrid = true;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0xf0f2f5);

    this.persp = new THREE.PerspectiveCamera(55, 1, 0.05, 200);
    this.persp.position.set(8, 6, 9);
    this.ortho = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
    this.ortho.position.set(3, 20, 2);
    this.ortho.up.set(0, 0, -1);
    this.ortho.lookAt(3, 0, 2);

    this.controls = new OrbitControls(this.persp, canvas);
    this.controls.target.set(3, 1, 2);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.49;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(6, 12, 4);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-6, 6, -6);
    this.scene.add(fill);

    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshLambertMaterial({ color: COLORS.floor }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -0.002;
    this.floor.userData = { kind: 'floor' };
    this.scene.add(this.floor);

    this.grid = new THREE.GridHelper(40, 400, COLORS.gridCenter, COLORS.grid);
    this.scene.add(this.grid);

    this.ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshLambertMaterial({ color: COLORS.ceiling, side: THREE.DoubleSide, transparent: true, opacity: 0.55 }),
    );
    this.ceiling.rotation.x = Math.PI / 2;
    this.ceiling.userData = { kind: 'ceiling' };
    this.ceiling.visible = false;
    this.scene.add(this.ceiling);

    this.scene.add(this.walls, this.devices, this.cables, this.preview);
    this.resize();
  }

  get camera(): THREE.Camera {
    return this.mode === 'plan' ? this.ortho : this.persp;
  }

  resize(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    const half = this.orthoHalf;
    this.ortho.left = -half * (w / h);
    this.ortho.right = half * (w / h);
    this.ortho.top = half;
    this.ortho.bottom = -half;
    this.ortho.updateProjectionMatrix();
    for (const m of this.lineMaterials) m.resolution.set(w, h);
  }
  private orthoHalf = 4;

  setMode(mode: ViewMode, project: Project): void {
    this.mode = mode;
    const c = this.centerOf(project);
    this.controls.object = this.camera;
    if (mode === 'plan') {
      this.ortho.position.set(c.x, 30, c.z);
      this.ortho.up.set(0, 0, -1);
      this.ortho.lookAt(c.x, 0, c.z);
      this.controls.target.set(c.x, 0, c.z);
      this.controls.enableRotate = false;
      this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
      this.controls.minZoom = 0.2;
      this.controls.maxZoom = 8;
    } else {
      this.controls.target.set(c.x, 1, c.z);
      this.controls.enableRotate = true;
      this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    }
    this.controls.update();
    this.ceiling.visible = mode === '3d' && this.showCeiling;
  }

  frame(project: Project): void {
    const c = this.centerOf(project);
    const b = this.boundsOf(project);
    const span = Math.max(b.max.x - b.min.x, b.max.z - b.min.z, 4);
    if (this.mode === '3d') {
      const aspect = (this.canvas.clientWidth || 1) / (this.canvas.clientHeight || 1);
      const k = aspect < 1 ? 1 / aspect : 1;
      this.persp.position.set(c.x + span * 0.9 * k, span * 0.75 * k, c.z + span * 1.0 * k);
      this.controls.target.set(c.x, 1, c.z);
    } else {
      this.orthoHalf = span * 0.65;
      this.ortho.zoom = 1;
      this.ortho.position.set(c.x, 30, c.z);
      this.controls.target.set(c.x, 0, c.z);
      this.resize();
    }
    this.controls.update();
  }

  private boundsOf(p: Project): THREE.Box3 {
    const b = new THREE.Box3();
    for (const w of p.walls) {
      b.expandByPoint(new THREE.Vector3(w.x1, 0, w.z1));
      b.expandByPoint(new THREE.Vector3(w.x2, 0, w.z2));
    }
    if (b.isEmpty()) b.set(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 0, 2));
    return b;
  }

  private centerOf(p: Project): THREE.Vector3 {
    return this.boundsOf(p).getCenter(new THREE.Vector3());
  }

  /** Rebuild all project geometry. Cheap enough for a POC-sized project. */
  build(p: Project, sel: Selection | null): void {
    this.disposeGroup(this.walls);
    this.disposeGroup(this.devices);
    this.disposeGroup(this.cables);
    this.wallMeshes.clear();
    this.deviceMeshes.clear();
    this.cableLines.clear();
    this.lineMaterials = [];

    for (const w of p.walls) {
      const m = this.makeWall(w, p.ceilingHeight, sel?.kind === 'wall' && sel.id === w.id);
      this.wallMeshes.set(w.id, m);
      this.walls.add(m);
    }
    for (const d of p.devices) {
      const o = this.makeDevice(p, d, sel?.kind === 'device' && sel.id === d.id);
      if (o) {
        this.deviceMeshes.set(d.id, o);
        this.devices.add(o);
      }
    }
    for (const c of p.cables) {
      const pts = cablePath(p, c);
      if (pts.length < 2) continue;
      const line = this.makeLine(pts, CABLE_INFO[c.type].color, sel?.kind === 'cable' && sel.id === c.id);
      line.userData = { kind: 'cable', id: c.id };
      this.cableLines.set(c.id, line);
      this.cables.add(line);
    }

    // Ceiling slab covering the wall bounds
    const b = this.boundsOf(p);
    const size = b.getSize(new THREE.Vector3());
    const c = b.getCenter(new THREE.Vector3());
    this.ceiling.geometry.dispose();
    this.ceiling.geometry = new THREE.PlaneGeometry(size.x + WALL_THICKNESS, size.z + WALL_THICKNESS);
    this.ceiling.position.set(c.x, p.ceilingHeight, c.z);
    this.ceiling.visible = this.mode === '3d' && this.showCeiling;
    this.grid.visible = this.showGrid;
    this.resize();
  }

  private makeWall(w: Wall, H: number, selected: boolean): THREE.Mesh {
    const len = wallLength(w);
    const geo = new THREE.BoxGeometry(len, H, WALL_THICKNESS);
    const mat = new THREE.MeshLambertMaterial({
      color: selected ? COLORS.wallSelected : COLORS.wall,
      transparent: true,
      opacity: this.mode === 'plan' ? 1 : 0.55,
      depthWrite: this.mode === 'plan',
    });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 1;
    m.position.set((w.x1 + w.x2) / 2, H / 2, (w.z1 + w.z2) / 2);
    m.rotation.y = -Math.atan2(w.z2 - w.z1, w.x2 - w.x1);
    m.userData = { kind: 'wall', id: w.id };
    return m;
  }

  private makeDevice(p: Project, d: Device, selected: boolean): THREE.Object3D | null {
    const info = DEVICE_INFO[d.kind];
    const a = d.anchor;
    let size: [number, number, number];
    switch (d.kind) {
      case 'panel':
        size = [0.35, 0.5, 0.09];
        break;
      case 'box':
        size = [0.1, 0.1, 0.05];
        break;
      case 'lamp':
        size = [0.25, 0.25, 0.06];
        break;
      default:
        size = [0.08, 0.08, 0.025];
    }
    const geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
    const mat = new THREE.MeshLambertMaterial({ color: info.color, emissive: selected ? 0xf08a24 : 0x000000, emissiveIntensity: 0.6 });
    const mesh = new THREE.Mesh(geo, mat);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: selected ? 0xf08a24 : 0x4a4f58 }));
    mesh.add(edge);
    const pos = anchorPosition(p, a);
    if (a.surface === 'wall') {
      const w = p.walls.find((x) => x.id === a.wallId);
      if (!w) return null;
      const n = wallNormal(w, a.side);
      mesh.position.copy(pos).addScaledVector(n, size[2] / 2 - SURFACE_OFFSET);
      mesh.lookAt(mesh.position.clone().add(n));
    } else {
      mesh.position.set(a.x, p.ceilingHeight - size[2] / 2, a.z);
      mesh.rotation.x = Math.PI / 2;
    }
    mesh.userData = { kind: 'device', id: d.id };
    return mesh;
  }

  makeLine(pts: THREE.Vector3[], color: number, selected: boolean, dashed = false): Line2 {
    const geo = new LineGeometry();
    geo.setPositions(pts.flatMap((v) => [v.x, v.y, v.z]));
    const mat = new LineMaterial({
      color,
      linewidth: selected ? 7 : 4,
      worldUnits: false,
      dashed,
      dashSize: 0.08,
      gapSize: 0.05,
      transparent: dashed,
      opacity: dashed ? 0.8 : 1,
    });
    mat.resolution.set(this.canvas.clientWidth || 1, this.canvas.clientHeight || 1);
    this.lineMaterials.push(mat);
    const line = new Line2(geo, mat);
    if (dashed) line.computeLineDistances();
    return line;
  }

  clearPreview(): void {
    this.disposeGroup(this.preview);
  }

  private disposeGroup(g: THREE.Group): void {
    for (const o of [...g.children]) {
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose?.();
      });
      g.remove(o);
    }
  }

  /** Raycast at normalized device coords. */
  hit(ndc: THREE.Vector2, p: Project, allow: Set<Hit['kind']>): Hit | null {
    this.raycaster.setFromCamera(ndc, this.camera);
    this.raycaster.params.Line2 = { threshold: 0 };
    const targets: THREE.Object3D[] = [];
    if (allow.has('device')) targets.push(...this.devices.children);
    if (allow.has('cable')) targets.push(...this.cables.children);
    if (allow.has('wall')) targets.push(...this.walls.children);
    if (allow.has('ceiling') && this.ceiling.visible) targets.push(this.ceiling);
    if (allow.has('floor')) targets.push(this.floor);
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.kind) o = o.parent;
      if (!o) continue;
      const kind = o.userData.kind as Hit['kind'];
      if (kind === 'wall') {
        const w = p.walls.find((x) => x.id === o!.userData.id);
        if (!w || !h.face) continue;
        const n = h.face.normal.clone().transformDirection(o.matrixWorld);
        let side: 1 | -1 | 0 = 0;
        if (Math.abs(n.y) < 0.5) {
          const along = wallDir(w);
          // ignore end caps
          if (Math.abs(n.dot(along)) > 0.5) continue;
          side = n.dot(wallNormal(w, 1)) > 0 ? 1 : -1;
        }
        return { kind, point: h.point, id: w.id, side };
      }
      return { kind, point: h.point, id: o.userData.id };
    }
    return null;
  }

  render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
