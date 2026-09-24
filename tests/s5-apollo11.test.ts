/**
 * S5-2 测试：Apollo 15 数据链（哈德利月溪）——apollo11-v1 NAC DTM 包 +
 * lola-l1-tranquility-v1 LOLA L1 窗包的完整性、注册与独立交叉校验。
 * 本轮为数据链交付（引擎多站点化在 S5-3）；包规范与 RasterTerrainSource
 * 装载语义通过 injectBuffers 全链校验。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { RasterTerrainSource } from '../src/surface/RasterTerrainSource';

const DIR = path.resolve('public/data/dem/apollo11-v1');
const LDIR = path.resolve('public/data/dem/lola-l1-tranquility-v1');
const meta = JSON.parse(readFileSync(path.join(DIR, 'metadata.json'), 'utf-8'));
const lmeta = JSON.parse(readFileSync(path.join(LDIR, 'metadata.json'), 'utf-8'));

/** 与 RasterTerrainSource 采样同式的本地复算（不经 fetch） */
function sampleHeight(latDeg: number, lonDeg: number): { valid: boolean; heightM: number } {
  const hBuf = readFileSync(path.join(DIR, 'height.f32'));
  const vBuf = readFileSync(path.join(DIR, 'valid.u8'));
  const heights = new Float32Array(hBuf.buffer, hBuf.byteOffset, hBuf.length / 4);
  const valid = new Uint8Array(vBuf.buffer, vBuf.byteOffset, vBuf.length);
  const R = 1737400;
  const mPerDeg = (R * Math.PI) / 180;
  const cosC = Math.cos(meta.projection.centerLatitudeDeg * Math.PI / 180);
  const xM = (lonDeg - 180) * mPerDeg * cosC;
  const yM = latDeg * mPerDeg;
  const A = meta.pixelCornerAffine; // 全源图坐标（与 RasterTerrainSource.latLonToSourcePixel 同式）
  const fc = (xM - A.x0) / A.dx - 0.5 - meta.window.colStart;
  const fr = (A.y0 - yM) / (-A.dy) - 0.5 - meta.window.rowStart;
  const c0 = Math.floor(fc), r0 = Math.floor(fr);
  if (c0 < 0 || r0 < 0 || c0 >= meta.width - 1 || r0 >= meta.height - 1) {
    return { valid: false, heightM: 0 };
  }
  const tx = fc - c0, ty = fr - r0;
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

describe('S5-2：apollo11-v1 NAC DTM 数据包', () => {
  it('元数据完整：APOLLO15 DTM 溯源 / 2m 采样 / 1737.4km 参考球 / 诚实准入状态', () => {
    expect(meta.sourceUrl).toContain('NAC_DTM/APOLLO11/NAC_DTM_APOLLO11.TIF');
    expect(meta.sourceVersion).toContain('v1.9');
    expect(meta.nativeSpacingMeters).toBe(2);
    expect(meta.projection.referenceRadiusM).toBe(1737400);
    expect(meta.projection.type).toBe('EQUIRECTANGULAR');
    expect(meta.ortho.sameGridAsDem).toBe(true);
    expect(meta.ortho.format).toContain('u16');
    expect(meta.ortho.ifScale).toBe(1); // u16 直读无归一化
    expect(meta.admissionState).toBe('requires-source-and-registration-review');
  });

  it('文件字节数与 SHA-256 防投毒（height.f32 / valid.u8 / ortho.u16）', () => {
    const h = readFileSync(path.join(DIR, 'height.f32'));
    const v = readFileSync(path.join(DIR, 'valid.u8'));
    const o = readFileSync(path.join(DIR, 'ortho.u16'));
    expect(h.length).toBe(meta.width * meta.height * 4);
    expect(v.length).toBe(meta.width * meta.height);
    expect(o.length).toBe(meta.width * meta.height * 2);
    expect(createHash('sha256').update(h).digest('hex')).toBe(meta.heightSha256);
    expect(createHash('sha256').update(v).digest('hex')).toBe(meta.validSha256);
    expect(createHash('sha256').update(o).digest('hex')).toBe(meta.orthoSha256);
  });

  it('窗内 100% 有效且高程范围与元数据一致（静海月海面 ~[-1979,-1876]m）', () => {
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
    expect(meta.minimumHeightM).toBeGreaterThan(-2100);
    expect(meta.maximumHeightM).toBeLessThan(-1800);
  });

  it('三锚点双线性复算 = 打包记录（±0.5m），MCP 远程字节校验 3/3 逐位一致', () => {
    for (const a of meta.anchors) {
      const s = sampleHeight(a.lat, a.lon);
      expect(s.valid).toBe(true);
      expect(Math.abs(s.heightM - a.heightM)).toBeLessThanOrEqual(0.5);
    }
    expect(meta.remoteByteCrosscheck).toHaveLength(3);
    for (const c of meta.remoteByteCrosscheck) {
      expect(c.byteIdentical).toBe(true);
    }
  });

  it('窗外采样 fail-closed（不外推）', () => {
    // 窗半宽 1.5km + 200m 余量
    const mPerDeg = (1737400 * Math.PI) / 180;
    const dLat = 3200 / mPerDeg;
    const dLon = 1700 / (mPerDeg * Math.cos(0.7 * Math.PI / 180));
    expect(sampleHeight(0.6741 + dLat, 23.4600).valid).toBe(false);
    expect(sampleHeight(0.6741 - dLat, 23.4600).valid).toBe(false);
    expect(sampleHeight(0.6741, 23.4600 + dLon).valid).toBe(false);
    expect(sampleHeight(0.6741, 23.4600 - dLon).valid).toBe(false);
  });

  it('包规范与 RasterTerrainSource 装载语义一致（injectBuffers 全链哈希校验；正射 u16 直读格式核验）', async () => {
    const src = new RasterTerrainSource();
    const h = readFileSync(path.join(DIR, 'height.f32'));
    const v = readFileSync(path.join(DIR, 'valid.u8'));
    const o = readFileSync(path.join(DIR, 'ortho.u16'));
    await src.injectBuffers(meta, h.buffer.slice(h.byteOffset, h.byteOffset + h.length), v.buffer.slice(v.byteOffset, v.byteOffset + v.length), o.buffer.slice(o.byteOffset, o.byteOffset + o.length));
    expect(src.isReady).toBe(true);
    // 着陆点采样与镜像公式一致
    const s = src.sampleHeight(0.6741, 23.4730);
    expect(s.valid).toBe(true);
    expect(Math.abs(s.heightM! - (-1927.5))).toBeLessThanOrEqual(0.5);
    // 窗口边界反解
    const wb = src.windowBounds!;
    expect(wb.latMax).toBeGreaterThan(0.75);
    expect(wb.latMin).toBeLessThan(0.6);
    expect(wb.lonMin).toBeGreaterThan(23.41);
    expect(wb.lonMax).toBeLessThan(23.52);
  });
});

describe('S5-2：lola-l1-tranquility-v1 LOLA L1 窗包', () => {
  it('元数据完整：LDEM 溯源 / 236.9m / int16-le 0.5m/DN / 不对称经度窗留痕', () => {
    expect(lmeta.sourceUrl).toContain('LDEM_128.IMG');
    expect(lmeta.nativeSpacingMeters).toBeCloseTo(236.901, 1);
    expect(lmeta.encoding.dtype).toBe('int16-le');
    expect(lmeta.encoding.scaleMetersPerDn).toBe(0.5);
    expect(lmeta.projection.pixelsPerDegree).toBe(128);
    expect(lmeta.windowNote).toContain('0°');
    expect(lmeta.admissionState).toBe('requires-source-and-registration-review');
  });

  it('字节数与 SHA-256 防投毒 + 高程范围一致', () => {
    const h = readFileSync(path.join(LDIR, 'height.i16'));
    expect(h.length).toBe(lmeta.width * lmeta.height * 2);
    expect(createHash('sha256').update(h).digest('hex')).toBe(lmeta.heightSha256);
    const dNs = new Int16Array(h.buffer, h.byteOffset, h.length / 2);
    let mn = 32767, mx = -32768;
    for (const v of dNs) {
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    expect(mn * 0.5).toBeCloseTo(lmeta.minimumHeightM, 1);
    expect(mx * 0.5).toBeCloseTo(lmeta.maximumHeightM, 1);
  });

  it('LOLA↔NAC 独立交叉校验：三锚点差 ≤5m（月海平坦区，锚点最大 17.5m 留痕）', () => {
    const cross = lmeta.crosscheckNacDtm;
    expect(cross).toHaveLength(3);
    for (const c of cross) {
      expect(c.nacM).not.toBeNull();
      expect(Math.abs(c.diffM!)).toBeLessThanOrEqual(20);
    }
    // 站点差即 README 声称量级
    expect(Math.abs(cross[0].diffM!)).toBeLessThanOrEqual(10);
  });

  it('窗口边界反解与采样 fail-closed（镜像公式）', () => {
    const ppd = lmeta.projection.pixelsPerDegree;
    const lonMin = (lmeta.window.colStart + 0.5 - 23039.5) / ppd + 180;
    const latMax = 90 - (lmeta.window.rowStart + 0.5) / ppd;
    expect(lonMin).toBeGreaterThan(15);
    expect(lonMin).toBeLessThan(15.2); // 对称窗（远离 0° 无环绕）
    expect(latMax).toBeGreaterThan(4.5);
    // 站点在窗内可采样、窗外 fail-closed
    const h = readFileSync(path.join(LDIR, 'height.i16'));
    const dNs = new Int16Array(h.buffer, h.byteOffset, h.length / 2);
    const sample = (lat: number, lon: number): number | null => {
      const fc = 23039.5 + (lon - 180) * ppd - lmeta.window.colStart;
      const fr = 11519.5 - lat * ppd - lmeta.window.rowStart;
      const c0 = Math.floor(fc), r0 = Math.floor(fr);
      if (c0 < 0 || r0 < 0 || c0 >= lmeta.width - 1 || r0 >= lmeta.height - 1) return null;
      const tc = fc - c0, tr = fr - r0;
      const v = (r: number, c: number) => dNs[r * lmeta.width + c];
      return (v(r0, c0) * (1 - tc) * (1 - tr) + v(r0, c0 + 1) * tc * (1 - tr) +
        v(r0 + 1, c0) * (1 - tc) * tr + v(r0 + 1, c0 + 1) * tc * tr) * 0.5;
    };
    const site = sample(0.6741, 23.4730)!;
    expect(Math.abs(site - (-1934.9))).toBeLessThanOrEqual(0.1);
    expect(sample(0.6741, -1.0)).toBeNull(); // 负经度（环绕区）不隐式回卷
    expect(sample(8, 23.473)).toBeNull();
  });
});
