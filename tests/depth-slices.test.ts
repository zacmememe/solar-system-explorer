import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { depthSlices, DepthSliceRenderer } from '../src/engine/DepthSliceRenderer';

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
