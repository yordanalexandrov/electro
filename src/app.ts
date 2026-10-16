import * as THREE from 'three';
import {
  Anchor,
  CABLE_INFO,
  Cable,
  CablePoint,
  CableType,
  DEVICE_INFO,
  Device,
  DeviceKind,
  Project,
  Wall,
  emptyProject,
  isRef,
  uid,
  wallLength,
} from './model';
import { anchorPosition, cablePath, pathLength, resolvePoint, wallAnchorFromPoint, wallDir, wallNormal } from './routing';
import { sampleProject } from './sample';
import { Sh3dVariant, parseSh3d, projectFromVariant } from './sh3d';
import { Hit, SceneView, Selection, ViewMode } from './scene';

type Tool = 'select' | 'wall' | DeviceKind | 'cable';

const STORAGE_KEY = 'electro.project.v2';
const GRID = 0.1;

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

export class App {
  project: Project;
  view: SceneView;
  tool: Tool = 'select';
  selection: Selection | null = null;
  history: string[] = [];

  // drafts
  wallStart: { x: number; z: number } | null = null;
  cableDraft: Cable | null = null;

  // tool options
  deviceHeight: Record<DeviceKind, number> = {
    panel: DEVICE_INFO.panel.defaultHeight,
    outlet: DEVICE_INFO.outlet.defaultHeight,
    switch: DEVICE_INFO.switch.defaultHeight,
    box: DEVICE_INFO.box.defaultHeight,
    lamp: DEVICE_INFO.lamp.defaultHeight,
  };
  cableType: CableType = '3x2.5';
  ortho = true;

  private sh3dVariants: Sh3dVariant[] | null = null;
  private hover: THREE.Vector2 | null = null;
  private pointerDown: { x: number; y: number; t: number } | null = null;

  constructor() {
    this.project = this.load() ?? sampleProject();
    this.view = new SceneView($('#c'));
    this.bindUI();
    this.setView('3d', false);
    this.rebuild();
    this.view.frame(this.project);
    this.loop();
  }

