/**
 * S5-1 测试：MOLA L1 数据包完整性与 MolaRegionalSource 运行时语义（火星中间层）
 * Node 环境无 fetch 本地文件——与 s4b 同法：直接读打包文件复算与
 * MolaRegionalSource.sampleHeight 相同的双线性公式做等价验证；
 * 装载路径（metadata/height/admission.json 解析）用 fetch 桩覆盖。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { MolaRegionalSource } from '../src/surface/MolaRegionalSource';
import { JezeroTerrainSource } from '../src/surface/JezeroTerrainSource';

const MDIR = path.resolve('public/data/dem/mola-l1-jezero-v1');
const JDIR = path.resolve('public/data/dem/jezero-hirise-v1');
const meta = JSON.parse(readFileSync(path.join(MDIR, 'metadata.json'), 'utf-8'));
const jmeta = JSON.parse(readFileSync(path.join(JDIR, 'metadata.json'), 'utf-8'));

/** 与 MolaRegionalSource.sampleHeight 逐行同式的本地复算（不经 fetch） */
function mirrorSample(latDeg: number, lonDeg: number): number | null {
  const buf = readFileSync(path.join(MDIR, 'height.i16'));
  const dNs = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
  const ppd = meta.projection.pixelsPerDegree;
  const fc = 23039.5 + (lonDeg - 180) * ppd - meta.window.colStart;
  const fr = 11519.5 - latDeg * ppd - meta.window.rowStart;
  const c0 = Math.floor(fc), r0 = Math.floor(fr);
  if (c0 < 0 || r0 < 0 || c0 >= meta.width - 1 || r0 >= meta.height - 1) return null;
  const tc = fc - c0, tr = fr - r0;
  const W = meta.width;
  const v = (r: number, c: number) => dNs[r * W + c];
  const dn =
    v(r0, c0) * (1 - tc) * (1 - tr) + v(r0, c0 + 1) * tc * (1 - tr) +
    v(r0 + 1, c0) * (1 - tc) * tr + v(r0 + 1, c0 + 1) * tc * tr;
  return dn * meta.encoding.scaleMetersPerDn;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('S5-1：MOLA L1 数据包', () => {
  it('元数据完整：MEGDR 溯源 / GMM3 areoid 基准 / 463m 采样 / 诚实准入状态', () => {
    expect(meta.sourceUrl).toContain('pds-geosciences.wustl.edu');
    expect(meta.sourceUrl).toContain('megt44n000hb.img');
    expect(meta.sourceVersion).toContain('MGS-M-MOLA-5-MEGDR-L3-V1.0');
    expect(meta.verticalDatum).toContain('GMM3');
    expect(meta.projection.referenceRadiusM).toBe(3396000);
    expect(meta.projection.pixelsPerDegree).toBe(128);
    expect(meta.nativeSpacingMeters).toBeCloseTo(463.0, 1);
    expect(meta.encoding.dtype).toBe('int16-le');
    expect(meta.encoding.scaleMetersPerDn).toBe(1);
    expect(meta.admissionState).toBe('requires-source-and-registration-review');
  });

  it('字节数与 SHA-256 防投毒（height.i16）', () => {
    const h = readFileSync(path.join(MDIR, 'height.i16'));
    expect(h.length).toBe(meta.width * meta.height * 2);
    expect(createHash('sha256').update(h).digest('hex')).toBe(meta.heightSha256);
  });

  it('高程范围与元数据一致（int16-le 1m/DN 复算）', () => {
    const buf = readFileSync(path.join(MDIR, 'height.i16'));
    const dNs = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
    let mn = 32767, mx = -32768;
    for (const v of dNs) {
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    expect(mn).toBe(meta.minimumHeightM);
    expect(mx).toBe(meta.maximumHeightM);
  });
});

describe('S5-1：注册与交叉校验', () => {
  it('窗口边界反解 = 打包声明范围（LBL 像素注册闭合）', () => {
    const ppd = meta.projection.pixelsPerDegree;
    const lonMin = (meta.window.colStart + 0.5 - 23039.5) / ppd + 180;
    const lonMax = (meta.window.colStart + meta.window.width - 0.5 - 23039.5) / ppd + 180;
    const latMax = 90 - (meta.window.rowStart + 0.5) / ppd;
    const latMin = 90 - (meta.window.rowStart + meta.window.height - 0.5) / ppd;
    // 裁窗 [14.9,22.0]×[72.4,82.5]（floor/ceil 后首末样本中心恰在边界半像素内）
    expect(lonMin).toBeGreaterThan(72.39);
    expect(lonMin).toBeLessThan(72.41);
    expect(lonMax).toBeGreaterThan(82.49);
    expect(lonMax).toBeLessThan(82.51);
    expect(latMin).toBeGreaterThan(14.89);
    expect(latMin).toBeLessThan(14.91);
    expect(latMax).toBeGreaterThan(21.99);
    expect(latMax).toBeLessThan(22.01);
  });

  it('三锚点 MOLA 复算 = 打包记录（公式等价 ±0.05m），且差值在 463m/px 量级内（≤30m）', () => {
    for (const a of meta.crosscheckHiriseDtm.anchors) {
      const m = mirrorSample(a.lat, a.lon);
      expect(m).not.toBeNull();
      expect(Math.abs(m! - a.molaM)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(a.diffM)).toBeLessThanOrEqual(30);
    }
  });

  it('窗内密集比对统计达标（mean ≤5m / rms ≤15m——独立交叉校验准入门槛）', () => {
    const g = meta.crosscheckHiriseDtm.windowGrid;
    expect(g.n).toBeGreaterThanOrEqual(80);
    expect(Math.abs(g.meanDiffM)).toBeLessThanOrEqual(5);
    expect(g.rmsM).toBeLessThanOrEqual(15);
  });

  it('窗外采样 fail-closed（不外推、不隐式 0）', () => {
    expect(mirrorSample(14.5, 77.4)).toBeNull();
    expect(mirrorSample(22.5, 77.4)).toBeNull();
    expect(mirrorSample(18.45, 72.0)).toBeNull();
    expect(mirrorSample(18.45, 83.0)).toBeNull();
  });
});

describe('S5-1：MolaRegionalSource 装载与采样（fetch 桩）', () => {
  it('load → isReady/windowBounds/sampleHeight 与镜像公式一致', async () => {
    const heightBuf = readFileSync(path.join(MDIR, 'height.i16'));
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith('metadata.json')) return { ok: true, json: async () => meta };
      if (u.endsWith('height.i16')) {
        return { ok: true, arrayBuffer: async () => heightBuf.buffer.slice(heightBuf.byteOffset, heightBuf.byteOffset + heightBuf.length) };
      }
      throw new Error(`unexpected fetch: ${u}`);
    }) as unknown as typeof fetch;
    const src = new MolaRegionalSource();
    await src.load('mock://mola');
    expect(src.isReady).toBe(true);
    expect(src.error).toBeNull();
    const wb = src.windowBounds!;
    const ppd = meta.projection.pixelsPerDegree;
    expect(wb.lonMin).toBeCloseTo((meta.window.colStart + 0.5 - 23039.5) / ppd + 180, 12);
    expect(wb.latMax).toBeCloseTo(90 - (meta.window.rowStart + 0.5) / ppd, 12);
    const site = src.sampleHeight(18.45145, 77.43657)!;
    expect(site.heightM).toBeCloseTo(mirrorSample(18.45145, 77.43657)!, 6);
    expect(src.sampleHeight(40, 100)).toBeNull(); // 窗外 fail-closed
  });

  it('字节不符 fail-fast（防截断/错版数据静默使用）', async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith('metadata.json')) return { ok: true, json: async () => meta };
      if (u.endsWith('height.i16')) return { ok: true, arrayBuffer: async () => new ArrayBuffer(1024) };
      throw new Error(`unexpected fetch: ${u}`);
    }) as unknown as typeof fetch;
    const src = new MolaRegionalSource();
    await expect(src.load('mock://mola-trunc')).rejects.toThrow('字节数不符');
    expect(src.isReady).toBe(false);
  });
});

