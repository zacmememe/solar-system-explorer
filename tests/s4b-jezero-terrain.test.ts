/**
 * S4b 测试：Jezero HiRISE DTM 数据包完整性与运行时采样语义（火星第一站）
 * Node 环境无 fetch 本地文件——与 p3t5 同法：直接读打包文件复算与
 * JezeroTerrainSource.sampleHeight 相同的双线性公式做等价验证。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { LANDING_SITES, type LandingAvailability } from '../src/contracts/landing';
import { JezeroTerrainSource } from '../src/surface/JezeroTerrainSource';
import { TerrainHeightProvider } from '../src/surface/TerrainHeightProvider';
import { generateRockPlacements, rockScenePosition } from '../src/surface/ProceduralRockField';
import * as THREE from 'three';

const DIR = path.resolve('public/data/dem/jezero-hirise-v1');
const meta = JSON.parse(readFileSync(path.join(DIR, 'metadata.json'), 'utf-8'));

/** 与 JezeroTerrainSource.sampleHeight 逐行同式的本地复算（不经 fetch） */
function sampleHeight(latDeg: number, lonDeg: number): { valid: boolean; heightM: number } {
  const hBuf = readFileSync(path.join(DIR, 'height.f32'));
  const vBuf = readFileSync(path.join(DIR, 'valid.u8'));
  const heights = new Float32Array(hBuf.buffer, hBuf.byteOffset, hBuf.length / 4);
  const valid = new Uint8Array(vBuf.buffer, vBuf.byteOffset, vBuf.length);
  const mPerDeg = (JezeroTerrainSource.DATUM_RADIUS_M * Math.PI) / 180;
  const cosLat = Math.cos((meta.site.centerLat * Math.PI) / 180);
  const fx = ((lonDeg - meta.site.centerLon) * mPerDeg * cosLat + meta.windowSizeM[0] / 2) / meta.stepMeters;
  const fy = ((meta.site.centerLat - latDeg) * mPerDeg + meta.windowSizeM[1] / 2) / meta.stepMeters;
  const c0 = Math.floor(fx), r0 = Math.floor(fy);
  if (c0 < 0 || r0 < 0 || c0 >= meta.width - 1 || r0 >= meta.height - 1) {
    return { valid: false, heightM: 0 };
  }
  const tx = fx - c0, ty = fy - r0;
  const W = meta.width;
  const ok = (r: number, c: number) => valid[r * W + c] === 1;
  if (!ok(r0, c0) || !ok(r0, c0 + 1) || !ok(r0 + 1, c0) || !ok(r0 + 1, c0 + 1)) {
    return { valid: false, heightM: 0 };
  }
  const v =
    heights[r0 * W + c0] * (1 - tx) * (1 - ty) + heights[r0 * W + c0 + 1] * tx * (1 - ty) +
    heights[(r0 + 1) * W + c0] * (1 - tx) * ty + heights[(r0 + 1) * W + c0 + 1] * tx * ty;
  return { valid: true, heightM: v };
}

describe('S4b：Jezero HiRISE 数据包', () => {
  it('元数据完整：HiRISE DTM 溯源 / areoid 垂直基准 / 2m 采样 / 诚实准入状态', () => {
    expect(meta.sourceUrl).toContain('DTEEC_045994_1985_046060_1985');
    expect(meta.sourceVersion).toContain('MRO-M-HIRISE-5-DTM-V1.0');
    expect(meta.verticalDatum).toContain('Mars 2000 areoid');
    expect(meta.projection.referenceRadiusM).toBeCloseTo(JezeroTerrainSource.DATUM_RADIUS_M, 6);
    expect(meta.nativeSpacingMeters).toBeCloseTo(1.0096633268711, 9);
    expect(meta.stepMeters).toBe(2);
    expect(meta.width).toBe(2000);
    expect(meta.height).toBe(2750);
    // 准入诚实：独立跨产品校验（MOLA）未做——不得标 admitted
    expect(meta.admissionState).toBe('requires-source-and-registration-review');
  });

  it('文件字节数与 SHA-256 防投毒（height.f32 / valid.u8 / ortho.jpg）', () => {
    const h = readFileSync(path.join(DIR, 'height.f32'));
    const v = readFileSync(path.join(DIR, 'valid.u8'));
    const o = readFileSync(path.join(DIR, 'ortho.jpg'));
    expect(h.length).toBe(meta.width * meta.height * 4);
    expect(v.length).toBe(meta.width * meta.height);
    expect(createHash('sha256').update(h).digest('hex')).toBe(meta.heightSha256);
    expect(createHash('sha256').update(v).digest('hex')).toBe(meta.validSha256);
    expect(createHash('sha256').update(o).digest('hex')).toBe(meta.orthoSha256);
  });

  it('窗内 100% 有效（valid.u8 全 1）且高程范围与元数据一致', () => {
    const v = readFileSync(path.join(DIR, 'valid.u8'));
    let nonzero = 0;
    for (const b of v) if (b === 1) nonzero++;
    expect(nonzero).toBe(meta.width * meta.height);
    const hBuf = readFileSync(path.join(DIR, 'height.f32'));
    const heights = new Float32Array(hBuf.buffer, hBuf.byteOffset, hBuf.length / 4);
    let mn = Infinity, mx = -Infinity;
    for (const h of heights) {
      if (h < mn) mn = h;
      if (h > mx) mx = h;
    }
    expect(mn).toBeCloseTo(meta.minimumHeightM, 1);
    expect(mx).toBeCloseTo(meta.maximumHeightM, 1);
  });
});

