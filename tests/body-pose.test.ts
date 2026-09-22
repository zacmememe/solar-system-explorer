import { describe, it, expect } from 'vitest';
import { BodyPoseProvider } from '../src/astronomy/BodyPoseProvider';
import { BODIES, getNavDisplayRadius } from '../src/astronomy/bodies';

describe('BodyPoseProvider 物理空间与地月几何验证', () => {
  it('POSE-01: 月球中心与月表观测地球的真实角直径数值验证 (严格收敛至 1.90°)', () => {
    // 1. 月球中心看地球
    const centerDeg = BodyPoseProvider.getMoonCenterEarthAngularDiameterDeg();
    // 2 * arcsin(6371 / 384400) * 180 / PI ≈ 1.89938°
    expect(centerDeg).toBeGreaterThan(1.88);
    expect(centerDeg).toBeLessThan(1.92);
    expect(centerDeg).toBeCloseTo(1.90, 1);

    // 2. 月球近侧地表看地球
    const surfaceDeg = BodyPoseProvider.getMoonSurfaceEarthAngularDiameterDeg();
    // 2 * arcsin(6371 / (384400 - 1737.4)) * 180 / PI ≈ 1.9080°
    expect(surfaceDeg).toBeGreaterThan(1.89);
    expect(surfaceDeg).toBeLessThan(1.93);
    expect(surfaceDeg).toBeCloseTo(1.91, 1);
  });

  it('POSE-02: 物理观察模式下地月系场景几何比例与物理角直径完全等价', () => {
    const provider = new BodyPoseProvider('PHYSICAL_OBSERVATION');
    const earthNavRadius = getNavDisplayRadius(BODIES.earth.radiusKm, BODIES.earth.type); // 1.35
    const earthPose = provider.getBodyPose('earth', 0);
    const moonPose = provider.getBodyPose('moon', 0);

    expect(earthPose.displayRadius).toBe(earthNavRadius);

    // 场景中地月相对距离
    const sceneDist = moonPose.position.length();

    // 根据场景中地球半径与地月距离反算场景角直径:
    // θ_scene = 2 * arcsin(R_earth_scene / Distance_scene)
    const sinHalf = earthPose.displayRadius / sceneDist;
    const sceneAngularDeg = (2.0 * Math.asin(sinHalf) * 180.0) / Math.PI;

    // 场景反算视直径必须与真实天文物理公式完全吻合！
    const realPhysicalDeg = BodyPoseProvider.getMoonCenterEarthAngularDiameterDeg();
    expect(sceneAngularDeg).toBeCloseTo(realPhysicalDeg, 3);
  });

  it('POSE-03: 策略过渡插值的一阶连续性与双向可逆性', () => {
    const provider = new BodyPoseProvider('NAV_SCHEMATIC');

    const navMoon = provider.getBodyPose('moon', 10);
    expect(provider.getTransitionProgress()).toBe(0.0);

    // 启动向物理观察模式平滑过渡 (耗时 2.0 秒)
    provider.setPolicy('PHYSICAL_OBSERVATION', 2.0);

    // 更新 1.0 秒 (进度达到 50%)
    provider.update(1.0);
    expect(provider.getTransitionProgress()).toBeCloseTo(0.5, 2);

    const midMoon = provider.getBodyPose('moon', 10);
    // 距离必须单调平滑增加 (导航距离 ≈ 40 -> 物理距离 ≈ 81.45)
    expect(midMoon.position.length()).toBeGreaterThan(navMoon.position.length());

    // 完成过渡
    provider.update(1.0);
    expect(provider.getTransitionProgress()).toBe(1.0);
    const physMoon = provider.getBodyPose('moon', 10);
    expect(physMoon.position.length()).toBeGreaterThan(midMoon.position.length());

    // 反向切回导航模式
    provider.setPolicy('NAV_SCHEMATIC', 1.0);
    provider.update(1.0);
    expect(provider.getTransitionProgress()).toBe(0.0);
    const backNavMoon = provider.getBodyPose('moon', 10);
    expect(backNavMoon.position.length()).toBeCloseTo(navMoon.position.length(), 4);
  });
});