  // ---------- persistence ----------
  private load(): Project | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw) as Project;
      return p && p.version === 1 ? p : null;
    } catch {
      return null;
    }
  }
  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.project));
    } catch {
      /* ignore */
    }
  }

  /** Call before every mutation. */
  private commit(): void {
    this.history.push(JSON.stringify(this.project));
    if (this.history.length > 60) this.history.shift();
  }
  undo(): void {
    const s = this.history.pop();
    if (!s) return this.status('Няма какво да се отмени');
    this.project = JSON.parse(s) as Project;
    this.selection = null;
    this.cancelDraft();
    this.rebuild();
  }

  // ---------- rendering ----------
  private loop = (): void => {
    this.view.render();
    requestAnimationFrame(this.loop);
  };

  rebuild(): void {
    this.view.build(this.project, this.selection);
    this.renderProps();
    this.renderSummary();
    this.save();
  }

  // ---------- UI ----------
  private bindUI(): void {
    const ro = new ResizeObserver(() => this.view.resize());
    ro.observe($('#stage'));

    document.querySelectorAll<HTMLButtonElement>('#viewSeg button').forEach((b) =>
      b.addEventListener('click', () => this.setView(b.dataset.view as ViewMode)),
    );
    document.querySelectorAll<HTMLButtonElement>('#rail button').forEach((b) =>
      b.addEventListener('click', () => this.setTool(b.dataset.tool as Tool)),
    );
    $('#btnUndo').addEventListener('click', () => this.undo());
    $('#btnFrame').addEventListener('click', () => this.view.frame(this.project));
    $<HTMLInputElement>('#chkGrid').addEventListener('change', (e) => {
      this.view.showGrid = (e.target as HTMLInputElement).checked;
      this.rebuild();
    });
    $<HTMLInputElement>('#chkCeiling').addEventListener('change', (e) => {
      this.view.showCeiling = (e.target as HTMLInputElement).checked;
      this.rebuild();
    });
    const menu = $('#menuList');
    $('#btnMore').addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('open');
    });
    document.addEventListener('click', () => menu.classList.remove('open'));
    $('#btnMenuGrid').addEventListener('click', () => {
      const c = $<HTMLInputElement>('#chkGrid');
      c.checked = !c.checked;
      c.dispatchEvent(new Event('change'));
    });
    $('#btnMenuCeiling').addEventListener('click', () => {
      const c = $<HTMLInputElement>('#chkCeiling');
      c.checked = !c.checked;
      c.dispatchEvent(new Event('change'));
    });
    $('#btnExport').addEventListener('click', () => this.exportJson());
    $('#btnImport').addEventListener('click', () => $<HTMLInputElement>('#fileImport').click());
    $<HTMLInputElement>('#fileImport').addEventListener('change', (e) => this.importJson(e));
    $('#btnImportSh3d').addEventListener('click', () => $<HTMLInputElement>('#fileSh3d').click());
    $<HTMLInputElement>('#fileSh3d').addEventListener('change', (e) => this.importSh3d(e));
    $('#btnSample').addEventListener('click', () => {
      this.commit();
      this.project = sampleProject();
      this.selection = null;
      this.cancelDraft();
      this.rebuild();
      this.view.frame(this.project);
    });
    let clearArmed = false;
    $('#btnClear').addEventListener('click', (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      if (!clearArmed) {
        clearArmed = true;
        b.textContent = 'Сигурен? Натисни пак';
        e.stopPropagation();
        setTimeout(() => {
          clearArmed = false;
          b.textContent = 'Изчисти всичко';
        }, 3000);
        return;
      }
      clearArmed = false;
      b.textContent = 'Изчисти всичко';
      this.commit();
      this.project = emptyProject();
      this.selection = null;
      this.cancelDraft();
      this.rebuild();
      this.setTool('wall');
    });
    $('#btnSide').addEventListener('click', () => $('#side').classList.toggle('open'));
    $('#btnDraftDone').addEventListener('click', () => this.finishDraft());
    $('#btnDraftCancel').addEventListener('click', () => this.cancelDraft());

    const canvas = this.view.canvas;
    canvas.addEventListener('pointerdown', (e) => {
      this.pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    canvas.addEventListener('pointerup', (e) => {
      const d = this.pointerDown;
      this.pointerDown = null;
      if (!d) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || performance.now() - d.t > 600) return;
      if (e.button !== 0) return;
      this.onTap(this.ndc(e), e.shiftKey);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.hover = this.ndc(e);
      this.updatePreview(e.shiftKey);
    });
    canvas.addEventListener('pointerleave', () => {
      this.hover = null;
      this.updatePreview(false);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('dblclick', () => this.finishDraft());

    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  private ndc(e: PointerEvent): THREE.Vector2 {
    const r = this.view.canvas.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private onKey(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const tools: Tool[] = ['select', 'wall', 'panel', 'outlet', 'switch', 'box', 'lamp', 'cable'];
    if (e.key >= '1' && e.key <= '8') return this.setTool(tools[Number(e.key) - 1]);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      return this.undo();
    }
    switch (e.key) {
      case 'Escape':
        if (this.wallStart || this.cableDraft) this.cancelDraft();
        else {
          this.selection = null;
          this.rebuild();
        }
        break;
      case 'Enter':
        this.finishDraft();
        break;
      case 'Delete':
      case 'Backspace':
        this.deleteSelection();
        break;
      case 'Tab':
        e.preventDefault();
        this.setView(this.view.mode === 'plan' ? '3d' : 'plan');
        break;
      case 'g':
      case 'G': {
        const c = $<HTMLInputElement>('#chkGrid');
        c.checked = !c.checked;
        c.dispatchEvent(new Event('change'));
        break;
      }
    }
  }

  setView(mode: ViewMode, frame = true): void {
    document.querySelectorAll<HTMLButtonElement>('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.view === mode));
    this.view.setMode(mode, this.project);
    this.view.build(this.project, this.selection);
    if (frame) this.view.frame(this.project);
    this.updatePreview(false);
    this.renderProps();
    this.hint();
  }

  setTool(tool: Tool): void {
    if (tool !== this.tool) this.cancelDraft();
    this.tool = tool;
    document.querySelectorAll<HTMLButtonElement>('#rail button').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
    if (tool === 'wall' && this.view.mode !== 'plan') this.setView('plan');
    if (tool === 'lamp' && this.view.mode !== 'plan' && !this.view.showCeiling) this.setView('plan');
    this.selection = null;
    this.rebuild();
    this.hint();
  }

  status(msg: string): void {
    $('#status').textContent = msg;
  }

  private hint(): void {
    const plan = this.view.mode === 'plan';
    const nav = plan ? 'Влачене = местене, колелце/щипка = мащаб.' : 'Влачене = въртене, десен бутон/два пръста = местене, колелце/щипка = мащаб.';
    const t: Record<Tool, string> = {
      select: 'Докосни стена, устройство или кабел, за да го избереш. Delete изтрива.',
      wall: 'Докосвай ъглите на стените в плана. Enter/двоен клик = край. Shift = свободен ъгъл.',
      panel: 'Докосни стена (в 3D — от страната, където ще стои таблото).',
      outlet: 'Докосни стена. Височината е от панела „Свойства“.',
      switch: 'Докосни стена. Височината е от панела „Свойства“.',
      box: 'Докосни стена или тавана (в плана — пода = таван).',
      lamp: 'Докосни тавана (в плана — пода = таван).',
      cable: 'Първо докосни табло/кутия, после точки по стени и таван, накрая устройство.',
    };
    this.status(`${t[this.tool]} ${nav}`);
  }

  // ---------- interaction ----------
  private hitFor(ndc: THREE.Vector2, kinds: Hit['kind'][]): Hit | null {
    return this.view.hit(ndc, this.project, new Set(kinds));
  }

  private snapXZ(p: THREE.Vector3, shift: boolean): { x: number; z: number } {
    let x = Math.round(p.x / GRID) * GRID;
    let z = Math.round(p.z / GRID) * GRID;
    // snap to existing wall ends
    for (const w of this.project.walls) {
      for (const [ex, ez] of [[w.x1, w.z1], [w.x2, w.z2]]) {
        if (Math.hypot(ex - x, ez - z) < 0.25) {
          x = ex;
          z = ez;
        }
      }
    }
    if (this.wallStart && this.ortho !== shift) {
      const dx = x - this.wallStart.x;
      const dz = z - this.wallStart.z;
      if (Math.abs(dx) > Math.abs(dz)) z = this.wallStart.z;
      else x = this.wallStart.x;
    }
    return { x: +x.toFixed(3), z: +z.toFixed(3) };
  }

  /** Nearest wall to a floor point (plan view placement). */
  private nearestWall(p: THREE.Vector3, maxDist = 0.35): { wall: Wall; side: 1 | -1; dist: number } | null {
    let best: { wall: Wall; side: 1 | -1; dist: number } | null = null;
    for (const w of this.project.walls) {
      const d = wallDir(w);
      const rel = new THREE.Vector3(p.x - w.x1, 0, p.z - w.z1);
      const t = rel.dot(d);
      if (t < -0.05 || t > wallLength(w) + 0.05) continue;
      const n = wallNormal(w, 1);
      const off = rel.dot(n);
      const dist = Math.abs(off);
      if (dist <= maxDist && (!best || dist < best.dist)) best = { wall: w, side: off >= 0 ? 1 : -1, dist };
    }
    return best;
  }

  /** Turn a hit into a surface anchor (walls or ceiling). */
  private anchorFromHit(h: Hit, height: number | null, allowCeiling: boolean, allowWall: boolean): Anchor | null {
    if (h.kind === 'wall' && allowWall) {
      const w = this.project.walls.find((x) => x.id === h.id);
      if (!w) return null;
      if (h.side === 0) {
        // top of a wall (plan view): pick the face nearest to the pointer isn't known; use +1
        const a = wallAnchorFromPoint(this.project, w, h.point, 1);
        a.h = height ?? this.project.ceilingHeight - 0.3;
        return a;
      }
      const a = wallAnchorFromPoint(this.project, w, h.point, h.side!);
      if (height !== null) a.h = height;
      return a;
    }
    if (h.kind === 'ceiling' && allowCeiling) {
      return { surface: 'ceiling', x: Math.round(h.point.x / GRID) * GRID, z: Math.round(h.point.z / GRID) * GRID };
    }
    if (h.kind === 'floor') {
      if (allowWall && this.view.mode === 'plan') {
        const nw = this.nearestWall(h.point);
        if (nw) {
          const a = wallAnchorFromPoint(this.project, nw.wall, h.point, nw.side);
          a.h = height ?? this.project.ceilingHeight - 0.3;
          return a;
        }
      }
      if (allowCeiling && this.view.mode === 'plan') {
        return { surface: 'ceiling', x: Math.round(h.point.x / GRID) * GRID, z: Math.round(h.point.z / GRID) * GRID };
      }
    }
    return null;
  }

  private onTap(ndc: THREE.Vector2, shift: boolean): void {
    switch (this.tool) {
      case 'select': {
        const h = this.hitFor(ndc, ['device', 'cable', 'wall']);
        this.selection = h && h.id ? { kind: h.kind as Selection['kind'], id: h.id } : null;
        this.rebuild();
        if (this.selection) $('#side').classList.add('open');
        return;
      }
      case 'wall': {
        const h = this.hitFor(ndc, ['floor']);
        if (!h) return;
        const p = this.snapXZ(h.point, shift);
        if (!this.wallStart) {
          this.wallStart = p;
          this.showDraftBar('Стена: докосни следващия ъгъл');
          return;
        }
        const len = Math.hypot(p.x - this.wallStart.x, p.z - this.wallStart.z);
        if (len < 0.05) return this.finishDraft();
        this.commit();
        this.project.walls.push({ id: uid('w'), x1: this.wallStart.x, z1: this.wallStart.z, x2: p.x, z2: p.z });
        this.wallStart = p;
        this.rebuild();
        this.showDraftBar(`Стена ${len.toFixed(2)} м добавена — продължи или „Готово“`);
        return;
      }
      case 'panel':
      case 'outlet':
      case 'switch':
      case 'box':
      case 'lamp': {
        const kind = this.tool;
        const info = DEVICE_INFO[kind];
        const h = this.hitFor(ndc, ['wall', 'ceiling', 'floor']);
        if (!h) return;
        const a = this.anchorFromHit(h, this.deviceHeight[kind], info.onCeiling, info.onWall);
        if (!a) return this.status(info.onWall ? 'Докосни стена.' : 'Докосни тавана (или пода в плана).');
        this.commit();
        const d: Device = { id: uid('d'), kind, anchor: a, label: info.name };
        this.project.devices.push(d);
        this.selection = { kind: 'device', id: d.id };
        this.rebuild();
        return;
      }
      case 'cable': {
        const hd = this.hitFor(ndc, ['device']);
        if (hd && hd.id) {
          if (!this.cableDraft) {
            this.cableDraft = { id: uid('c'), type: this.cableType, points: [{ ref: hd.id }] };
            this.showDraftBar('Кабел: докосвай точки по стени/таван, завърши на устройство');
          } else {
            const last = this.cableDraft.points[this.cableDraft.points.length - 1];
            if (isRef(last) && last.ref === hd.id) return;
            this.cableDraft.points.push({ ref: hd.id });
            this.finishDraft();
          }
          this.updatePreview(false);
          return;
        }
        if (!this.cableDraft) return this.status('Кабелът започва от устройство — докосни табло, кутия или контакт.');
        const h = this.hitFor(ndc, ['wall', 'ceiling', 'floor']);
        if (!h) return;
        const a = this.anchorFromHit(h, null, true, true);
        if (!a) return;
        this.cableDraft.points.push(a);
        this.updatePreview(false);
        this.showDraftBar(`Кабел: ${this.cableDraft.points.length} точки — продължи или завърши на устройство`);
        return;
      }
    }
  }

  private showDraftBar(text: string): void {
    $('#draftText').textContent = text;
    $('#draftBar').hidden = false;
  }
  private hideDraftBar(): void {
    $('#draftBar').hidden = true;
  }

  finishDraft(): void {
    if (this.wallStart) {
      this.wallStart = null;
      this.hideDraftBar();
      this.updatePreview(false);
      return;
    }
    if (this.cableDraft) {
      if (this.cableDraft.points.length >= 2) {
        this.commit();
        this.project.cables.push(this.cableDraft);
        this.selection = { kind: 'cable', id: this.cableDraft.id };
      }
      this.cableDraft = null;
      this.hideDraftBar();
      this.rebuild();
      this.updatePreview(false);
    }
  }

  cancelDraft(): void {
    this.wallStart = null;
    this.cableDraft = null;
    this.hideDraftBar();
    this.updatePreview(false);
  }

  deleteSelection(): void {
    const s = this.selection;
    if (!s) return;
    this.commit();
    const p = this.project;
    if (s.kind === 'wall') {
      p.walls = p.walls.filter((w) => w.id !== s.id);
      const gone = new Set(p.devices.filter((d) => d.anchor.surface === 'wall' && d.anchor.wallId === s.id).map((d) => d.id));
      p.devices = p.devices.filter((d) => !gone.has(d.id));
      p.cables = p.cables.filter((c) => !c.points.some((pt) => (isRef(pt) ? gone.has(pt.ref) : pt.surface === 'wall' && pt.wallId === s.id)));
    } else if (s.kind === 'device') {
      p.devices = p.devices.filter((d) => d.id !== s.id);
      p.cables = p.cables.filter((c) => !c.points.some((pt) => isRef(pt) && pt.ref === s.id));
    } else {
      p.cables = p.cables.filter((c) => c.id !== s.id);
    }
    this.selection = null;
    this.rebuild();
  }

  // ---------- previews ----------
  private updatePreview(shift: boolean): void {
    this.view.clearPreview();
    const hv = this.hover;
    if (this.tool === 'wall' && this.wallStart) {
      const start = new THREE.Vector3(this.wallStart.x, 0.02, this.wallStart.z);
      this.view.preview.add(this.marker(start));
      if (hv) {
        const h = this.hitFor(hv, ['floor']);
        if (h) {
          const p = this.snapXZ(h.point, shift);
          const end = new THREE.Vector3(p.x, 0.02, p.z);
          this.view.preview.add(this.view.makeLine([start, end], 0xf08a24, true, true));
          this.status(`Дължина: ${start.distanceTo(end).toFixed(2)} м`);
        }
      }
    }
    if (this.tool === 'cable' && this.cableDraft) {
      const pts = cablePath(this.project, this.cableDraft);
      if (pts.length >= 2) this.view.preview.add(this.view.makeLine(pts, CABLE_INFO[this.cableDraft.type].color, true, true));
      const last = resolvePoint(this.project, this.cableDraft.points[this.cableDraft.points.length - 1]);
      if (last) this.view.preview.add(this.marker(last.pos));
      if (hv) {
        const h = this.hitFor(hv, ['wall', 'ceiling', 'floor']);
        const a = h ? this.anchorFromHit(h, null, true, true) : null;
        if (a) {
          const ghost: Cable = { ...this.cableDraft, points: [...this.cableDraft.points, a] };
          const gp = cablePath(this.project, ghost);
          this.view.preview.add(this.view.makeLine(gp, 0x8a8f99, false, true));
          this.view.preview.add(this.marker(anchorPosition(this.project, a)));
          this.status(`Кабел: ${pathLength(gp).toFixed(2)} м`);
        }
      }
    }
  }

  private marker(pos: THREE.Vector3): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 12), new THREE.MeshBasicMaterial({ color: 0xf08a24 }));
    m.position.copy(pos);
    return m;
  }

  // ---------- side panel ----------
  private renderProps(): void {
    const el = $('#props');
    const s = this.selection;
    const p = this.project;
    const h = (v: number) => v.toFixed(2);

    if (!s && this.sh3dVariants) {
      const vs = this.sh3dVariants;
      el.innerHTML = `<h3>Sweet Home 3D — избери чертеж</h3>
        <div class="row" style="flex-direction:column;align-items:stretch">${vs
          .map((v, i) => `<button data-v="${i}">#${i + 1}: ${v.widthM.toFixed(1)} × ${v.depthM.toFixed(1)} м, ${v.walls.length} стени, H ${v.wallHeightM} м</button>`)
          .join('')}<button id="vCancel">Откажи</button></div>
        <p class="hint">Файлът съдържа няколко чертежа един до друг. Зареждат се само стените; устройствата и кабелите ги чертаеш след това.</p>`;
      el.querySelectorAll<HTMLButtonElement>('button[data-v]').forEach((b) =>
        b.addEventListener('click', () => this.loadProject(projectFromVariant(vs[Number(b.dataset.v)]))),
      );
      el.querySelector('#vCancel')!.addEventListener('click', () => {
        this.sh3dVariants = null;
        this.renderProps();
      });
      return;
    }

    if (!s) {
      let opts = '';
      if (this.tool in DEVICE_INFO) {
        const k = this.tool as DeviceKind;
        if (DEVICE_INFO[k].onWall) {
          opts += `<div class="field"><label>Височина от пода (м)</label><input type="number" step="0.05" min="0" max="${p.ceilingHeight}" id="optH" value="${this.deviceHeight[k]}"></div>`;
        }
      }
      if (this.tool === 'cable') {
        opts += `<div class="field"><label>Тип кабел</label><select id="optCable">${(Object.keys(CABLE_INFO) as CableType[])
          .map((t) => `<option value="${t}" ${t === this.cableType ? 'selected' : ''}>${CABLE_INFO[t].name}</option>`)
          .join('')}</select></div>`;
      }
      if (this.tool === 'wall') {
        opts += `<div class="field"><label>Орто режим (прави ъгли)</label><input type="checkbox" id="optOrtho" ${this.ortho ? 'checked' : ''}></div>`;
      }
      el.innerHTML = `<h3>Инструмент: ${this.toolName()}</h3>${opts}
        <div class="field"><label>Височина на тавана (м)</label><input type="number" step="0.05" min="2" max="4" id="optCeil" value="${p.ceilingHeight}"></div>
        <p class="hint">Клавиши: 1–8 инструменти, Tab план/3D, Enter край, Esc отказ, Delete изтрий, Ctrl+Z отмени, G мрежа.</p>`;
      el.querySelector<HTMLInputElement>('#optH')?.addEventListener('change', (e) => {
        this.deviceHeight[this.tool as DeviceKind] = Number((e.target as HTMLInputElement).value);
      });
      el.querySelector<HTMLSelectElement>('#optCable')?.addEventListener('change', (e) => {
        this.cableType = (e.target as HTMLSelectElement).value as CableType;
      });
      el.querySelector<HTMLInputElement>('#optOrtho')?.addEventListener('change', (e) => {
        this.ortho = (e.target as HTMLInputElement).checked;
      });
      el.querySelector<HTMLInputElement>('#optCeil')?.addEventListener('change', (e) => {
        this.commit();
        p.ceilingHeight = Number((e.target as HTMLInputElement).value);
        this.rebuild();
      });
      return;
    }

    if (s.kind === 'wall') {
      const w = p.walls.find((x) => x.id === s.id);
      if (!w) return;
      el.innerHTML = `<h3>Стена</h3>
        <div class="field"><label>Дължина</label><div>${h(wallLength(w))} м</div></div>
        <div class="field"><label>От</label><div>(${h(w.x1)}, ${h(w.z1)})</div></div>
        <div class="field"><label>До</label><div>(${h(w.x2)}, ${h(w.z2)})</div></div>
        <div class="row"><button id="pDel" class="danger">Изтрий стената</button></div>`;
      el.querySelector('#pDel')!.addEventListener('click', () => this.deleteSelection());
      return;
    }

    if (s.kind === 'device') {
      const d = p.devices.find((x) => x.id === s.id);
      if (!d) return;
      const a = d.anchor;
      const connected = p.cables.filter((c) => c.points.some((pt) => isRef(pt) && pt.ref === d.id)).length;
      let pos = '';
      if (a.surface === 'wall') {
        const w = p.walls.find((x) => x.id === a.wallId);
        pos = `<div class="field"><label>Височина (м)</label><input type="number" step="0.05" min="0" max="${p.ceilingHeight}" id="pH" value="${a.h}"></div>
          <div class="field"><label>По стената (м)</label><input type="number" step="0.05" min="0" max="${w ? wallLength(w).toFixed(2) : 0}" id="pT" value="${a.t}"></div>
          <div class="row"><button id="pFlip">Обърни на другата страна</button></div>`;
      } else {
        pos = `<div class="field"><label>X (м)</label><input type="number" step="0.05" id="pX" value="${a.x}"></div>
          <div class="field"><label>Z (м)</label><input type="number" step="0.05" id="pZ" value="${a.z}"></div>`;
      }
      el.innerHTML = `<h3>${DEVICE_INFO[d.kind].name}</h3>
        <div class="field"><label>Етикет</label><input type="text" id="pLabel" value="${esc(d.label)}"></div>
        ${pos}
        <div class="field"><label>Кабели</label><div>${connected}</div></div>
        <div class="row"><button id="pCable">Начертай кабел оттук</button><button id="pDel" class="danger">Изтрий</button></div>`;
      const upd = (fn: () => void) => {
        this.commit();
        fn();
        this.rebuild();
      };
      el.querySelector<HTMLInputElement>('#pLabel')!.addEventListener('change', (e) => upd(() => (d.label = (e.target as HTMLInputElement).value)));
      el.querySelector<HTMLInputElement>('#pH')?.addEventListener('change', (e) => upd(() => a.surface === 'wall' && (a.h = clamp(Number((e.target as HTMLInputElement).value), 0, p.ceilingHeight))));
      el.querySelector<HTMLInputElement>('#pT')?.addEventListener('change', (e) => upd(() => a.surface === 'wall' && (a.t = Math.max(0, Number((e.target as HTMLInputElement).value)))));
      el.querySelector<HTMLInputElement>('#pX')?.addEventListener('change', (e) => upd(() => a.surface === 'ceiling' && (a.x = Number((e.target as HTMLInputElement).value))));
      el.querySelector<HTMLInputElement>('#pZ')?.addEventListener('change', (e) => upd(() => a.surface === 'ceiling' && (a.z = Number((e.target as HTMLInputElement).value))));
      el.querySelector('#pFlip')?.addEventListener('click', () => upd(() => a.surface === 'wall' && (a.side = a.side === 1 ? -1 : 1)));
      el.querySelector('#pDel')!.addEventListener('click', () => this.deleteSelection());
      el.querySelector('#pCable')!.addEventListener('click', () => {
        this.setTool('cable');
        this.cableDraft = { id: uid('c'), type: this.cableType, points: [{ ref: d.id }] };
        this.showDraftBar('Кабел: докосвай точки по стени/таван, завърши на устройство');
        this.updatePreview(false);
      });
      return;
    }

    const c = p.cables.find((x) => x.id === s.id);
    if (!c) return;
    const len = pathLength(cablePath(p, c));
    const ends = c.points.filter(isRef).map((r) => p.devices.find((d) => d.id === r.ref)?.label ?? '?');
    el.innerHTML = `<h3>Кабел</h3>
      <div class="field"><label>Тип</label><select id="pType">${(Object.keys(CABLE_INFO) as CableType[])
        .map((t) => `<option value="${t}" ${t === c.type ? 'selected' : ''}>${CABLE_INFO[t].name}</option>`)
        .join('')}</select></div>
      <div class="field"><label>Дължина</label><div>${h(len)} м</div></div>
      <div class="field"><label>Точки</label><div>${c.points.length}</div></div>
      <div class="field"><label>Свързва</label><div>${esc(ends.join(' → ')) || '—'}</div></div>
      <div class="row"><button id="pDel" class="danger">Изтрий кабела</button></div>`;
    el.querySelector<HTMLSelectElement>('#pType')!.addEventListener('change', (e) => {
      this.commit();
      c.type = (e.target as HTMLSelectElement).value as CableType;
      this.rebuild();
    });
    el.querySelector('#pDel')!.addEventListener('click', () => this.deleteSelection());
  }

  private toolName(): string {
    if (this.tool === 'select') return 'Избор';
    if (this.tool === 'wall') return 'Стена';
    if (this.tool === 'cable') return 'Кабел';
    return DEVICE_INFO[this.tool].name;
  }

  private renderSummary(): void {
    const p = this.project;
    const byType = new Map<CableType, number>();
    for (const c of p.cables) byType.set(c.type, (byType.get(c.type) ?? 0) + pathLength(cablePath(p, c)));
    const counts = new Map<DeviceKind, number>();
    for (const d of p.devices) counts.set(d.kind, (counts.get(d.kind) ?? 0) + 1);

    const connectedIds = new Set<string>();
    for (const c of p.cables) for (const pt of c.points) if (isRef(pt)) connectedIds.add(pt.ref);
    const unconnected = p.devices.filter((d) => !connectedIds.has(d.id));
    const dangling = p.cables.filter((c) => !isRef(c.points[0]) || !isRef(c.points[c.points.length - 1]));

    let total = 0;
    const rows = [...byType.entries()]
      .map(([t, L]) => {
        total += L;
        return `<tr><td><span class="swatch" style="background:#${CABLE_INFO[t].color.toString(16).padStart(6, '0')}"></span>${CABLE_INFO[t].name}</td><td>${L.toFixed(1)} м</td></tr>`;
      })
      .join('');
    const dev = [...counts.entries()].map(([k, n]) => `<tr><td>${DEVICE_INFO[k].name}</td><td>${n}</td></tr>`).join('');
    const warns: string[] = [];
    if (unconnected.length) warns.push(`${unconnected.length} устройства без кабел: ${unconnected.map((d) => esc(d.label)).join(', ')}`);
    if (dangling.length) warns.push(`${dangling.length} кабела не завършват на устройство`);

    $('#summary').innerHTML = `<div class="sum"><h3>Обобщение</h3>
      <table>${rows}<tr><td><b>Общо кабел</b></td><td><b>${total.toFixed(1)} м</b></td></tr></table>
      <h3 style="margin-top:12px">Устройства</h3>
      <table>${dev}<tr><td>Стени</td><td>${p.walls.length}</td></tr></table>
      ${warns.length ? warns.map((w) => `<div class="warn">⚠ ${w}</div>`).join('') : '<div class="ok">✓ Всичко е свързано</div>'}
    </div>`;
  }

  // ---------- import/export ----------
  private exportJson(): void {
    const blob = new Blob([JSON.stringify(this.project, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'electro-project.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }
  private async importSh3d(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    try {
      const variants = await parseSh3d(await f.arrayBuffer());
      input.value = '';
      if (variants.length === 1) return this.loadProject(projectFromVariant(variants[0]));
      this.sh3dVariants = variants;
      this.selection = null;
      this.renderProps();
      $('#side').classList.add('open');
      this.status(`Файлът съдържа ${variants.length} чертежа — избери кой да заредиш.`);
    } catch (err) {
      input.value = '';
      this.status(`Грешка при импорт: ${(err as Error).message}`);
    }
  }

  private loadProject(p: Project): void {
    this.commit();
    this.project = p;
    this.selection = null;
    this.sh3dVariants = null;
    this.cancelDraft();
    this.rebuild();
    this.view.frame(this.project);
    this.hint();
  }

  private importJson(e: Event): void {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    f.text().then((txt) => {
      try {
        const p = JSON.parse(txt) as Project;
        if (p.version !== 1 || !Array.isArray(p.walls)) throw new Error('bad');
        this.commit();
        this.project = p;
        this.selection = null;
        this.cancelDraft();
        this.rebuild();
        this.view.frame(this.project);
      } catch {
        alert('Невалиден файл.');
      }
      input.value = '';
    });
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// keep type imports referenced
export type { CablePoint };
