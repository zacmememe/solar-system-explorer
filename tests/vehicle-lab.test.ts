import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
// @ts-expect-error Isolated browser tooling intentionally lives outside production TS.
import { prepareModel, setPresentationSpan, fitPresentationToViewport } from '../tools/vehicle-lab/model.mjs';

describe('isolated vehicle presentation transforms', () => {
  it.each([.001, 1, 1000])('keeps apparent bounds independent of metric calibration %s', metricScale => {
    const raw = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 1));
    body.position.set(10, 7, -3); raw.add(body);
    const model = prepareModel(raw, { metricScale, rotation: [0, Math.PI / 2, 0] });
    setPresentationSpan(model, .6375);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    expect(Math.max(size.x, size.y, size.z)).toBeCloseTo(.6375, 8);
    expect(bounds.getCenter(new THREE.Vector3()).length()).toBeLessThan(1e-8);
    expect(model.children[0].scale.x).toBe(metricScale);
  });
  it('keeps assembled parts in their relative source positions', () => {
    const raw = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 1));
    const engine = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    engine.position.set(0, 0, -5); raw.add(body, engine);
    const model = prepareModel(raw, { metricScale: 3 });
    setPresentationSpan(model, 1);
    const delta = engine.getWorldPosition(new THREE.Vector3()).sub(body.getWorldPosition(new THREE.Vector3()));
    expect(delta.z).toBeCloseTo(-5 / 6, 8);
  });
  it('rejects empty or nonfinite calibration instead of showing a fallback', () => {
    expect(() => prepareModel(new THREE.Group())).toThrow('Empty');
    expect(() => prepareModel(new THREE.Group(), { metricScale: NaN })).toThrow('metric');
  });
  it('keeps long appendages on screen at a low right-hand presentation anchor', () => {
    const raw = new THREE.Mesh(new THREE.BoxGeometry(1, 12, 1));
    const model = prepareModel(raw, { metricScale: .0254 });
    const camera = new THREE.PerspectiveCamera(45, 1.4, .001, 1000);
    camera.add(model); model.position.set(.48, -.34, -2.1); model.rotation.set(.12, -.38, 0);
    const actualSpan = fitPresentationToViewport(model, camera, 1.8);
    expect(actualSpan).toBeLessThan(1.8); expect(actualSpan).toBeGreaterThan(.1);
    camera.updateMatrixWorld(true);
    const position = raw.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      const projected = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(raw.matrixWorld).project(camera);
      expect(Math.abs(projected.x)).toBeLessThanOrEqual(.92); expect(Math.abs(projected.y)).toBeLessThanOrEqual(.92);
      expect(Math.abs(projected.z)).toBeLessThan(1);
    }
    expect(model.children[0].scale.x).toBe(.0254);
  });
});
