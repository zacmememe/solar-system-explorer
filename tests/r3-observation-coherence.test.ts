/**
 * 批次 R3 自动化单元测试：同一次观察（物理尺度、光照、观察目标、HUD 和书签统一）
 * 遵循 260922Pro model优化审计2 与主方案规范：
 * 1. 地月光照向量严格平行（物理空间 1 AU 尺度，夹角 < 0.15°）；
 * 2. 观察机位 lookTarget 指向解耦与 1.90° 视圆盘几何断言；
 * 3. 相机近距约束与动态近面自适应（月球物理限距由 0.6869 降至 0.378）；
 * 4. HUD 物理尺度轨迹与点统一自适应收纳（无 8415px 溢出）；
 * 5. 书签 V2 严格全字段与 Number.isFinite 校验。
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BodyPoseProvider } from '../src/astronomy/BodyPoseProvider';
import { CameraController } from '../src/camera/CameraController';
import { buildContextMap } from '../src/app/hud/model';
import { isValidBookmarkAnyVersion, PRESET_BOOKMARKS_V2 } from '../src/utils/bookmarkStorage';
import type { BookmarkItemV2 } from '../src/contracts/bookmark';
import type { HudFrame } from '../src/contracts/hud';

describe('批次 R3: 同一次观察一致性测试 (物理尺度、光照、视向、HUD、书签)', () => {
  it('R3-01: 地月物理太阳光照向量同向性验证（彻底根除 170° 巨额相位偏差）', () => {
    const provider = new BodyPoseProvider('PHYSICAL_OBSERVATION');

    // 测试多个不同模拟时间点
    const sampleTimes = [0, 12, 24, 72, 168];
    for (const t of sampleTimes) {
      const earthSunDir = provider.getPhysicalSunDirection('earth', t);
      const moonSunDir = provider.getPhysicalSunDirection('moon', t);

      // 单位向量长度应为 1
      expect(earthSunDir.length()).toBeCloseTo(1.0, 5);
      expect(moonSunDir.length()).toBeCloseTo(1.0, 5);

      // 计算地月受光方向夹角 (弧度 -> 度)
      const dot = earthSunDir.dot(moonSunDir);
      const angleRad = Math.acos(Math.max(-1, Math.min(1, dot)));
      const angleDeg = (angleRad * 180.0) / Math.PI;

      // 日地距离 1.496 亿公里，地月距离 38.4 万公里，夹角必然 <= 0.15 度
      expect(angleDeg).toBeLessThan(0.15);
      // 严格证明不存在旧版本 170.24° 的巨额反向偏差
      expect(angleDeg).not.toBeGreaterThan(10.0);
    }
  });

  it('R3-02: “月球眺望地球”视向解耦与 1.90° 视圆盘几何断言', () => {
    // 1. 获取预置书签 preset-moon-physical-earth
    const preset = PRESET_BOOKMARKS_V2.find((b) => b.id === 'preset-moon-physical-earth');
    expect(preset).toBeDefined();
    expect(preset?.presentationPolicy).toBe('PHYSICAL_OBSERVATION');
    expect(preset?.lookTarget).toEqual({ kind: 'body', bodyId: 'earth' });

    // 2. 模拟相机机位在月表近侧看向地球
    const provider = new BodyPoseProvider('PHYSICAL_OBSERVATION');
    const moonPosKm = provider.getPhysicalPositionKm('moon', 0);
    const earthPosKm = provider.getPhysicalPositionKm('earth', 0);

    // 月球中心看地球的理论角直径
    const theoreticalDiameter = BodyPoseProvider.getMoonCenterEarthAngularDiameterDeg();
    expect(theoreticalDiameter).toBeCloseTo(1.90, 1);

    // 从实际物理位置反算角直径
    const measuredDiameter = BodyPoseProvider.apparentAngularDiameter(
      BodyPoseProvider.PHYSICAL_RADII_KM.earth,
      moonPosKm,
      earthPosKm
    );
    expect(measuredDiameter).toBeCloseTo(theoreticalDiameter, 4);
    expect(measuredDiameter).toBeGreaterThan(1.89);
    expect(measuredDiameter).toBeLessThan(1.91);
  });

  it('R3-03: 相机近距与裁剪面自适应（月球物理表面半径约束下探至 ~0.378）', () => {
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 5000);
    const controller = new CameraController({ camera });

    const getBodyWorld = (id: string) => {
      if (id === 'moon') {
        return {
          pos: new THREE.Vector3(81.45, 0, 0),
          radius: 0.368,
          surfaceRadius: 0.368,
          framingRadius: 0.368,
        };
      }
      return {
        pos: new THREE.Vector3(0, 0, 0),
        radius: 1.35,
        surfaceRadius: 1.35,
        framingRadius: 1.35,
      };
    };

    // 飞行到月球
    controller.executeCommand({ type: 'flyTo', bodyId: 'moon', durationSec: 0.1 });
    controller.update(0.15, getBodyWorld);

    // 验证 minDistance 动态降至 surfaceRadius * 1.025 ≈ 0.3772
    const minD = controller.getMinDistance();
    expect(minD).toBeLessThan(0.40);
    expect(minD).toBeGreaterThan(0.35);

    // 靠近月球表面 (降至 minD)，验证 near 动态降至 < 0.05 (杜绝近地观察被近裁剪面切掉)
    controller.setSphericalDirect(minD, Math.PI / 2, 0);
    expect(camera.near).toBeLessThan(0.05);

    // 验证 lookTarget 默认与设置
    expect(controller.getLookTarget()).toEqual({ kind: 'center' });
    controller.setLookTarget({ kind: 'body', bodyId: 'earth' });
    expect(controller.getLookTarget()).toEqual({ kind: 'body', bodyId: 'earth' });
  });

  it('R3-04: HUD 轨道与点同一次观察自适应收纳（彻底杜绝 8415px 溢出）', () => {
    // 构造物理观察模式下的月球 HUD 帧 (月球在 81.45 物理距离处)
    const hudFrame: HudFrame = {
      sequence: 1,
      simTimeHours: 0,
      isPaused: false,
      timeScale: 1.0,
      camera: {
        mode: 'ORBIT_TARGET',
        anchor: { kind: 'body', bodyId: 'moon' },
        lookTarget: { kind: 'body', bodyId: 'earth' },
        targetBodyId: 'moon',
        selectedBodyId: 'moon',
        sourceBodyId: 'earth',
        transitionProgress: 1.0,
        distanceToTarget: 0.65,
        minDistance: 0.378,
        maxDistance: 100,
        commandId: 1,
        isTransitioning: false,
        spherical: { radius: 0.65, phi: 1.62, theta: -2.17 },
      },
      observerPosition: [81.45, 0, 0.65],
      bodies: [
        { id: 'earth', position: [0, 0, 0] },
        { id: 'moon', position: [81.45, 0, 0] },
      ],
    };

    // 生成 HUD 上下文小地图 (以地月系中心 earth 展开，视窗 540 x 100)
    const map = buildContextMap(hudFrame, 'earth', 540, 100);

    // 验证点数量
    expect(map.points.length).toBeGreaterThanOrEqual(1); // moon is a satellite of earth
    const moonPoint = map.points.find((p) => p.id === 'moon');
    expect(moonPoint).toBeDefined();

    // 核心断言：月球坐标必须完整位于 [10, 530] x [10, 90] 安全视窗内！
    expect(moonPoint!.at.x).toBeGreaterThanOrEqual(10);
    expect(moonPoint!.at.x).toBeLessThanOrEqual(530);
    expect(moonPoint!.at.y).toBeGreaterThanOrEqual(10);
    expect(moonPoint!.at.y).toBeLessThanOrEqual(90);

    // 核心断言：月球轨道路径存在且非空
    const moonPath = map.paths.find((p) => p.id === 'moon');
    expect(moonPath).toBeDefined();
    expect(moonPath!.d.length).toBeGreaterThan(10);

    // 核心断言：原版本在没有自适应前月球坐标会飙升到 8415px
    // 现在必须收敛在 540x100 的视窗中央
    expect(Math.abs(moonPoint!.at.x - 270)).toBeLessThan(260);
    expect(Math.abs(moonPoint!.at.y - 50)).toBeLessThan(45);
  });

  it('R3-05: 书签 V2 严格全字段与 Number.isFinite 校验（防止 NaN / Infinity）', () => {
    const validV2: BookmarkItemV2 = {
      schemaVersion: 2,
      id: 'bm-test-valid-1',
      title: '月面观测站',
      targetBodyId: 'moon',
      presentationPolicy: 'PHYSICAL_OBSERVATION',
      epochIso: '2026-09-22T00:00:00Z',
      spherical: { radius: 0.65, phi: 1.62, theta: -2.17 },
      lookTarget: { kind: 'body', bodyId: 'earth' },
      viewCameraMode: 'PLANET_OBSERVE',
      vehicleId: null,
      layers: {
        showClouds: true,
        showAtmosphere: true,
        teachingLight: false,
        showOrbits: true,
        venusRadarMode: false,
      },
      simTimeHours: 12.5,
      createdAtIso: new Date().toISOString(),
    };

    expect(isValidBookmarkAnyVersion(validV2)).toBe(true);

    // 测试 NaN 防御
    const nanBookmark = {
      ...validV2,
      spherical: { radius: NaN, phi: 1.5, theta: 0 },
    };
    expect(isValidBookmarkAnyVersion(nanBookmark)).toBe(false);

    // 测试 Infinity 防御
    const infBookmark = {
      ...validV2,
      spherical: { radius: Infinity, phi: 1.5, theta: 0 },
    };
    expect(isValidBookmarkAnyVersion(infBookmark)).toBe(false);

    // 测试非法策略防御
    const badPolicyBookmark = {
      ...validV2,
      presentationPolicy: 'INVALID_POLICY' as any,
    };
    expect(isValidBookmarkAnyVersion(badPolicyBookmark)).toBe(false);

    // 测试非法 lookTarget 防御
    const badLookTargetBookmark = {
      ...validV2,
      lookTarget: { kind: 'body', bodyId: 'invalid_planet' as any },
    };
    expect(isValidBookmarkAnyVersion(badLookTargetBookmark)).toBe(false);
  });
});
