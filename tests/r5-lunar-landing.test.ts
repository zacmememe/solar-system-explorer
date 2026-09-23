/**
 * 月球落地闭环测试（R5 建立，P2 改写为真实 DTM 栅格后端语义）
 * 1. PREPARING 资源门槛：DTM 未就绪时不进入 DESCENDING，可显式收回；
 * 2. 真实 DTM 注入后：站点/窗口高程为实测值、窗外显式 datum-sphere 回退；
 * 3. LandingController 状态机流转 (ORBIT -> DESCENDING -> HOLD -> RESUME -> SURFACE_LOOK -> ASCENDING -> ORBIT)；
 * 4. HOLD 后用户视线保留（resume 只继续位移，导引朝向不再覆盖）；
 * 5. CameraController SURFACE_LOOK 第一人称视向与米制近裁剪面（P1 规范保持）。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { TerrainHeightProvider } from '../src/surface/TerrainHeightProvider';
import { RasterTerrainSource } from '../src/surface/RasterTerrainSource';
import { LandingController } from '../src/surface/LandingController';
import { CameraController } from '../src/camera/CameraController';

const DEM_DIR = path.resolve('public/data/dem/apollo17-v1');

async function injectRealDem(): Promise<void> {
  const meta = JSON.parse(readFileSync(path.join(DEM_DIR, 'metadata.json'), 'utf-8'));
  const heightBuf = readFileSync(path.join(DEM_DIR, 'height.f32')).slice().buffer;
  const validBuf = readFileSync(path.join(DEM_DIR, 'valid.u8')).slice().buffer;
  const orthoBuf = readFileSync(path.join(DEM_DIR, 'ortho.u16')).slice().buffer;
  await RasterTerrainSource.getInstance().injectBuffers(meta, heightBuf, validBuf, orthoBuf);
}

describe('月球落地闭环测试 (真实 DTM 栅格后端)', () => {
  it('R5-00: PREPARING 资源门槛——DTM 未就绪时不进入 DESCENDING，可显式收回', async () => {
    const controller = new LandingController('taurus-littrow');
    // 本测试文件此前未注入（单例惰性），先断言未就绪路径
    if (!TerrainHeightProvider.getInstance().isRasterReady) {
      controller.startDescent();
      expect(controller.getState()).toBe('PREPARING');
      controller.update(1.0);
      expect(controller.getState()).toBe('PREPARING'); // 资源未到不自动放行
      controller.cancelPreparation();
      expect(controller.getState()).toBe('ORBIT');
      expect(controller.getTelemetry().terrain.fidelity).not.toBe('measured-dem');
    }
  });

  describe('注入真实 DTM 后', () => {
    beforeAll(async () => {
      await injectRealDem();
    });

    it('R5-01: 站点/窗口高程为实测值，窗外显式 datum-sphere 回退', () => {
      const provider = TerrainHeightProvider.getInstance();

      // 站点双线性值与打包实测一致（LANDING_SITES 标定 -1690.9 m）
      const siteSample = provider.getHeightSample('moon', 20.35, 30.78);
      expect(siteSample.fidelity).toBe('measured-dem');
      expect(siteSample.sourceId).toBe('NAC_DTM_APOLLO17');
      expect(siteSample.heightM).toBeCloseTo(-1690.9, 0);

      // 窗内数值在打包 metadata 的 min/max 范围内
      const inWin = provider.getHeightSample('moon', 20.36, 30.79);
      expect(inWin.valid).toBe(true);
      expect(inWin.heightM).toBeGreaterThanOrEqual(-2713);
      expect(inWin.heightM).toBeLessThanOrEqual(-878);

      // 窗外（0,0 与远处地标）显式 datum-sphere：高程 0 且 fidelity 如实标注，不隐式补平原
      const outside = provider.getHeightSample('moon', 0, 0);
      expect(outside.heightM).toBe(0);
      expect(outside.fidelity).toBe('datum-sphere');
      // 北断块山顶在窗外——同样显式回退（不以解析山体伪装）
      const northMassif = provider.getHeightSample('moon', 20.48, 30.68);
      expect(northMassif.fidelity).toBe('datum-sphere');
    });

    it('R5-02: 渲染半径转换、AGL 读数与真实 DTM 网格生成', () => {
      const provider = TerrainHeightProvider.getInstance();
      const moonBaseRadius = 0.36815;

      // 谷底低于基准球（真实谷底 ~ -1113 m）
      const sceneRadius = provider.getSceneSurfaceRadius('moon', 20.35, 30.78, moonBaseRadius);
      expect(sceneRadius).toBeLessThan(moonBaseRadius);
      expect(sceneRadius).toBeGreaterThan(moonBaseRadius * 0.999);

      // AGL 净空读数（相机在谷底上方 100m）
      const bodyPos = new THREE.Vector3(10, 0, 0);
      const surfacePt = provider.latLonToVector3('moon', 20.35, 30.78, moonBaseRadius);
      const normal = surfacePt.clone().normalize();
      const scene100m = 100.0 * (moonBaseRadius / TerrainHeightProvider.MOON_DATUM_RADIUS_M);
      const cameraPos = bodyPos.clone().add(surfacePt).addScaledVector(normal, scene100m);
      const agl = provider.getAltitudeAGL('moon', cameraPos, bodyPos, moonBaseRadius);
      expect(agl).toBeCloseTo(100.0, 0);

      // 真实 DTM 窗口网格：未就绪返回 null 的契约由 R5-00 间接触发；就绪后非空且规模合理
      const geo = provider.buildDemWindowGeometry(moonBaseRadius, 200);
      expect(geo).not.toBeNull();
      expect(geo!.attributes.position.count).toBeGreaterThan(10000);
      expect(geo!.attributes.uv.count).toBe(geo!.attributes.position.count);
      expect(geo!.index).not.toBeNull();
      expect(geo!.index!.count).toBeGreaterThan(20000);
    });

    it('R5-03: 状态机流转与 HOLD 保视线语义', () => {
      const controller = new LandingController('taurus-littrow');
      expect(controller.getState()).toBe('ORBIT');

      let lastTelemetry = controller.getTelemetry();
      controller.addListener((t) => {
        lastTelemetry = t;
      });

      // 1. 启动（DTM 已注入 → 直接 DESCENDING）
      controller.startDescent(undefined, undefined, {
        latDeg: 20.1,
        lonDeg: 30.5,
        clearanceM: 50000,
      });
      expect(controller.getState()).toBe('DESCENDING');
      expect(lastTelemetry.altitudeAGLM).toBeGreaterThan(10000);
      // 遥测携带地形溯源与速度语义
      expect(lastTelemetry.terrain.fidelity).toBe('measured-dem');
      expect(lastTelemetry.verticalSpeedSemantics).toBe('commanded-clearance-rate');

      // 2. 推进
      controller.update(5.0);
      expect(controller.getProgress()).toBeGreaterThan(0);
      const altMid = controller.getTelemetry().altitudeAGLM;
      expect(altMid).toBeLessThan(50000);

      // 3. 用户打断：HOLD 冻结位移与进度
      controller.holdDescent();
      expect(controller.getState()).toBe('HOLD');
      const holdProgress = controller.getProgress();
      controller.update(5.0);
      expect(controller.getProgress()).toBe(holdProgress);
      expect(controller.getTelemetry().altitudeAGLM).toBe(altMid);

      // HOLD 后导引朝向为 null（引擎侧解释为保留用户视线）
      const heldTraj = controller.evaluateTrajectory();
      expect(heldTraj.cameraYawDeg).toBeNull();
      expect(heldTraj.cameraPitchDeg).toBeNull();

      // 4. 恢复：只继续位移，视线保持 null（不重设 225°/12°）
      controller.resumeDescent();
      expect(controller.getState()).toBe('DESCENDING');
      const resumedTraj = controller.evaluateTrajectory();
      expect(resumedTraj.cameraYawDeg).toBeNull();
      controller.update(5.0);
      expect(controller.getProgress()).toBeGreaterThan(holdProgress);

      // 5. 触地
      controller.touchdown();
      expect(controller.getState()).toBe('SURFACE_LOOK');
      const surfaceTelemetry = controller.getTelemetry();
      expect(surfaceTelemetry.altitudeAGLM).toBe(1.7);
      // 站点 MSL = 真实 DEM 高程 + 眼高
      expect(surfaceTelemetry.altitudeMSLM).toBeCloseTo(-1690.9 + 1.7, 0);

      // 6. 升空返轨
      controller.returnToOrbit();
      expect(controller.getState()).toBe('ASCENDING');
      controller.update(20.0);
      expect(controller.getState()).toBe('ORBIT');
    });

    it('R5-04: CameraController SURFACE_LOOK 行为与米制近裁剪面（P1 规范保持）', () => {
      const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 10000);
      const controller = new CameraController({ camera });

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

      controller.executeCommand({
        type: 'orbit',
        deltaTheta: 0.1,
        deltaPhi: -0.05,
      });

      const rotSnapshot = controller.getSnapshot();
      expect(rotSnapshot.surfaceOrientation?.yawDeg).not.toBe(225.0);
      expect(rotSnapshot.surfaceOrientation?.pitchDeg).toBeGreaterThan(12.0);

      // 0.1m 米制净空的场景等效（测试内 surfaceRadius 默认 2.0 场景单位）
      const expectedNearScene =
        CameraController.SURFACE_NEAR_METERS * (2.0 / TerrainHeightProvider.MOON_DATUM_RADIUS_M);
      expect(camera.near).toBeCloseTo(expectedNearScene, 12);
      expect(camera.near).toBeLessThan(1e-4);

      controller.executeCommand({
        type: 'lookAtSkyTarget',
        targetBodyId: 'earth',
      });
      expect(controller.getSnapshot().lookTarget?.kind).toBe('body');
    });
  });
});
