/**
 * 批次 R5 月球落地闭环与地形高程测试 (Batch R5 Lunar Landing Tests)
 * 遵循第二轮优化审计 R5 要求：
 * 1. 验证 TerrainHeightProvider 高程连续性、北断块山/南断块山/雕刻丘/谷底中心真实剖面；
 * 2. 验证边界余弦过渡裙边 (Blend Skirt) 光顺收敛至基准球面；
 * 3. 验证 LandingController 完整状态机流转 (ORBIT -> DESCENDING -> HOLD -> RESUME -> SURFACE_LOOK -> ASCENDING -> ORBIT)；
 * 4. 验证交互打断安全与 Telemetry 遥测数据一致性；
 * 5. 验证 CameraController 在 SURFACE_LOOK 模式下的第一人称视向与极小近剪裁面。
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TerrainHeightProvider } from '../src/surface/TerrainHeightProvider';
import { LandingController } from '../src/surface/LandingController';
import { CameraController } from '../src/camera/CameraController';

describe('批次 R5 月球落地闭环测试 (Lunar Landing & Terrain DTM Tests)', () => {
  it('R5-01: 验证 TerrainHeightProvider 陶拉斯—利特罗山谷高程地貌真实标定与边界裙边缝合', () => {
    const provider = TerrainHeightProvider.getInstance();

    // 1. 谷底中心 (Apollo 17 区域, 20.35°N, 30.78°E) 基础标高为负值谷底平原
    const floorElev = provider.getHeightMeters('moon', 20.35, 30.78);
    expect(floorElev).toBeLessThan(-2000);
    expect(floorElev).toBeGreaterThan(-2600);

    // 2. 北断块山 (North Massif, 20.48°N, 30.68°E) 相比谷底显著隆起 > 1500m
    const northMassifElev = provider.getHeightMeters('moon', 20.48, 30.68);
    expect(northMassifElev).toBeGreaterThan(floorElev + 1500);

    // 3. 南断块山 (South Massif, 20.15°N, 30.60°E) 相比谷底显著隆起 > 1600m
    const southMassifElev = provider.getHeightMeters('moon', 20.15, 30.60);
    expect(southMassifElev).toBeGreaterThan(floorElev + 1600);

    // 4. 雕刻丘 (Sculptured Hills, 20.42°N, 30.95°E) 相比谷底隆起 > 800m
    const hillsElev = provider.getHeightMeters('moon', 20.42, 30.95);
    expect(hillsElev).toBeGreaterThan(floorElev + 800);

    // 5. 边界外区域 (如赤道 0°N, 0°E) 高程偏置严格为 0 (完全贴合 1737.4km 参考基准球)
    const outsideElev = provider.getHeightMeters('moon', 0, 0);
    expect(outsideElev).toBe(0);

    // 6. 边界微小内侧余弦裙边平滑性 (梯度不发散)
    const bounds = TerrainHeightProvider.TAURUS_LITTROW_BOUNDS;
    const edgeElev = provider.getHeightMeters('moon', bounds.latMin + 0.01, bounds.lonMin + 0.01);
    expect(Math.abs(edgeElev)).toBeLessThan(500); // 裙边处平缓趋近 0
  });

  it('R5-02: 验证 TerrainHeightProvider 渲染半径转换、AGL/MSL 离地读数与 3D 网格生成', () => {
    const provider = TerrainHeightProvider.getInstance();
    const moonBaseRadius = 0.36815;

    // 场景渲染半径验证
    const sceneRadius = provider.getSceneSurfaceRadius('moon', 20.35, 30.78, moonBaseRadius);
    expect(sceneRadius).toBeLessThan(moonBaseRadius); // 谷底低于基准球
    expect(sceneRadius).toBeGreaterThan(moonBaseRadius * 0.99);

    // AGL 净高度读数 (模拟相机处于谷底上方 100m 处)
    const bodyPos = new THREE.Vector3(10, 0, 0);
    const surfacePt = provider.latLonToVector3('moon', 20.35, 30.78, moonBaseRadius);
    const normal = surfacePt.clone().normalize();
    const scene100m = 100.0 * (moonBaseRadius / TerrainHeightProvider.MOON_DATUM_RADIUS_M);
    const cameraPos = bodyPos.clone().add(surfacePt).addScaledVector(normal, scene100m);

    const agl = provider.getAltitudeAGL('moon', cameraPos, bodyPos, moonBaseRadius);
    expect(agl).toBeCloseTo(100.0, 0);

    // 验证高精度 3D 浮雕网格构建
    const geo = provider.buildTaurusLittrowGeometry(moonBaseRadius);
    expect(geo.attributes.position.count).toBeGreaterThan(10000);
    expect(geo.attributes.normal.count).toBe(geo.attributes.position.count);
    expect(geo.index).not.toBeNull();
    expect(geo.index!.count).toBeGreaterThan(50000);
  });

  it('R5-03: 验证 LandingController 状态机流转与可打断语义 (ORBIT -> DESCENDING -> HOLD -> RESUME -> SURFACE_LOOK -> ASCENDING)', () => {
    const controller = new LandingController('taurus-littrow');
    expect(controller.getState()).toBe('ORBIT');

    let lastTelemetry = controller.getTelemetry();
    controller.addListener((t) => {
      lastTelemetry = t;
    });

    // 1. 启动下降序列
    controller.startDescent();
    expect(controller.getState()).toBe('DESCENDING');
    expect(lastTelemetry.state).toBe('DESCENDING');
    expect(lastTelemetry.altitudeAGLM).toBeGreaterThan(10000); // 初始处于 50km 轨道高空

    // 2. 推进帧动画 (步进 5 秒)
    controller.update(5.0);
    expect(controller.getProgress()).toBeGreaterThan(0);
    const altMid = controller.getTelemetry().altitudeAGLM;
    expect(altMid).toBeLessThan(50000);

    // 3. 用户输入触发打断 (HOLD 悬停保持)
    controller.holdDescent();
    expect(controller.getState()).toBe('HOLD');
    const holdProgress = controller.getProgress();

    // 在 HOLD 状态下调用 update，位移与进度必须完全停住，不得继续下坠！
    controller.update(5.0);
    expect(controller.getProgress()).toBe(holdProgress);
    expect(controller.getTelemetry().altitudeAGLM).toBe(altMid);

    // 4. 恢复继续下降 (RESUME)
    controller.resumeDescent();
    expect(controller.getState()).toBe('DESCENDING');
    controller.update(5.0);
    expect(controller.getProgress()).toBeGreaterThan(holdProgress);

    // 5. 触地到达 (TOUCHDOWN -> SURFACE_LOOK)
    controller.touchdown();
    expect(controller.getState()).toBe('SURFACE_LOOK');
    const surfaceTelemetry = controller.getTelemetry();
    expect(surfaceTelemetry.altitudeAGLM).toBe(1.7); // 严格维持 1.7m 人眼视高
    expect(surfaceTelemetry.state).toBe('SURFACE_LOOK');

    // 6. 升空返轨 (ASCENDING)
    controller.returnToOrbit();
    expect(controller.getState()).toBe('ASCENDING');
    controller.update(20.0); // 跑完升空耗时
    expect(controller.getState()).toBe('ORBIT');
  });

  it('R5-04: 验证 CameraController 在 SURFACE_LOOK 模式下的行为与近剪裁面', () => {
    const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 10000);
    const controller = new CameraController({ camera });

    // 1. 进入月面人眼观察模式
    controller.executeCommand({
      type: 'enterSurfaceLook',
      bodyId: 'moon',
      lat: 20.35,
      lon: 30.78,
      eyeHeightM: 1.7,
      initialYawDeg: 225.0,
      initialPitchDeg: 12.0,
    });

    const snapshot = controller.getSnapshot();
    expect(snapshot.mode).toBe('SURFACE_LOOK');
    expect(snapshot.anchor?.kind).toBe('surface');
    expect(snapshot.surfaceOrientation?.yawDeg).toBe(225.0);
    expect(snapshot.surfaceOrientation?.pitchDeg).toBe(12.0);

    // 2. 在地面模式下输入 orbit 鼠标拖拽 (水平旋转 yaw，垂直调整 pitch)
    controller.executeCommand({
      type: 'orbit',
      deltaTheta: 0.1, // 水平拖拽
      deltaPhi: -0.05, // 垂直仰视
    });

    const rotSnapshot = controller.getSnapshot();
    expect(rotSnapshot.surfaceOrientation?.yawDeg).not.toBe(225.0);
    expect(rotSnapshot.surfaceOrientation?.pitchDeg).toBeGreaterThan(12.0);

    // 3. 验证相机近剪裁面自动收紧至 1e-4 (0.1毫米级，杜绝地面穿模)
    expect(camera.near).toBeCloseTo(1e-4, 5);

    // 4. 地面直接定向仰望母星地球
    controller.executeCommand({
      type: 'lookAtSkyTarget',
      targetBodyId: 'earth',
    });
    expect(controller.getSnapshot().lookTarget?.kind).toBe('body');
  });
});
