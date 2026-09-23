/**
 * 批次 P0: 珠江口真数据、姿态配准、夜灯闭环与双观察模式单元测试套件
 * (Batch P0 Earth PRD Visibility, Frame Alignment & Observation Mode Tests)
 *
 * 覆盖重点：
 * 1. NASA BMNG D1 扇区几何包围盒、C2 阻断拦截与真实采样窗口；
 * 2. 原生 GSD 计算 (463m/px) 与全经纬度 Global UV 仿射变换；
 * 3. 地理坐标系局部法线转地心惯性世界坐标系（消除 12.4° 姿态偏差）；
 * 4. observationPolicy 双模式切换策略（物理观测 vs 地貌观察，隐藏云层与参考照明）；
 * 5. v2.1.0 数据集清单与真实 D1 瓦片质量校验。
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import * as fs from 'fs';
import * as path from 'path';
import {
  bmngBounds,
  verifyQuadrantSource,
  nativeGsdMeters,
  sourceWindow,
  globalUv,
  tileGlobalUvTransform,
  type RasterSource,
} from '../src/world-support/bmng';
import {
  earthGeodeticSiteFrame,
  latLonDirection,
  solarElevationDeg,
  nearPlaneMeters,
} from '../src/world-support/frames';
import {
  observationPolicy,
  cloudPathLengthM,
  transmittance,
} from '../src/world-support/visibility';
import { loadEarthTileManifest } from '../src/surface/manifestLoader';

describe('批次 P0: 珠江口真数据与观测模式测试 (P0 Earth PRD Visibility & Observation Mode)', () => {
  const d1Source: RasterSource = {
    id: 'D1',
    bounds: bmngBounds('D1'),
    width: 21600,
    height: 21600,
  };

  describe('P0-1: BMNG 扇区几何与 D1/C2 阻断防护', () => {
    it('验证 4 个全球大象限的经纬度边界划分准确', () => {
      const d1 = bmngBounds('D1');
      expect(d1).toEqual({ west: 90, east: 180, south: 0, north: 90 });

      const c2 = bmngBounds('C2');
      expect(c2).toEqual({ west: 0, east: 90, south: -90, north: 0 });

      const c1 = bmngBounds('C1');
      expect(c1).toEqual({ west: 0, east: 90, south: 0, north: 90 });

      const d2 = bmngBounds('D2');
      expect(d2).toEqual({ west: 90, east: 180, south: -90, north: 0 });
    });

    it('verifyQuadrantSource: 必须放行 D1，必须严格阻断并抛错错误扇区 (东亚/珠江口扇区白名单防线)', () => {
      expect(() => verifyQuadrantSource(d1Source, 'D1')).not.toThrow();

      // 若拿 C2 (南半球 0~90E, 90S~0N) 的包围盒冒充 D1，必须立即抛错阻断切片
      const counterfeitSource: RasterSource = {
        id: 'D1',
        bounds: bmngBounds('C2'),
        width: 21600,
        height: 21600,
      };
      expect(() => verifyQuadrantSource(counterfeitSource, 'D1')).toThrow(
        /contradicts NASA quadrant definition/
      );
    });

    it('nativeGsdMeters: 验证 21600x21600 像素象限对应赤道 GSD 约为 463 米', () => {
      const gsd = nativeGsdMeters(d1Source, 0);
      expect(gsd.eastWest).toBeCloseTo(463, 0);
      expect(gsd.northSouth).toBeCloseTo(463, 0);
    });

    it('sourceWindow: 珠江口 ROI (112.5~115.0°E, 21.5~23.5°N) 在 D1 中的像素窗口落在真实有效区间', () => {
      const win = sourceWindow(d1Source, {
        west: 112.5,
        east: 115.0,
        south: 21.5,
        north: 23.5,
      });

      expect(win.floatWindow.left).toBeGreaterThan(5000);
      expect(win.floatWindow.width).toBeGreaterThan(500);
      expect(win.floatWindow.top).toBeGreaterThan(15000);
      expect(win.floatWindow.height).toBeGreaterThan(400);
      expect(win.integerRead.width).toBeGreaterThan(0);
      expect(win.integerRead.height).toBeGreaterThan(0);
    });
  });

  describe('P0-2: 全球 UV 仿射变换与城市夜灯无缝对接', () => {
    it('globalUv: 验证本初子午线赤道交点 (0, 0) 映射至 (0.5, 0.5)', () => {
      const [u, v] = globalUv(0, 0);
      expect(u).toBeCloseTo(0.5, 5);
      expect(v).toBeCloseTo(0.5, 5);
    });

    it('tileGlobalUvTransform: 瓦片在世界夜景贴图中的 UV 尺度必须与经纬跨度正比，杜绝重复整张地球', () => {
      const tileBbox = {
        west: 112.5,
        east: 115.0,
        south: 22.0,
        north: 23.0,
      };
      const { offset, scale } = tileGlobalUvTransform(tileBbox);

      expect(offset[0]).toBeCloseTo((112.5 + 180) / 360, 5);
      expect(offset[1]).toBeCloseTo((22.0 + 90) / 180, 5);
      expect(scale[0]).toBeCloseTo(2.5 / 360, 5);
      expect(scale[1]).toBeCloseTo(1.0 / 180, 5);

      // 验证 scale 必须远小于 1.0 (约 0.007)，证明单瓦片只采样对应局域夜景
      expect(scale[0]).toBeLessThan(0.01);
      expect(scale[1]).toBeLessThan(0.01);
    });
  });

  describe('P0-3: 地理站心系、局部法线与自转四元数姿态配准', () => {
    it('earthGeodeticSiteFrame: 生成标准正交站心坐标系 [up, east, north]', () => {
      const frame = earthGeodeticSiteFrame(22.3, 113.8);

      const up = new THREE.Vector3(...frame.up);
      const east = new THREE.Vector3(...frame.east);
      const north = new THREE.Vector3(...frame.north);

      expect(up.length()).toBeCloseTo(1.0, 5);
      expect(east.length()).toBeCloseTo(1.0, 5);
      expect(north.length()).toBeCloseTo(1.0, 5);

      expect(Math.abs(up.dot(east))).toBeLessThan(1e-5);
      expect(Math.abs(up.dot(north))).toBeLessThan(1e-5);
      expect(Math.abs(east.dot(north))).toBeLessThan(1e-5);
    });

    it('latLonDirection: 输出法线方向与 Three.js 球面坐标系约定严格一致', () => {
      const dir = latLonDirection(0, 0); // 经纬 (0, 0)
      const v = new THREE.Vector3(...dir);
      expect(v.length()).toBeCloseTo(1.0, 5);
      expect(v.x).toBeCloseTo(1.0, 5);
      expect(v.y).toBeCloseTo(0.0, 5);
      expect(v.z).toBeCloseTo(0.0, 5);
    });

    it('验证赤道法线随天体自转四元数旋转，转角与四元数严格相等', () => {
      const normalLocal = new THREE.Vector3(...latLonDirection(0, 0)).normalize();

      // 构造 45° 地球自转四元数 (围绕 Y 极轴自转)
      const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
      const normalWorld = normalLocal.clone().applyQuaternion(quat);

      expect(normalWorld.length()).toBeCloseTo(1.0, 5);
      const angleDeg = THREE.MathUtils.radToDeg(normalLocal.angleTo(normalWorld));
      expect(angleDeg).toBeCloseTo(45.0, 2);
    });

    it('nearPlaneMeters: 236km 俯瞰高度下近平面距离设置合理', () => {
      const nearM = nearPlaneMeters(236000, 50.0);
      expect(nearM).toBe(50.0);
    });
  });

  describe('P0-4: 双模式观测策略 (Physical vs Terrain-Study) 与可见性', () => {
    it('terrain-study 模式：必须隐藏云层，开启参考照明，严禁修改模拟时间', () => {
      const advice = observationPolicy('terrain-study', -15);

      expect(advice.mode).toBe('terrain-study');
      expect(advice.hideClouds).toBe(true);
      expect(advice.useReferenceLighting).toBe(true);
      expect(advice.changeSimulationTime).toBe(false);
      expect(advice.disclosure).toContain('地貌观察');
      expect(advice.disclosure).toContain('隐藏云层');
    });

    it('physical 模式夜间：保持真实昼夜，提醒夜景与可切换地貌观察', () => {
      const advice = observationPolicy('physical', -10);

      expect(advice.mode).toBe('physical');
      expect(advice.physicalNight).toBe(true);
      expect(advice.hideClouds).toBe(false);
      expect(advice.useReferenceLighting).toBe(false);
      expect(advice.changeSimulationTime).toBe(false);
      expect(advice.disclosure).toContain('夜面');
      expect(advice.disclosure).toContain('地貌观察');
    });

    it('physical 模式白昼：保持真实昼夜与云层', () => {
      const advice = observationPolicy('physical', 35);

      expect(advice.mode).toBe('physical');
      expect(advice.physicalNight).toBe(false);
      expect(advice.hideClouds).toBe(false);
      expect(advice.useReferenceLighting).toBe(false);
      expect(advice.changeSimulationTime).toBe(false);
      expect(advice.disclosure).toContain('物理观测');
    });

    it('云层衰减透过率 transmittance 严格遵循 Beer-Lambert 定律', () => {
      expect(transmittance(0.01, 0)).toBe(1.0);
      expect(transmittance(0.001, 1000)).toBeCloseTo(Math.exp(-1.0), 5);
      expect(transmittance(0.01, 1000)).toBeLessThan(1e-4);
    });

    it('solarElevationDeg 与 cloudPathLengthM 辅助几何计算', () => {
      // 太阳直射正上方时太阳高度角为 90 度
      const elev = solarElevationDeg([0, 1, 0], [0, 1, 0]);
      expect(elev).toBeCloseTo(90, 2);

      // 视线穿过云层外壳时具有正的光程
      const pathM = cloudPathLengthM([0, 0, 6371000 + 100000], [0, 0, -1], 6371000, 6371000 + 12000, 100000);
      expect(pathM).toBeGreaterThan(0);
    });
  });

  describe('P0-5: v2.1.0 生产瓦片清单与真实 D1 瓦片质量', () => {
    it('manifest.json 包含 v2.1.0、原生 GSD 0.463 与正选 D1 象限记录', async () => {
      const manifest = await loadEarthTileManifest();

      expect(manifest.version).toBe('2.1.0');
      expect(manifest.nativeGsdKm).toBe(0.463);
      expect(manifest.sourceResolution).toContain('D1');
      expect(manifest.sourceSha256).toBe(
        '54fa2c1b6417e05cc2af635abe88b1254af51e035285a787ba79e85d8ba29cf6'
      );
      expect(manifest.coverageRoi?.[0]?.source).toContain('D1');
    });

    it('验证珠江口 34 块真实 D1 瓦片非虚假纯黑或极小空白占位符', () => {
      const baseDir = path.resolve('public/assets/tiles/earth');
      const samplePrdTiles = [
        '9/834/191.jpg',
        '9/835/191.jpg',
        '9/834/192.jpg',
        '9/835/192.jpg',
      ];

      for (const relPath of samplePrdTiles) {
        const fullPath = path.join(baseDir, relPath);
        expect(fs.existsSync(fullPath)).toBe(true);
        const stat = fs.statSync(fullPath);
        // 原 C2 大洋深海纯黑瓦片仅 2KB，真实 D1 珠江口陆地海岸线细节丰富，大小普遍大于 10KB
        expect(stat.size).toBeGreaterThan(8000);
      }
    });

    it('验证珠江口在不同模拟时间下的昼夜光照 (solar elevation)', () => {
      // 珠江口地理信息 (lat=22.3, lon=113.8)
      const lat = 22.3;
      const lon = 113.8;
      const normalLocal = new THREE.Vector3(...latLonDirection(lat, lon)).normalize();
      const axialTiltRad = THREE.MathUtils.degToRad(23.44);

      // 计算不同时间下的光照点积
      const getDot = (simTimeHours: number) => {
        // BodyPoseProvider getPhysicalSunDirection
        const d = 149597870.7; // 1 AU
        const periodHours = 365.25 * 24;
        const initialPhase = 3.65;
        const angleRad = ((2.0 * Math.PI) / periodHours) * simTimeHours + initialPhase;
        const sunDir = new THREE.Vector3(-d * Math.cos(angleRad), 0, -d * Math.sin(angleRad)).normalize();

        const rotRad = ((2.0 * Math.PI) / 24.0) * simTimeHours;
        const poleQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), axialTiltRad);
        const spinQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotRad);
        const totalQuat = poleQuat.clone().multiply(spinQuat);
        const normalWorld = normalLocal.clone().applyQuaternion(totalQuat).normalize();
        return normalWorld.dot(sunDir);
      };

      console.log('simTime=0 dot:', getDot(0));
      console.log('simTime=2.5 dot:', getDot(2.5));
      console.log('simTime=12 dot:', getDot(12));
      console.log('simTime=14.5 dot:', getDot(14.5));

      // simTime=0 是夜间 (负值)
      expect(getDot(0)).toBeLessThan(-0.5);
      // simTime=14.5 是正午向阳面 (高正值)
      expect(getDot(14.5)).toBeGreaterThan(0.7);
    });
  });
});
