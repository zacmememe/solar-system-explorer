import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { depthSlices, DepthSliceRenderer, VEHICLE_DISPLAY_LAYER } from '../src/engine/DepthSliceRenderer';

it('ordinary orbit uses one projection; metric surface covers every depth exactly once', () => {
  expect(depthSlices(0.1, 8000)).toEqual([{near:0.1,far:8000}]);
  const slices = depthSlices(2.12e-8, 8000);
  expect(slices[0].far).toBe(8000);
  expect(slices.at(-1)!.near).toBe(2.12e-8);
  for (let i=1;i<slices.length;i++) expect(slices[i].far).toBe(slices[i-1].near);
  for (let d=3e-8;d<8000;d*=1.37) {
    expect(slices.filter(s=>d>=s.near && d<s.far)).toHaveLength(1);
  }
  for (const s of slices) expect(s.far/s.near).toBeLessThanOrEqual(1e4+1e-8);
});

it('passes preserve pose, visibility, and the authoritative camera; clear only depth between intervals', () => {
  const camera = new THREE.PerspectiveCamera(45, 1.6, 2e-8, 8000);
  camera.position.set(35,4,30); camera.lookAt(34,4,30); camera.updateMatrixWorld();
  const projection = camera.projectionMatrix.clone();
  const scene = new THREE.Scene();
  const hidden = new THREE.Mesh(); hidden.visible=false; scene.add(hidden);
  const calls: string[]=[];
  const renderer = {autoClear:true,clear:()=>{calls.push('color+depth');},clearDepth:()=>{calls.push('depth');},render:vi.fn((_s, c)=>{
    calls.push('render');
    expect(c.position.equals(camera.position)).toBe(true);
    expect(c.quaternion.angleTo(camera.quaternion)).toBeLessThan(1e-7);
    expect(hidden.visible).toBe(false);
  })};
  const slices = new DepthSliceRenderer().render(renderer,scene,camera);
  expect(calls).toEqual(['color+depth','render',...slices.slice(1).flatMap(()=>['depth','render'])]);
  expect(camera.projectionMatrix.equals(projection)).toBe(true);
  expect(renderer.autoClear).toBe(true);
});

it('render failure restores autoClear and never resurrects hidden scene nodes', () => {
  const camera=new THREE.PerspectiveCamera(45,1,1e-8,8000), scene=new THREE.Scene();
  const node=new THREE.Mesh(); node.visible=false; scene.add(node);
  const renderer={autoClear:true,clear:()=>{},clearDepth:()=>{},render:()=>{throw Error('GPU failure');}};
  expect(()=>new DepthSliceRenderer().render(renderer,scene,camera)).toThrow('GPU failure');
  expect(renderer.autoClear).toBe(true); expect(node.visible).toBe(false);
});

it('F-VEHICLE-FOREGROUND-01: world passes never see the display layer; display pass runs last on depth-only clear', () => {
  const camera = new THREE.PerspectiveCamera(45, 1.6, 0.1, 8000);
  camera.position.set(3, 2, 5); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const scene = new THREE.Scene();
  const world = new THREE.Mesh(); world.layers.set(0); scene.add(world);
  const vehicle = new THREE.Mesh(); vehicle.layers.set(VEHICLE_DISPLAY_LAYER); scene.add(vehicle);
  const calls: string[] = [];
  const sees = (c: THREE.PerspectiveCamera, channel: number) => (c.layers.mask & (1 << channel)) !== 0;
  const renderer = {
    autoClear: true,
    clear: () => { calls.push('clear'); },
    clearDepth: () => { calls.push('depth'); },
    render: vi.fn((_s: unknown, c: THREE.PerspectiveCamera) => {
      calls.push(`render(world=${sees(c, 0) ? 1 : 0},vehicle=${sees(c, VEHICLE_DISPLAY_LAYER) ? 1 : 0})`);
    }),
  };
  const slices = new DepthSliceRenderer().render(renderer, scene, camera, { displayLayer: VEHICLE_DISPLAY_LAYER });
  expect(slices).toEqual([{ near: 0.1, far: 8000 }]);
  // 世界 pass（只 layer0）→ 清深度 → 展示 pass（只 display layer）；无双重渲染
  expect(calls).toEqual(['clear', 'render(world=1,vehicle=0)', 'depth', 'render(world=0,vehicle=1)']);
  expect(renderer.autoClear).toBe(true);
});

it('F-VEHICLE-FOREGROUND-01: without displayLayer the pass is skipped entirely (pure planet observation)', () => {
  const camera = new THREE.PerspectiveCamera(45, 1.6, 0.1, 8000);
  camera.updateMatrixWorld();
  const scene = new THREE.Scene();
  const calls: string[] = [];
  const renderer = {
    autoClear: false,
    clear: () => { calls.push('clear'); },
    clearDepth: () => { calls.push('depth'); },
    render: () => { calls.push('render'); },
  };
  new DepthSliceRenderer().render(renderer, scene, camera);
  expect(calls).toEqual(['clear', 'render']);
  expect(renderer.autoClear).toBe(false);
});

it('F-VEHICLE-FOREGROUND-01: multi-slab world passes each exclude the display layer before the display pass', () => {
  const camera = new THREE.PerspectiveCamera(45, 1, 2e-8, 8000);
  camera.updateMatrixWorld();
  const scene = new THREE.Scene();
  const renders: string[] = [];
  const renderer = {
    autoClear: true,
    clear: () => {},
    clearDepth: () => {},
    render: (_s: unknown, c: THREE.PerspectiveCamera) => {
      const seesW = (c.layers.mask & 1) !== 0;
      const seesV = (c.layers.mask & (1 << VEHICLE_DISPLAY_LAYER)) !== 0;
      renders.push(`${seesW ? 'W' : '-'}${seesV ? 'V' : '-'}`);
    },
  };
  const slices = new DepthSliceRenderer().render(renderer, scene, camera, { displayLayer: VEHICLE_DISPLAY_LAYER });
  expect(slices.length).toBeGreaterThan(1);
  expect(renders[renders.length - 1]).toBe('-V');
  for (const r of renders.slice(0, -1)) expect(r).toBe('W-');
});