describe('S5-1：Jezero 准入升级路由（admission.json）', () => {
  function stubJezero(admissionJson: unknown | null) {
    const h = new ArrayBuffer(jmeta.width * jmeta.height * 4);
    const v = new ArrayBuffer(jmeta.width * jmeta.height);
    return (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith('metadata.json')) return { ok: true, json: async () => jmeta };
      if (u.endsWith('height.f32')) return { ok: true, arrayBuffer: async () => h };
      if (u.endsWith('valid.u8')) return { ok: true, arrayBuffer: async () => v };
      if (u.endsWith('admission.json')) {
        if (admissionJson == null) return { ok: false, status: 404 };
        return { ok: true, json: async () => admissionJson };
      }
      throw new Error(`unexpected fetch: ${u}`);
    }) as unknown as typeof fetch;
  }

  it('admission.json（admitted-*）覆盖 metadata 基线状态', async () => {
    globalThis.fetch = stubJezero({ state: 'admitted-2026-09-24-mola-3point-remote-crosscheck' });
    const src = new JezeroTerrainSource();
    await src.load('mock://jezero-adm');
    expect(src.admissionState).toBe('admitted-2026-09-24-mola-3point-remote-crosscheck');
  });

  it('缺失 admission.json → 维持 requires-review（诚实基线）', async () => {
    globalThis.fetch = stubJezero(null);
    const src = new JezeroTerrainSource();
    await src.load('mock://jezero-base');
    expect(src.admissionState).toBe('requires-source-and-registration-review');
  });

  it('admission.json 非 admitted 前缀不生效（防伪造降级语义）', async () => {
    globalThis.fetch = stubJezero({ state: 'rejected-x' });
    const src = new JezeroTerrainSource();
    await src.load('mock://jezero-bad');
    expect(src.admissionState).toBe('requires-source-and-registration-review');
  });
});
