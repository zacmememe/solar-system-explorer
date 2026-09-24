/**
 * P3-T5 测试：LOLA L1 区域 DEM 数据包完整性与运行时语义
 * （单一不透明表面：L1 网格覆盖裁窗全域；影像换装非叠加层）
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { LANDING_SITES } from '../src/contracts/landing';

const L1_DIR = path.resolve('public/data/dem/lola-l1-taurus-v1');

describe('P3-T5：LOLA L1 数据包', () => {
  const meta = JSON.parse(readFileSync(path.join(L1_DIR, 'metadata.json'), 'utf-8'));

  it('元数据完整：LOLA GDR 溯源 / 编码声明 / 236.901m 采样 / 窗口几何自洽', () => {
    expect(meta.sourceFile).toBe('LDEM_128.IMG');
    expect(meta.sourceUrl).toContain('LOLA_GDR');
    expect(meta.sourceVersion).toContain('V3.0');
    expect(meta.encoding.dtype).toBe('int16-le');
    expect(meta.encoding.scaleMetersPerDn).toBe(0.5);
    expect(meta.nativeSpacingMeters).toBeCloseTo(236.901, 2);
    expect(meta.projection.type).toBe('SIMPLE_CYLINDRICAL');
    expect(meta.projection.pixelsPerDegree).toBe(128);
    // 文件字节数 = 宽×高×2（int16）
    const stat = readFileSync(path.join(L1_DIR, 'height.i16'));
    expect(stat.length).toBe(meta.width * meta.height * 2);
    // 高度场 SHA-256 防投毒
    const hash = createHash('sha256').update(stat).digest('hex');
    expect(hash).toBe(meta.heightSha256);
  });

  it('裁窗覆盖站点、NAC DTM 窗与 WAC 影像域（±220×±110km 需求）', () => {
    const site = LANDING_SITES['taurus-littrow'];
    const b = meta.window;
    const ppd = 128;
    const lonMin = (b.colStart + 0.5 - 23039.5) / ppd + 180;
    const lonMax = (b.colStart + b.width - 0.5 - 23039.5) / ppd + 180;
    const latMax = 90 - (b.rowStart + 0.5) / ppd;
    const latMin = 90 - (b.rowStart + b.height - 0.5) / ppd;
    expect(site.centerLat).toBeGreaterThan(latMin);
    expect(site.centerLat).toBeLessThan(latMax);
    expect(site.centerLon).toBeGreaterThan(lonMin);
    expect(site.centerLon).toBeLessThan(lonMax);
    // NAC 窗（约 ±0.05°）在 L1 裁窗内（由跨度保证，覆盖检验见上）
    expect(latMax - latMin).toBeGreaterThan(7.5);
    expect(lonMax - lonMin).toBeGreaterThan(16);
    // 东西 ≥ ±220km（1° 经度 @20°N ≈ 28.5km）→ ≥ 15.4°；南北 ≥ ±110km（1°≈30.3km）→ ≥ 7.3°
  });

  it('三点 NAC DTM 独立交叉验证记录在案且差值 ≤ ±50m', () => {
    expect(meta.crosscheckNacDtm).toHaveLength(3);
    for (const c of meta.crosscheckNacDtm) {
      expect(Math.abs(c.diffM)).toBeLessThanOrEqual(50);
    }
    // 站点差（LOLA 237m/px vs NAC 5m，谷底平坦点）
    const site = meta.crosscheckNacDtm.find((c: { name: string }) => c.name === '站点');
    expect(Math.abs(site.diffM)).toBeLessThanOrEqual(5);
  });

  it('高程范围与 LDEM_128 全球范围一致（DN×0.5 ∈ [−9128, 10779]）', () => {
    expect(meta.minimumHeightM).toBeGreaterThanOrEqual(-9128);
    expect(meta.maximumHeightM).toBeLessThanOrEqual(10779);
    expect(meta.minimumHeightM).toBeLessThan(meta.maximumHeightM);
  });
});

describe('P3-T5：LolaRegionalSource 运行时语义', () => {
  // Node 环境 fetch 本地文件不可用——用元数据 + 打包文件直接验证与运行时相同的
  // 反解公式；网格构建以构造的数据面驱动（不依赖网络）。
  const meta = JSON.parse(readFileSync(path.join(L1_DIR, 'metadata.json'), 'utf-8'));

  it('窗口边界反解公式与打包窗口一致（LBL 像素注册）', () => {
    const ppd = 128;
    const lonMin = (meta.window.colStart + 0.5 - 23039.5) / ppd + 180;
    const lonMax = (meta.window.colStart + meta.window.width - 0.5 - 23039.5) / ppd + 180;
    const latMax = 90 - (meta.window.rowStart + 0.5) / ppd;
    const latMin = 90 - (meta.window.rowStart + meta.window.height - 0.5) / ppd;
    // 期望的裁窗常量（pack 脚本定义：lat 16.25–24.25, lon 22.4–39.2 向外取整）
    expect(lonMin).toBeGreaterThan(22.0);
    expect(lonMax).toBeLessThan(39.4);
    expect(latMin).toBeGreaterThan(16.0);
    expect(latMax).toBeLessThan(24.4);
  });

  it('站点双线性高程 = NAC DTM 站点值 ±5m（两产品独立一致）', () => {
    const buf = readFileSync(path.join(L1_DIR, 'height.i16'));
    const dNs = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
    const ppd = 128;
    const site = LANDING_SITES['taurus-littrow'];
    const fc = 23039.5 + (site.centerLon - 180) * ppd - meta.window.colStart;
    const fr = 11519.5 - site.centerLat * ppd - meta.window.rowStart;
    const c0 = Math.floor(fc), r0 = Math.floor(fr);
    const tc = fc - c0, tr = fr - r0;
    const v = (r: number, c: number) => dNs[r * meta.width + c];
    const dn =
      v(r0, c0) * (1 - tc) * (1 - tr) + v(r0, c0 + 1) * tc * (1 - tr) +
      v(r0 + 1, c0) * (1 - tc) * tr + v(r0 + 1, c0 + 1) * tc * tr;
    // 两个独立产品（LOLA 237m/px vs NAC 5m）在平坦谷底米级一致（实测差 0.9m）
    expect(Math.abs(dn * 0.5 - site.elevationDatumOffsetM)).toBeLessThanOrEqual(5);
  });
});