describe('S4b：采样公式与契约', () => {
  it('站点双线性高程 = 契约 elevationDatumOffsetM ±0.5m（同源核验）', () => {
    const site = LANDING_SITES['jezero'];
    expect(site.bodyId).toBe('mars');
    expect(site.descentEnabled).toBe(false);
    const s = sampleHeight(site.centerLat, site.centerLon);
    expect(s.valid).toBe(true);
    expect(Math.abs(s.heightM - site.elevationDatumOffsetM)).toBeLessThanOrEqual(0.5);
  });

  it('锚点复算一致（±0.5m）——打包与采样映射同构', () => {
    // 站点与北 2km 锚点在窗内：双线性复算须与打包记录一致
    const inWindow = meta.anchors.filter((a: { name: string }) => a.name !== '站点东 2km');
    for (const a of inWindow) {
      const s = sampleHeight(a.lat, a.lon);
      expect(s.valid).toBe(true);
      expect(Math.abs(s.heightM - a.hM)).toBeLessThanOrEqual(0.5);
    }
    // 东 2km 锚点恰在窗东边界（fx=width，无 c0+1 列）：fail-closed 不外推——
    // 边界外采样返回 invalid 是设计语义，锚点值来自源 DTM 而非 pack 网格
    const east = meta.anchors.find((a: { name: string }) => a.name === '站点东 2km');
    expect(sampleHeight(east.lat, east.lon).valid).toBe(false);
  });

  it('窗外采样 invalid（fail-closed，不外推）', () => {
    const { centerLat, centerLon } = meta.site;
    const mPerDeg = (JezeroTerrainSource.DATUM_RADIUS_M * Math.PI) / 180;
    const dLat = (3100 / mPerDeg); // 窗半宽 2750m + 350m 余量
    const cosLat = Math.cos((centerLat * Math.PI) / 180);
    const dLon = (2300 / (mPerDeg * cosLat)); // 半宽 2000m + 300m
    expect(sampleHeight(centerLat + dLat, centerLon).valid).toBe(false);
    expect(sampleHeight(centerLat - dLat, centerLon).valid).toBe(false);
    expect(sampleHeight(centerLat, centerLon + dLon).valid).toBe(false);
    expect(sampleHeight(centerLat, centerLon - dLon).valid).toBe(false);
  });

  it('availability 契约容纳 S4b 新动作（类型层）', () => {
    const a: LandingAvailability = { action: 'observe', reason: 'ready' };
    const b: LandingAvailability = { action: 'exit-observe', reason: 'mission-active' };
    expect(['observe', 'exit-observe']).toContain(a.action);
    expect(['observe', 'exit-observe']).toContain(b.action);
  });
});

describe('S4b：火星基准路由（纯函数层）', () => {
  it('TerrainHeightProvider 火星 datum = HiRISE 局部球（MSL 换算分母）', () => {
    const hp = TerrainHeightProvider.getInstance();
    // 场景单位换算：dist − baseRadius 按 mars datum 折米（不依赖数据装载）
    const cam = new THREE.Vector3(2.0, 0, 0);
    const body = new THREE.Vector3(0, 0, 0);
    const baseRadius = 1.0;
    const msl = hp.getAltitudeMSL('mars', cam, body, baseRadius);
    expect(msl).toBeCloseTo(1.0 * JezeroTerrainSource.DATUM_RADIUS_M, 0);
  });

  it('rockScenePosition 尊重火星 datum（同高同基准同半径公式）', () => {
    const base = 1.0;
    const p = rockScenePosition(18.45145, 77.43657, -2561.6, base, JezeroTerrainSource.DATUM_RADIUS_M);
    const expectR = base + (-2561.6) * (base / JezeroTerrainSource.DATUM_RADIUS_M);
    expect(p.length()).toBeCloseTo(expectR, 9);
  });

  it('generateRockPlacements 火星度→米换算正确（分布半径不因基准膨胀）', () => {
    const site = LANDING_SITES['jezero'];
    const mPerDeg = (JezeroTerrainSource.DATUM_RADIUS_M * Math.PI) / 180;
    const flat = () => ({ heightM: -2560 });
    const placements = generateRockPlacements({
      siteLat: site.centerLat,
      siteLon: site.centerLon,
      radiusM: 500,
      count: 60,
      sizeMaxM: 1.0,
      clearZoneM: 10,
      maxSlopeDeg: 19,
      slopeWeight: 0,
      sampleHeight: flat,
      seed: 7,
      datumRadiusM: JezeroTerrainSource.DATUM_RADIUS_M,
    });
    expect(placements.length).toBe(60);
    for (const p of placements) {
      const dM = Math.hypot(
        (p.latDeg - site.centerLat) * mPerDeg,
        (p.lonDeg - site.centerLon) * mPerDeg * Math.cos((site.centerLat * Math.PI) / 180)
      );
      expect(dM).toBeLessThanOrEqual(510); // 500m 半径 + 采样步余量
    }
  });
});
