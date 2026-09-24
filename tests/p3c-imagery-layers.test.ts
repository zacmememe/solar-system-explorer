/**
 * P3b-C 数据层测试：SSE 纯函数、区域反照率层几何/装载语义、打包 metadata 完整性
 * （Pro C 批：影像采样 ≠ DEM 格点 ≠ 几何误差；SSE 用实际 drawingBuffer/FOV）
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  focalPixelsPx,
  projectedTexelPx,
  imageryLayerGate,
} from '../src/world-support/screenSpaceMetrics';
import { RegionalAlbedoLayer, type AlbedoLayerMeta } from '../src/surface/RegionalAlbedoLayer';

const IMG_DIR = path.resolve('public/data/imagery/wac-emp-taurus-v1');
const DEM_META = JSON.parse(readFileSync(path.resolve('public/data/dem/apollo17-v1/metadata.json'), 'utf-8'));

describe('P3b-C：屏幕空间误差（SSE）纯函数', () => {
  it('focalPixelsPx：H=1440、vFOV=50° → f_px≈1543.6（Pro §6.1 示例口径）', () => {
    const fpx = focalPixelsPx(1440, (50 * Math.PI) / 180);
    expect(fpx).toBeCloseTo(1543.6, 0);
  });

  it('projectedTexelPx：100m 影像在 154.4km 达到 1 px/源像元（Pro 表格锚点）', () => {
    const fpx = focalPixelsPx(1440, (50 * Math.PI) / 180);
    expect(projectedTexelPx(100, fpx, 154400)).toBeCloseTo(1.0, 2);
  });

  it('门控：近处开、远处关、迟滞带内保持（不闪烁）', () => {
    const fpx = focalPixelsPx(1080, (45 * Math.PI) / 180); // 1440x900 @DPR1.5 等效量级
    // 近端：WAC 0.5px/源像元、父级 26px → 开
    const near = imageryLayerGate({ layerTexelM: 99.75, baseTexelM: 5331, focalPx: fpx, viewDepthM: 200000, currentlyVisible: false });
    expect(near.visible).toBe(true);
    // 远端：WAC 0.1px → 关
    const far = imageryLayerGate({ layerTexelM: 99.75, baseTexelM: 5331, focalPx: fpx, viewDepthM: 1000000, currentlyVisible: false });
    expect(far.visible).toBe(false);
    // 迟滞：0.25px（介于退出 0.22 与进入 0.30 之间）——已开保持，未开不进
    const depthMid = (99.75 * fpx) / 0.25;
    const stay = imageryLayerGate({ layerTexelM: 99.75, baseTexelM: 5331, focalPx: fpx, viewDepthM: depthMid, currentlyVisible: true });
    const enter = imageryLayerGate({ layerTexelM: 99.75, baseTexelM: 5331, focalPx: fpx, viewDepthM: depthMid, currentlyVisible: false });
    expect(stay.visible).toBe(true);
    expect(enter.visible).toBe(false);
  });

  it('非法输入拒绝（NaN/非正 FOV/非正深度）', () => {
    expect(() => focalPixelsPx(100, 0)).toThrow();
    expect(() => focalPixelsPx(NaN, 1)).toThrow();
    expect(() => projectedTexelPx(100, 100, 0)).toThrow();
  });
});

describe('P3b-C：区域反照率层', () => {
  const meta = JSON.parse(readFileSync(path.join(IMG_DIR, 'metadata.json'), 'utf-8')) as AlbedoLayerMeta;
  const hole = { latMin: 19.7, latMax: 21.0, lonMin: 29.8, lonMax: 31.2 };

  it('打包 metadata 完整性：官方产品名/单波段声明/边界含站点与 DEM 窗口/增益为正', () => {
    expect(meta.sourceProduct).toBe('WAC_EMP_643NM_E300N0450_304P');
    expect(meta.band).toContain('643nm 单波段');
    expect(meta.band).toContain('非肉眼真彩');
    expect(meta.pixelsPerDegree).toBe(304);
    expect(meta.nativeSpacingMeters).toBeCloseTo(99.748, 1);
    expect(meta.displayTransform.gain).toBeGreaterThan(0);
    // 边界包含谷底站点 (20.2108, 30.7997) 与扩窗后 DEM 窗口（lat 20.152–20.548 / lon 30.57–30.99）
    expect(meta.bounds.latMin).toBeLessThan(20.152);
    expect(meta.bounds.latMax).toBeGreaterThan(20.548);
    expect(meta.bounds.lonMin).toBeLessThan(30.57);
    expect(meta.bounds.lonMax).toBeGreaterThan(30.99);
    expect(meta.bounds.latMin).toBeLessThan(20.2108);
    expect(meta.bounds.latMax).toBeGreaterThan(20.2108);
    expect(meta.bounds.lonMin).toBeLessThan(30.7997);
    expect(meta.bounds.lonMax).toBeGreaterThan(30.7997);
    expect(meta.albedoSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('环带网格：顶点不落入孔内、外缘半径渐落回球面、UV 在 [0,1]', () => {
    const layer = new RegionalAlbedoLayer(0.687, hole);
    // 通过私有方法构建检查（load 前几何可建——纯几何与影像解耦）
    const geo = (layer as unknown as { buildAnnulusGeometry: (b: AlbedoLayerMeta['bounds']) => THREE.BufferGeometry })
      .buildAnnulusGeometry(meta.bounds);
    expect(geo.index!.count).toBeGreaterThan(20000);

    const pos = geo.getAttribute('position');
    const uv = geo.getAttribute('uv');
    const R = 0.687;
    const eps = 1e-9;
    let sawOuterEdge = false;
    let maxRadius = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const r = Math.hypot(x, y, z);
      maxRadius = Math.max(maxRadius, r);
      expect(r).toBeLessThan(R * (1 + 5e-5) + eps); // 半径微抬上界
      expect(r).toBeGreaterThan(R * 0.999); // 不低于球面（无下穿）
      // body-fixed 反解经纬：孔内禁止顶点（1e-4° 容差吸收内缘边界上的三角往返噪声；
      // 真实切角缺陷会深入孔内 0.01°+ 量级，不会被容差掩盖）
      const lat = THREE.MathUtils.radToDeg(Math.asin(y / r));
      const lon = THREE.MathUtils.radToDeg(Math.atan2(-z, x));
      const inHole =
        lat > hole.latMin + 1e-4 && lat < hole.latMax - 1e-4 &&
        lon > hole.lonMin + 1e-4 && lon < hole.lonMax - 1e-4;
      expect(inHole).toBe(false);
      // UV 域
      expect(uv.getX(i)).toBeGreaterThanOrEqual(-1e-6);
      expect(uv.getX(i)).toBeLessThanOrEqual(1 + 1e-6);
      expect(uv.getY(i)).toBeGreaterThanOrEqual(-1e-6);
      expect(uv.getY(i)).toBeLessThanOrEqual(1 + 1e-6);
      if (Math.abs(r - R) < R * 1e-7) sawOuterEdge = true; // 外缘确实落回球面
    }
    expect(sawOuterEdge).toBe(true); // 渐落存在
    expect(maxRadius).toBeGreaterThan(R * (1 + 1e-6)); // 内部确实微抬
  });

  it('装载语义：缺数据时 isReady=false 且 error 记录（父级兜底，不抛出）', async () => {
    const layer = new RegionalAlbedoLayer(0.687, hole);
    await layer.load('/data/imagery/__nonexistent__');
    expect(layer.isReady).toBe(false);
    expect(layer.error).toBeTruthy();
    expect(layer.attach(new THREE.Object3D())).toBeNull();
  });

  it('未就绪 update 为无操作（不抛出）', () => {
    const layer = new RegionalAlbedoLayer(0.687, hole);
    expect(() => layer.update(1000, 1080, Math.PI / 4, 0.016)).not.toThrow();
    expect(layer.lastGateDiagnostics).toBeNull();
  });
});

describe('P3b-C：NAC 扩窗（C-4）回归', () => {
  it('DEM 窗口已扩至 12km 且全有效（metadata 记录）', () => {
    expect(DEM_META.width).toBe(2400);
    expect(DEM_META.height).toBe(2400);
    expect(DEM_META.validSampleCount).toBe(2400 * 2400);
    expect(DEM_META.expansionNote).toContain('P3b-C');
    // 整幅有效 bbox 调查记录在场（供后续分级瓦片规划）
    expect(DEM_META.fullImageValidBboxCoarse.colMax).toBeGreaterThan(DEM_META.fullImageValidBboxCoarse.colMin);
  });
});
