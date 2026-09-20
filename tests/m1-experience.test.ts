import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  createEarthSurfaceMaterial,
  createEarthCloudMaterial,
  createAtmosphereHaloMaterial,
} from '../src/rendering/EarthMaterial';
import { CameraController } from '../src/camera/CameraController';
import productionAssetsData from '../sources/production-assets.json';

describe('M1 地球—月球完整系统着色与体验回归测试', () => {
  it('M1-01: 地表昼夜着色材质 Uniforms 完整绑定', () => {
    const dummyTex = new THREE.Texture();
    const earthMat = createEarthSurfaceMaterial(dummyTex, dummyTex);

    expect(earthMat.uniforms.dayTexture.value).toBe(dummyTex);
    expect(earthMat.uniforms.nightTexture.value).toBe(dummyTex);
    expect(earthMat.uniforms.sunDirection.value).toBeInstanceOf(THREE.Vector3);
    expect(earthMat.uniforms.teachingLight.value).toBe(0.0);

    // 晨昏线着色器包含关键算法关键帧
    expect(earthMat.fragmentShader).toContain('smoothstep(-0.15, 0.20, dotNL)');
    expect(earthMat.fragmentShader).toContain('nightLights');
    expect(earthMat.fragmentShader).toContain('atmosphereRim');
  });

  it('M1-02: 独立云层材质具备透明度混合与自适应明暗算法', () => {
    const dummyTex = new THREE.Texture();
    const cloudMat = createEarthCloudMaterial(dummyTex);

    expect(cloudMat.transparent).toBe(true);
    expect(cloudMat.depthWrite).toBe(false);
    expect(cloudMat.uniforms.cloudTexture.value).toBe(dummyTex);
    expect(cloudMat.uniforms.opacity.value).toBeCloseTo(0.85, 2);
  });

  it('M1-03: 大气外缘光环 Halo 采用 AdditiveBlending 与 BackSide', () => {
    const haloMat = createAtmosphereHaloMaterial();

    expect(haloMat.transparent).toBe(true);
    expect(haloMat.depthWrite).toBe(false);
    expect(haloMat.side).toBe(THREE.BackSide);
    expect(haloMat.blending).toBe(THREE.AdditiveBlending);
  });

  it('M1-04: 移动端竖屏 (aspect < 1) 自适应增大取景距离，防止天体两端被裁切', () => {
    // 模拟横屏 (16:9, aspect = 1.77)
    const landscapeCam = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 1000);
    const landscapeCtrl = new CameraController({ camera: landscapeCam });

    // 模拟手机竖屏 (9:16, aspect = 0.56)
    const portraitCam = new THREE.PerspectiveCamera(45, 9 / 16, 0.1, 1000);
    const portraitCtrl = new CameraController({ camera: portraitCam });

    // 触发飞向地球
    landscapeCtrl.executeCommand({ type: 'flyTo', bodyId: 'earth' });
    portraitCtrl.executeCommand({ type: 'flyTo', bodyId: 'earth' });

    // 模拟完成飞行过渡 (3秒)
    const getPos = () => ({ pos: new THREE.Vector3(0, 0, 0), radius: 6.371 });
    landscapeCtrl.update(3.0, getPos);
    portraitCtrl.update(3.0, getPos);

    const landDist = landscapeCam.position.length();
    const portDist = portraitCam.position.length();

    // 竖屏下为了在狭窄的水平视场中容纳完整球体，距离必须大于等于横屏距离！
    expect(portDist).toBeGreaterThanOrEqual(landDist);
  });

  it('M1-05: 生产资产清单包含全部 5 件 M1 核心贴图', () => {
    const assets = (productionAssetsData as any).assets;
    const ids = assets.map((a: any) => a.id);

    expect(ids).toContain('earth-day-sss-2k');
    expect(ids).toContain('earth-night-sss-2k');
    expect(ids).toContain('earth-clouds-sss-2k');
    expect(ids).toContain('moon-svs-2025-2k');
    expect(ids).toContain('stars-bg-sss-2k');
  });
});
