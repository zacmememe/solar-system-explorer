/**
 * P1（8deebfc 复核）测试：挖孔补片克隆材质的光照同步
 * ——— 本体光照/纹理 uniform 与补片共享同一对象；仅透明度独立。
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createMoonMaterial } from '../src/rendering/MoonMaterial';
import { makeHolePatchMaterial, patchOpacityUniform, setSurfaceLayerOpacity } from '../src/rendering/HolePatchMaterial';

describe('P1：挖孔补片材质光照同步', () => {
  it('光照 uniform（sunDirection/teachingLight）与本体共享同一对象——本体更新即补片同步', () => {
    const src = createMoonMaterial(new THREE.Texture());
    const patch = makeHolePatchMaterial(src);
    // 对象级共享（不是值拷贝）
    expect(patch.uniforms.sunDirection).toBe(src.uniforms.sunDirection);
    expect(patch.uniforms.teachingLight).toBe(src.uniforms.teachingLight);
    expect(patch.uniforms.moonTexture).toBe(src.uniforms.moonTexture);
    // 值同步：本体更新后补片读到同一值（旧实现为克隆副本，冻结在克隆时刻）
    src.uniforms.sunDirection.value.set(0, 1, 0);
    src.uniforms.teachingLight.value = 1;
    expect(patch.uniforms.sunDirection.value.z).toBe(0);
    expect(patch.uniforms.sunDirection.value.y).toBe(1);
    expect(patch.uniforms.teachingLight.value).toBe(1);
  });

  it('补片透明度独立：uOpacity 可单独动画，本体 alpha 恒 1', () => {
    const src = createMoonMaterial(new THREE.Texture());
    const patch = makeHolePatchMaterial(src);
    const u = patchOpacityUniform(patch);
    expect(u).not.toBeNull();
    u!.value = 0.35;
    expect(patch.uniforms.uOpacity.value).toBe(0.35);
    expect(src.uniforms.uOpacity.value).toBe(1); // 本体不受补片淡出影响
  });

  it('transparent/depthWrite 标志：透明队列渲染且不写深度', () => {
    const src = createMoonMaterial(new THREE.Texture());
    const patch = makeHolePatchMaterial(src);
    expect(patch.transparent).toBe(true);
    expect(patch.depthWrite).toBe(false);
  });

  it('无 uniforms 的普通材质回退：不抛错、不假设 uOpacity 存在', () => {
    const plain = new THREE.MeshStandardMaterial({ color: 0x888888 });
    const patch = makeHolePatchMaterial(plain);
    expect(patchOpacityUniform(patch)).toBeNull();
    expect(patch.transparent).toBe(true);
    setSurfaceLayerOpacity(patch, 0);
    expect(patch.opacity).toBe(0); // missing body texture must not leave an opaque sphere over terrain
  });

  it('a surface built before the body texture uses the same live lighting after replacement', () => {
    const shared = {sunDirection: {value: new THREE.Vector3(1,0,0)}, teachingLight: {value: 0}};
    const surface = createMoonMaterial(null, {shared});
    const body = createMoonMaterial(new THREE.Texture(), {shared});
    body.uniforms.sunDirection.value.set(0, 1, 0);
    body.uniforms.teachingLight.value = 1;
    expect(surface.uniforms.sunDirection.value.toArray()).toEqual([0,1,0]);
    expect(surface.uniforms.teachingLight.value).toBe(1);
    setSurfaceLayerOpacity(surface, .2);
    expect(body.uniforms.uOpacity.value).toBe(1);
  });

  it('Mars and ordinary fallback opacity fade without modifying the body or writing depth', () => {
    const body = new THREE.ShaderMaterial({uniforms: {layerOpacity: {value: 1}}});
    const patch = makeHolePatchMaterial(body);
    setSurfaceLayerOpacity(patch, .3);
    expect(patch.uniforms.layerOpacity.value).toBe(.3);
    expect(body.uniforms.layerOpacity.value).toBe(1);
    setSurfaceLayerOpacity(patch, 1);
    expect(patch.depthWrite).toBe(false);
    expect(patch.transparent).toBe(true);
  });
});
