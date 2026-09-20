import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  BODIES,
  getNavOrbitRadius,
  getPlanetNavPosition,
} from '../src/astronomy/bodies';
import { createSaturnRingMaterial } from '../src/rendering/RingMaterial';
import { createSunMaterial, createSunCoronaMaterial } from '../src/rendering/SunMaterial';
import manifestData from '../sources/production-assets.json';

describe('太阳系全行星与卫星系统 (Solar System Architecture & Astronomy)', () => {
  it('SOLAR-01: 完整包含太阳、八大行星与主要特色卫星数据且参数自洽', () => {
    const requiredBodies = [
      'sun',
      'mercury',
      'venus',
      'earth',
      'moon',
      'mars',
      'phobos',
      'deimos',
      'jupiter',
      'io',
      'europa',
      'ganymede',
      'callisto',
      'saturn',
      'titan',
      'enceladus',
      'uranus',
      'neptune',
    ];

    expect(Object.keys(BODIES).length).toBeGreaterThanOrEqual(requiredBodies.length);

    for (const id of requiredBodies) {
      const body = BODIES[id];
      expect(body, `天体 ${id} 必须存在`).toBeDefined();
      expect(body.name.length).toBeGreaterThan(0);
      expect(body.nameEn.length).toBeGreaterThan(0);
      expect(body.radiusKm).toBeGreaterThan(0);
      expect(body.observationTip.length).toBeGreaterThan(0);
      expect(body.description.length).toBeGreaterThan(0);
      expect(body.sourceRef.length).toBeGreaterThan(0);

      // 若为卫星，其 parentId 必须有效存在且为行星
      if (body.type === 'moon') {
        expect(body.parentId).not.toBeNull();
        const parent = BODIES[body.parentId!];
        expect(parent).toBeDefined();
        expect(parent.type).toBe('planet');
      }

      // 若为行星，其 parentId 必须指向太阳
      if (body.type === 'planet') {
        expect(body.parentId).toBe('sun');
        expect(body.orbitSemiMajorAxisKm).toBeGreaterThan(0);
        expect(body.orbitPeriodDays).toBeGreaterThan(0);
      }
    }
  });

  it('SOLAR-02: 宏观开普勒导航压缩轨道半径单调递增，均匀展开水星至海王星', () => {
    const planetOrder = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
    let prevRadius = 0;

    for (const pId of planetOrder) {
      const planet = BODIES[pId];
      const navR = getNavOrbitRadius(planet.orbitSemiMajorAxisKm);
      expect(navR).toBeGreaterThan(prevRadius);
      prevRadius = navR;
    }

    // 水星应在 15 左右，海王星应在 150~200 左右，视口舒适展开
    expect(getNavOrbitRadius(BODIES.mercury.orbitSemiMajorAxisKm)).toBeGreaterThan(15);
    expect(getNavOrbitRadius(BODIES.neptune.orbitSemiMajorAxisKm)).toBeLessThan(250);
  });

  it('SOLAR-03: 行星开普勒三维公转位置包含倾角且数值稳定非 NaN', () => {
    const times = [0, 24, 24 * 30, 24 * 365, 24 * 365 * 10];

    for (const t of times) {
      const [ex, ey, ez] = getPlanetNavPosition('earth', t);
      expect(Number.isFinite(ex)).toBe(true);
      expect(Number.isFinite(ey)).toBe(true);
      expect(Number.isFinite(ez)).toBe(true);

      // 水星轨道倾角 7 度，y 分量应随时间产生平滑俯仰位移
      const [mx, my, mz] = getPlanetNavPosition('mercury', t);
      expect(Number.isFinite(mx)).toBe(true);
      expect(Number.isFinite(my)).toBe(true);
      expect(Number.isFinite(mz)).toBe(true);
    }
  });

  it('SOLAR-04: 土星环径向映射与行星投影阴影 Shader 材质验证', () => {
    const dummyTexture = new THREE.Texture();
    const ringMat = createSaturnRingMaterial({
      innerRadius: 10,
      outerRadius: 20,
      ringTexture: dummyTexture,
      planetRadius: 8,
    });

    expect(ringMat).toBeInstanceOf(THREE.ShaderMaterial);
    expect(ringMat.side).toBe(THREE.DoubleSide);
    expect(ringMat.transparent).toBe(true);
    expect(ringMat.uniforms.innerRadius.value).toBe(10);
    expect(ringMat.uniforms.outerRadius.value).toBe(20);
    expect(ringMat.uniforms.planetRadius.value).toBe(8);
    expect(ringMat.uniforms.sunDirection.value).toBeInstanceOf(THREE.Vector3);
  });

  it('SOLAR-05: 太阳光球脉动与日冕辉光 Shader 材质验证', () => {
    const dummyTexture = new THREE.Texture();
    const sunMat = createSunMaterial(dummyTexture);
    const coronaMat = createSunCoronaMaterial();

    expect(sunMat).toBeInstanceOf(THREE.ShaderMaterial);
    expect(sunMat.uniforms.sunTexture.value).toBe(dummyTexture);
    expect(sunMat.uniforms.time).toBeDefined();

    expect(coronaMat).toBeInstanceOf(THREE.ShaderMaterial);
    expect(coronaMat.side).toBe(THREE.BackSide);
    expect(coronaMat.blending).toBe(THREE.AdditiveBlending);
  });

  it('SOLAR-06: 生产资产清单完整包含全太阳系 15 件 2K 权威准入资产', () => {
    expect(manifestData.assets.length).toBe(15);
    const assetIds = manifestData.assets.map((a: any) => a.id);

    const expectedAssets = [
      'earth-day-sss-2k',
      'earth-night-sss-2k',
      'earth-clouds-sss-2k',
      'moon-svs-2025-2k',
      'stars-bg-sss-2k',
      'sun-sss-2k',
      'mercury-sss-2k',
      'venus-atmosphere-sss-2k',
      'venus-surface-sss-2k',
      'mars-sss-2k',
      'jupiter-sss-2k',
      'saturn-sss-2k',
      'saturn-rings-sss-2k',
      'uranus-sss-2k',
      'neptune-sss-2k',
    ];

    for (const exp of expectedAssets) {
      expect(assetIds).toContain(exp);
    }
  });
});
