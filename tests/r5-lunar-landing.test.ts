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
import { LANDING_SITES } from '../src/contracts/landing';
import {
  horizonDip,
  pitchForHorizonElevation,
  stepOrientationQuat,
  quatAngle,
} from '../src/world-support/descentCurve';

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

      // 站点双线性值与打包实测一致（坐标/高程由 LANDING_SITES 契约给出——
      // 2026-09-24 站点自 42° 山坡迁至谷底平坦点，契约值与 DEM 采样互证）
      const site = LANDING_SITES['taurus-littrow'];
      const siteSample = provider.getHeightSample('moon', site.centerLat, site.centerLon);
      expect(siteSample.fidelity).toBe('measured-dem');
      expect(siteSample.sourceId).toBe('NAC_DTM_APOLLO17');
      expect(siteSample.heightM).toBeCloseTo(site.elevationDatumOffsetM, 0);
      // 站点局部平坦：四向 150m 采样高差 < 20m（谷底平坦点选址依据）
      const dLat150 = (150 / 1737400) * (180 / Math.PI);
      const dLon150 = (150 / (1737400 * Math.cos((20.2 * Math.PI) / 180))) * (180 / Math.PI);
      const around = [
        provider.getHeightSample('moon', site.centerLat + dLat150, site.centerLon),
        provider.getHeightSample('moon', site.centerLat - dLat150, site.centerLon),
        provider.getHeightSample('moon', site.centerLat, site.centerLon + dLon150),
        provider.getHeightSample('moon', site.centerLat, site.centerLon - dLon150),
      ];
      for (const p of around) {
        expect(Math.abs(p.heightM - site.elevationDatumOffsetM)).toBeLessThan(20);
      }

      // 窗内数值在打包 metadata 的 min/max 范围内（P3b-C 扩窗后 [−2746.5, −646.9]）
      const inWin = provider.getHeightSample('moon', 20.36, 30.79);
      expect(inWin.valid).toBe(true);
      expect(inWin.heightM).toBeGreaterThanOrEqual(-2747);
      expect(inWin.heightM).toBeLessThanOrEqual(-646);

      // 窗外（0,0）显式 datum-sphere：高程 0 且 fidelity 如实标注，不隐式补平原
      const outside = provider.getHeightSample('moon', 0, 0);
      expect(outside.heightM).toBe(0);
      expect(outside.fidelity).toBe('datum-sphere');
      // 北断块山 (20.48, 30.68)：P3b-C 扩窗(6km→12km)后已在窗内——实测而非回退
      const northMassif = provider.getHeightSample('moon', 20.48, 30.68);
      expect(northMassif.fidelity).toBe('measured-dem');
    });

    it('R5-02: 渲染半径转换、AGL 读数与真实 DTM 网格生成', () => {
      const provider = TerrainHeightProvider.getInstance();
      const moonBaseRadius = 0.36815;

      // 谷底低于基准球（新站点谷底 −2641 m ≈ 半径的 0.152%——上界 0.999→0.998 随迁址放宽）
      const sceneRadius = provider.getSceneSurfaceRadius(
        'moon',
        LANDING_SITES['taurus-littrow'].centerLat,
        LANDING_SITES['taurus-littrow'].centerLon,
        moonBaseRadius
      );
      expect(sceneRadius).toBeLessThan(moonBaseRadius);
      expect(sceneRadius).toBeGreaterThan(moonBaseRadius * 0.998);

      // AGL 净空读数（相机在谷底上方 100m）
      const bodyPos = new THREE.Vector3(10, 0, 0);
      const surfacePt = provider.latLonToVector3(
        'moon',
        LANDING_SITES['taurus-littrow'].centerLat,
        LANDING_SITES['taurus-littrow'].centerLon,
        moonBaseRadius
      );
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

      // 1. 启动（P3b-A：startDescent 进 PREPARING，由引擎准备流水线 completePreparation
      //    以同帧捕获的完整起点开始下降——控制器不再自行 auto-begin；
      //    P3b-B：clearanceM 一律基准面（datum）口径）
      controller.startDescent();
      expect(controller.getState()).toBe('PREPARING');
      controller.completePreparation(undefined, undefined, {
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
      // 站点 MSL = 真实 DEM 高程 + 眼高（契约值驱动）
      expect(surfaceTelemetry.altitudeMSLM).toBeCloseTo(
        LANDING_SITES['taurus-littrow'].elevationDatumOffsetM + 1.7,
        0
      );

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

      // S1（Pro 260924）：高空停驻近面按 1/4 净空动态放宽——恒 0.1m 近面 +
      // far=8000 场景单位会使千米级高差落入深度量化，多层地表互抢闪面
      controller.executeCommand({
        type: 'enterSurfaceLook',
        bodyId: 'moon',
        lat: 20.2108,
        lon: 30.7997,
        eyeHeightM: 500000,
        initialYawDeg: 0,
        initialPitchDeg: 0,
      });
      controller.update(0.016, () => ({ pos: new THREE.Vector3(), quaternion: new THREE.Quaternion() }) as never);
      const metricScale2 = 2.0 / TerrainHeightProvider.MOON_DATUM_RADIUS_M;
      expect(camera.near).toBeCloseTo(500000 * 0.25 * metricScale2, 9);

      controller.executeCommand({
        type: 'lookAtSkyTarget',
        targetBodyId: 'earth',
      });
      expect(controller.getSnapshot().lookTarget?.kind).toBe('body');
    });
  });

  describe('P3b-A：入口语义、完整初态与取消（P3b-B 更新为基准高语义）', () => {
    it('P3b-B-1: 单一连续腿——首帧基准高=捕获值，全程切向速度无中段零速停顿', () => {
      const controller = new LandingController('taurus-littrow');
      controller.startDescent();
      controller.completePreparation(undefined, undefined, {
        latDeg: 20.1,
        lonDeg: 30.5,
        clearanceM: 50000,
      });
      expect(controller.getState()).toBe('DESCENDING');

      // 首帧：基准高 H 严格等于捕获值（无截断/无 SNAP）；MSL=H（datum 口径）
      const first = controller.evaluateTrajectory();
      expect(first.datumAltitudeM).toBeCloseTo(50000, 6);
      expect(first.altitudeMSLM).toBeCloseTo(50000, 6);
      // 起点在 DTM 窗口外（elev=0）→ AGL=H
      expect(first.altitudeAGLM).toBeCloseTo(50000, 6);

      // 单腿连续：全程切向速度 > 0（旧 接近段/主段 边界会各自零速停顿）
      let minTangential = Infinity;
      for (let i = 0; i < 8 && controller.getState() === 'DESCENDING'; i++) {
        controller.update(5.0);
        const t = controller.evaluateTrajectory();
        if (i < 7) minTangential = Math.min(minTangential, t.commandedTangentialSpeedMps);
      }
      expect(minTangential).toBeGreaterThan(0);

      // 时长律：T = clamp(10+11·log10((50000−siteDatum)/100), 12, 55) ≈ 39.9s
      // （新站点终点 datum = −2641.1+1.7，落差 ≈ 52.6km → 10+11×2.72 ≈ 39.9s）
    });

    it('P3b-B-1b: 切向航向——起点(20.1,30.5)→谷底站点(20.2108,30.7997) 东北偏东向，方位角 ~68°', () => {
      const controller = new LandingController('taurus-littrow');
      controller.startDescent();
      controller.completePreparation(undefined, undefined, {
        latDeg: 20.1,
        lonDeg: 30.5,
        clearanceM: 50000,
      });
      const first = controller.evaluateTrajectory();
      expect(first.tangentHeadingDeg).toBeGreaterThan(60);
      expect(first.tangentHeadingDeg).toBeLessThan(80);
      // 名义导引俯仰（FOV=45°、uTop=0.32）：50km 处 δ≈13.6° → pitch ≈ −22.1°
      expect(first.cameraPitchDeg!).toBeLessThan(-18);
      expect(first.cameraPitchDeg!).toBeGreaterThan(-28);
    });

    it('P3b-B-2: 返轨从当前位姿重规划——水平冻结于打断点，不倒放主腿', () => {
      const controller = new LandingController('taurus-littrow');
      controller.startDescent();
      controller.completePreparation(undefined, undefined, {
        latDeg: 20.1,
        lonDeg: 30.5,
        clearanceM: 50000,
      });
      // 中途打断（~10s，位置离落点尚远）
      controller.update(10.0);
      const holdTraj = controller.evaluateTrajectory();
      controller.holdDescent();
      controller.returnToOrbit();
      expect(controller.getState()).toBe('ASCENDING');
      const a0 = controller.evaluateTrajectory();
      // 起点=打断点（非站点、也非主腿起点）
      expect(a0.lat).toBeCloseTo(holdTraj.lat, 6);
      expect(a0.lon).toBeCloseTo(holdTraj.lon, 6);
      expect(a0.datumAltitudeM).toBeCloseTo(holdTraj.datumAltitudeM, 3);
      // 爬升：基准高单调升向轨道上限
      controller.update(4.0);
      const a1 = controller.evaluateTrajectory();
      expect(a1.datumAltitudeM).toBeGreaterThan(a0.datumAltitudeM);
      expect(a1.lat).toBeCloseTo(a0.lat, 9); // 水平不动
      // 爬完到 ORBIT
      controller.update(20.0);
      expect(controller.getState()).toBe('ORBIT');
    });

    it('P3b-A-3: 对跖起点拒绝启动（不再 +1.5° 规避），普通路径不受影响', () => {
      const controller = new LandingController('taurus-littrow'); // 谷底站点 (20.2108, 30.7997)
      controller.startDescent();
      const site = LANDING_SITES['taurus-littrow'];
      expect(() =>
        controller.completePreparation(undefined, undefined, {
          latDeg: -site.centerLat,
          lonDeg: site.centerLon - 180,
          clearanceM: 50000,
        })
      ).toThrow(/antipodal/);
      expect(controller.getState()).toBe('PREPARING'); // 拒绝不破坏状态机，可收回
      controller.cancelPreparation();
      expect(controller.getState()).toBe('ORBIT');
    });

    it('P3b-A-4: 无 400km 起点截断——远处起点首帧基准高=真实值（不瞬移）', () => {
      const controller = new LandingController('taurus-littrow');
      controller.startDescent();
      controller.completePreparation(undefined, undefined, {
        latDeg: 20.1,
        lonDeg: 30.5,
        clearanceM: 2600000, // ~2600km（超过旧 400km clamp）
      });
      const first = controller.evaluateTrajectory();
      expect(first.datumAltitudeM).toBeCloseTo(2600000, 0);
      expect(first.altitudeAGLM).toBeCloseTo(2600000, 0);
      // 单腿时长按落差对数伸缩并截顶 55s——8s 后仍在下降且远高于轨道上限
      controller.update(8.0);
      expect(controller.getState()).toBe('DESCENDING');
      expect(controller.evaluateTrajectory().datumAltitudeM).toBeGreaterThan(50000);
    });

    it('P3b-A-5: PREPARING 不因资源就绪自行放行（引擎流水线驱动）', async () => {
      const controller = new LandingController('taurus-littrow');
      controller.startDescent();
      expect(controller.getState()).toBe('PREPARING');
      // 即使 DTM 已注入就绪，控制器 update 不 auto-begin
      controller.update(5.0);
      expect(controller.getState()).toBe('PREPARING');
      controller.cancelPreparation();
      expect(controller.getState()).toBe('ORBIT');
    });
  });

  describe('P3b-B：地平线投影与姿态收敛纯函数', () => {
    it('horizonDip: 1.7m 眼高 δ≈0.08°，50km δ≈13.6°（球面地平线模型 √(2h/R)）', () => {
      const R = 1737400;
      expect(horizonDip(R, 1.7)).toBeCloseTo(0.0014, 3);
      expect((horizonDip(R, 50000) * 180) / Math.PI).toBeCloseTo(13.6, 1);
    });

    it('pitchForHorizonElevation: uTop=0.32、FOV=45° 终端俯仰 ≈ −8.5°（Pro §5 基准）', () => {
      const pitch = pitchForHorizonElevation(0, (45 * Math.PI) / 180, 0.32);
      expect((pitch * 180) / Math.PI).toBeCloseTo(-8.48, 1);
    });

    it('stepOrientationQuat: 角速率受限——10°/s 上限内逐步收敛到目标', () => {
      // 绕 Y 轴 90° 的目标
      const cur: [number, number, number, number] = [0, 0, 0, 1];
      const target: [number, number, number, number] = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
      const stepped = stepOrientationQuat(cur, target, 0.5, THREE.MathUtils.degToRad(10));
      // 0.5s × 10°/s = 5° ≤ 夹角 90°
      expect(quatAngle(stepped, cur)).toBeCloseTo(THREE.MathUtils.degToRad(5), 4);
      expect(quatAngle(stepped, target)).toBeCloseTo(THREE.MathUtils.degToRad(85), 4);
    });
  });
});
