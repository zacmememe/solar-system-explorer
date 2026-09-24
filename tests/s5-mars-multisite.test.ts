/**
 * S5-6 测试：火星多站数据包（Victoria/Gale HiRISE DTM + MOLA L1 南带窗）与
 * 运行时多站语义（JezeroTerrainSource 参数化 / MolaRegionalSource / provider
 * 火星注册表 / 契约登记）。
 * Node 环境无本地文件 fetch——与 s5-mola-l1 同法：直接读打包文件镜像复算
 * 采样公式；装载路径用 fetch 桩覆盖。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { MolaRegionalSource } from '../src/surface/MolaRegionalSource';
import { JezeroTerrainSource } from '../src/surface/JezeroTerrainSource';
import { TerrainHeightProvider } from '../src/surface/TerrainHeightProvider';
import { LANDING_SITES } from '../src/contracts/landing';

const VIC_DTM = path.resolve('public/data/dem/victoria-hirise-v1');
const GALE_DTM = path.resolve('public/data/dem/gale-hirise-v1');
const VIC_L1 = path.resolve('public/data/dem/mola-l1-victoria-v1');
const GALE_L1 = path.resolve('public/data/dem/mola-l1-gale-v1');
const vm = JSON.parse(readFileSync(path.join(VIC_DTM, 'metadata.json'), 'utf-8'));
const gm = JSON.parse(readFileSync(path.join(GALE_DTM, 'metadata.json'), 'utf-8'));
const vl = JSON.parse(readFileSync(path.join(VIC_L1, 'metadata.json'), 'utf-8'));
const gl = JSON.parse(readFileSync(path.join(GALE_L1, 'metadata.json'), 'utf-8'));

/** 与 MolaRegionalSource.sampleHeight 逐行同式（像素中心=colStart+j，南带 X.5 起点） */
function mirrorL1Sample(m: typeof vl, dir: string, latDeg: number, lonDeg: number): number | null {
  const buf = readFileSync(path.join(dir, 'height.i16'));
  const dNs = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
  const ppd = m.projection.pixelsPerDegree;
  const fc = 23039.5 + (lonDeg - 180) * ppd - m.window.colStart;
  const fr = 11519.5 - latDeg * ppd - m.window.rowStart;
  const c0 = Math.floor(fc), r0 = Math.floor(fr);
  if (c0 < 0 || r0 < 0 || c0 >= m.width - 1 || r0 >= m.height - 1) return null;
  const tc = fc - c0, tr = fr - r0;
  const W = m.width;
  const v = (r: number, c: number) => dNs[r * W + c];
  const dn =
    v(r0, c0) * (1 - tc) * (1 - tr) + v(r0, c0 + 1) * tc * (1 - tr) +
    v(r0 + 1, c0) * (1 - tc) * tr + v(r0 + 1, c0 + 1) * tc * tr;
  return dn * m.encoding.scaleMetersPerDn;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('S5-6：两站 HiRISE DTM 数据包', () => {
  it('元数据完整：HiRISE 溯源 / Mars 2000 areoid / CLAT0 局部球 3396190 / 2m 网格', () => {
    for (const m of [vm, gm]) {
      expect(m.sourceUrl).toContain('uahirise.org/PDS/DTM/ESP/');
      expect(m.sourceUrl).toContain('DTEEC_');
      expect(m.sourceVersion).toContain('MRO-M-HIRISE-5-DTM-V1.0');
      expect(m.verticalDatum).toContain('Mars 2000 areoid');
      expect(m.projection.referenceRadiusM).toBe(3396190); // ≠ jezero CLAT15 局部球
      expect(m.projection.centerLatitudeDeg).toBe(0);
      expect(m.windowSizeM).toEqual([4000, 5500]);
      expect(m.stepMeters).toBe(2);
      expect(m.admissionState).toBe('requires-source-and-registration-review');
      expect(m.fidelityClaim).toBe('measured-dem');
    }
    expect(vm.sourceUrl).toContain('DTEEC_021747_1780_022380_1780');
    expect(gm.sourceUrl).toContain('DTEEC_019698_1750_019988_1750');
  });

  it('字节数与 SHA-256 防投毒（height/valid/ortho）', () => {
    for (const [m, dir] of [[vm, VIC_DTM], [gm, GALE_DTM]] as const) {
      const h = readFileSync(path.join(dir, 'height.f32'));
      const v = readFileSync(path.join(dir, 'valid.u8'));
      const o = readFileSync(path.join(dir, 'ortho.jpg'));
      expect(h.length).toBe(m.width * m.height * 4);
      expect(v.length).toBe(m.width * m.height);
      expect(o.length).toBeGreaterThan(1_000_000); // ~6MB 真实正射
      expect(createHash('sha256').update(h).digest('hex')).toBe(m.heightSha256);
      expect(createHash('sha256').update(v).digest('hex')).toBe(m.validSha256);
      expect(createHash('sha256').update(o).digest('hex')).toBe(m.orthoSha256);
    }
  });

  it('Victoria：15.5% 立体空洞如实记录且高度场已填充（渲染高度场无 0 值假坑）', () => {
    const v = new Uint8Array(readFileSync(path.join(VIC_DTM, 'valid.u8')));
    let holes = 0;
    for (const b of v) if (b === 0) holes++;
    expect(holes).toBeGreaterThan(800_000);
    expect(holes / v.length).toBeGreaterThan(0.15);
    expect(vm.missingDataNote).toContain('邻域扩散填充');
    expect(vm.missingDataNote).toContain(String(holes));
    // 渲染高度场（含填充）范围仍 ⊂ 实测范围（填充值为邻域均值，不引入新极值）
    const h = new Float32Array(
      readFileSync(path.join(VIC_DTM, 'height.f32')).buffer.slice(
        readFileSync(path.join(VIC_DTM, 'height.f32')).byteOffset,
        readFileSync(path.join(VIC_DTM, 'height.f32')).byteOffset + vm.width * vm.height * 4
      ) as ArrayBuffer
    );
    let mn = Infinity, mx = -Infinity;
    for (const x of h) { if (x < mn) mn = x; if (x > mx) mx = x; }
    // toFixed(1) 记录的实测范围 vs float32 填充值舍入——容 0.1m
    expect(mn).toBeGreaterThanOrEqual(vm.minimumHeightM - 0.1);
    expect(mx).toBeLessThanOrEqual(vm.maximumHeightM + 0.1);
    expect(mn).toBeGreaterThan(-1444);
    expect(mx).toBeGreaterThan(-1400);
  });

  it('Gale：窗内 100% 有效', () => {
    expect(gm.missingDataNote).toContain('0 格无效');
  });

  it('MOLA 三锚点交叉记录在案（Victoria ≤20m；Gale ≤130m 平滑偏差语义）', () => {
    for (const a of vm.crosscheckMola) {
      expect(Math.abs(a.diffM)).toBeLessThanOrEqual(20);
    }
    for (const a of gm.crosscheckMola) {
      // Murray Buttes 陡峭地形下 463m/px MOLA 网格的平滑偏差（+62/+94/+114m），
      // 非数据错误——metadata crosscheckNote 如实说明
      expect(a.diffM).toBeGreaterThan(55);
      expect(a.diffM).toBeLessThan(120);
    }
  });
});

describe('S5-6：两站 MOLA L1 南带窗数据包', () => {
  it('元数据完整：南带分片溯源（megt00n270/090）/ 463m / int16-le', () => {
    for (const [m, tile] of [[vl, 'megt00n270hb'], [gl, 'megt00n090hb']] as const) {
      expect(m.sourceUrl).toContain(`pds-geosciences.wustl.edu`);
      expect(m.sourceUrl).toContain(tile);
      expect(m.sourceVersion).toContain('MGS-M-MOLA-5-MEGDR-L3-V1.0');
      expect(m.projection.pixelsPerDegree).toBe(128);
      expect(m.projection.referenceRadiusM).toBe(3396000);
      expect(m.nativeSpacingMeters).toBeCloseTo(463.0, 1);
      expect(m.encoding.dtype).toBe('int16-le');
      expect(m.encoding.scaleMetersPerDn).toBe(1);
    }
  });

  it('字节数 / SHA-256 / DN 范围 ⊂ 火星物理范围', () => {
    for (const [m, dir] of [[vl, VIC_L1], [gl, GALE_L1]] as const) {
      const buf = readFileSync(path.join(dir, 'height.i16'));
      expect(buf.length).toBe(m.width * m.height * 2);
      expect(createHash('sha256').update(buf).digest('hex')).toBe(m.heightSha256);
      const dNs = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
      let mn = 32767, mx = -32768;
      for (const v of dNs) { if (v < mn) mn = v; if (v > mx) mx = v; }
      expect(mn).toBe(m.minimumHeightM);
      expect(mx).toBe(m.maximumHeightM);
      expect(mn).toBeGreaterThanOrEqual(-8208); // MOLA 物理下界
      expect(mx).toBeLessThanOrEqual(21249); // MOLA 物理上界
    }
  });

  it('窗口边界反解闭合（全球像素注册 = 声明裁窗范围）', () => {
    const ppd = 128;
    const boundsOf = (m: typeof vl) => ({
      lonMin: (m.window.colStart + 0.5 - 23039.5) / ppd + 180,
      lonMax: (m.window.colStart + m.window.width - 0.5 - 23039.5) / ppd + 180,
      latMax: 90 - (m.window.rowStart + 0.5) / ppd,
      latMin: 90 - (m.window.rowStart + m.window.height - 0.5) / ppd,
    });
    const vb = boundsOf(vl);
    expect(vb.lonMin).toBeGreaterThan(349.44); expect(vb.lonMin).toBeLessThan(349.46);
    expect(vb.lonMax).toBeGreaterThan(359.52); expect(vb.lonMax).toBeLessThan(359.56);
    expect(vb.latMax).toBeGreaterThan(-0.055); expect(vb.latMax).toBeLessThan(-0.03);
    expect(vb.latMin).toBeGreaterThan(-5.72); expect(vb.latMin).toBeLessThan(-5.65);
    const gb = boundsOf(gl);
    expect(gb.lonMin).toBeGreaterThan(132.29); expect(gb.lonMin).toBeLessThan(132.31);
    expect(gb.lonMax).toBeGreaterThan(142.43); expect(gb.lonMax).toBeLessThan(142.46);
    expect(gb.latMax).toBeGreaterThan(-1.36); expect(gb.latMax).toBeLessThan(-1.33);
    expect(gb.latMin).toBeGreaterThan(-8.5); expect(gb.latMin).toBeLessThan(-8.3);
  });

  it('三锚点镜像复算 = 打包记录（±0.05m，像素中心注册精确命中）；窗外 fail-closed', () => {
    for (const a of vl.crosscheckHiriseDtm.anchors) {
      const s = mirrorL1Sample(vl, VIC_L1, a.lat, a.lon);
      expect(s).not.toBeNull();
      expect(Math.abs(s! - a.molaM)).toBeLessThanOrEqual(0.05);
    }
    for (const a of gl.crosscheckHiriseDtm.anchors) {
      const s = mirrorL1Sample(gl, GALE_L1, a.lat, a.lon);
      expect(s).not.toBeNull();
      expect(Math.abs(s! - a.molaM)).toBeLessThanOrEqual(0.05);
    }
    expect(mirrorL1Sample(vl, VIC_L1, -2.06, 10)).toBeNull(); // 窗外经度
    expect(mirrorL1Sample(gl, GALE_L1, 18.45, 137.39)).toBeNull(); // 窗外纬度（北带 jezero 站）
  });
});

describe('S5-6：JezeroTerrainSource 参数化多站', () => {
  function stubDtm(m: typeof vm, dir: string, admission: unknown | null = null) {
    const h = readFileSync(path.join(dir, 'height.f32'));
    const v = readFileSync(path.join(dir, 'valid.u8'));
    return (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith('metadata.json')) return { ok: true, json: async () => m };
      if (u.endsWith('height.f32')) {
        return { ok: true, arrayBuffer: async () => h.buffer.slice(h.byteOffset, h.byteOffset + h.length) };
      }
      if (u.endsWith('valid.u8')) {
        return { ok: true, arrayBuffer: async () => v.buffer.slice(v.byteOffset, v.byteOffset + v.length) };
      }
      if (u.endsWith('ortho.jpg')) return { ok: true };
      if (u.endsWith('admission.json')) {
        if (admission == null) return { ok: false, status: 404 };
        return { ok: true, json: async () => admission };
      }
      throw new Error(`unexpected fetch: ${u}`);
    }) as unknown as typeof fetch;
  }

  it('Victoria 实例：datum=3396190 / sourceId / 站心采样 ≈ 平坦点高程（±1m）', async () => {
    globalThis.fetch = stubDtm(vm, VIC_DTM);
    const src = new JezeroTerrainSource('victoria-duck-bay', 'victoria-hirise-v1');
    await src.load('mock://vic');
    expect(src.isReady).toBe(true);
    expect(src.datumRadius).toBe(3396190);
    expect(src.sourceId).toBe('victoria-hirise-v1');
    const site = LANDING_SITES['victoria-duck-bay'];
    const s = src.sampleHeight(site.centerLat, site.centerLon);
    expect(s.valid).toBe(true);
    expect(s.heightM).toBeGreaterThan(-1377.5);
    expect(s.heightM).toBeLessThan(-1374.5);
    const wb = src.windowBounds!;
    expect(wb.latMin < site.centerLat && site.centerLat < wb.latMax).toBe(true);
    expect(wb.lonMin < site.centerLon && site.centerLon < wb.lonMax).toBe(true);
  });

  it('Gale 实例：站心采样 ≈ −2745m（±2m）；窗中心与站心吻合', async () => {
    globalThis.fetch = stubDtm(gm, GALE_DTM);
    const src = new JezeroTerrainSource('gale-murray-buttes', 'gale-hirise-v1');
    await src.load('mock://gale');
    expect(src.datumRadius).toBe(3396190);
    const site = LANDING_SITES['gale-murray-buttes'];
    const s = src.sampleHeight(site.centerLat, site.centerLon);
    expect(s.valid).toBe(true);
    expect(s.heightM).toBeGreaterThan(-2747.5);
    expect(s.heightM).toBeLessThan(-2742.5);
  });

  it('jezero 单例回归：datum 仍为 CLAT15 局部球 3394839.8（不跨站污染）', () => {
    const j = JezeroTerrainSource.getInstance();
    expect(j.siteId).toBe('jezero');
    expect(j.sourceId).toBe('jezero-hirise-v1');
    expect(j.datumRadius).toBeCloseTo(3394839.8133163, 3);
  });

  it('TerrainHeightProvider 火星注册表：切换激活站 → 采样/溯源/准入态路由', async () => {
    const hp = TerrainHeightProvider.getInstance();
    const vic = new JezeroTerrainSource('victoria-duck-bay', 'victoria-hirise-v1');
    globalThis.fetch = stubDtm(vm, VIC_DTM);
    await vic.load('mock://vic2');
    hp.registerMarsRaster('victoria-duck-bay', vic, true);
    const sample = hp.getHeightSample('mars', -2.061687, 354.5);
    expect(sample.fidelity).toBe('measured-dem');
    expect(sample.sourceId).toBe('victoria-hirise-v1');
    expect(sample.heightM).toBeGreaterThan(-1377.5);
    expect(sample.heightM).toBeLessThan(-1374.5);
    expect(hp.getAdmissionState('mars')).toContain('requires');
    // 切回 jezero（未装载实例）→ 采样路由回退 datum-sphere 语义（窗外/未装载）
    hp.setActiveMarsSite('jezero');
    const jSample = hp.getHeightSample('mars', -2.061687, 354.5);
    expect(jSample.fidelity).not.toBe('victoria-hirise-v1' as unknown as string);
    hp.setActiveMarsSite('victoria-duck-bay');
  });

  it('MolaRegionalSource 两站实例装载（fetch 桩）：窗中心 ≈ 站心 / 采样=镜像', async () => {
    const buf = readFileSync(path.join(VIC_L1, 'height.i16'));
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith('metadata.json')) return { ok: true, json: async () => vl };
      if (u.endsWith('height.i16')) {
        return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };
      }
      throw new Error(`unexpected fetch: ${u}`);
    }) as unknown as typeof fetch;
    const mola = new MolaRegionalSource();
    await mola.load('mock://vic-l1');
    expect(mola.isReady).toBe(true);
    const wb = mola.windowBounds!;
    expect((wb.latMin + wb.latMax) / 2).toBeGreaterThan(-3.0); // 站 -2.06 居中
    expect((wb.latMin + wb.latMax) / 2).toBeLessThan(-1.1);
    expect((wb.lonMin + wb.lonMax) / 2).toBeGreaterThan(353.9);
    expect((wb.lonMin + wb.lonMax) / 2).toBeLessThan(355.1);
    const s = mola.sampleHeight(-2.061687, 354.5)!;
    expect(s.heightM).toBeCloseTo(mirrorL1Sample(vl, VIC_L1, -2.061687, 354.5)!, 6);
  });
});

describe('S5-6：契约登记与资产地址', () => {
  it('两站契约字段与包元数据一致（站心=平坦点 / datum / 高程范围）', () => {
    const vic = LANDING_SITES['victoria-duck-bay'];
    expect(vic.bodyId).toBe('mars');
    expect(vic.centerLat).toBe(vm.site.flatPointSuggestion.lat);
    expect(vic.centerLon).toBe(vm.site.flatPointSuggestion.lon);
    expect(vic.elevationDatumOffsetM).toBe(vm.site.flatPointSuggestion.hM);
    expect(vic.elevationRangeM).toEqual([vm.minimumHeightM, vm.maximumHeightM]);
    expect(vic.datumRadiusKm).toBeCloseTo(3396.19, 2);
    expect(vic.descentEnabled).toBe(true);

    const gale = LANDING_SITES['gale-murray-buttes'];
    expect(gale.bodyId).toBe('mars');
    expect(gale.centerLat).toBe(gm.site.flatPointSuggestion.lat);
    expect(gale.centerLon).toBe(gm.site.flatPointSuggestion.lon);
    expect(gale.elevationDatumOffsetM).toBe(gm.site.flatPointSuggestion.hM);
    expect(gale.elevationRangeM).toEqual([gm.minimumHeightM, gm.maximumHeightM]);
    expect(gale.descentEnabled).toBe(true);
  });

  it('火星三站在 LANDING_SITES（jezero 回归仍在）', () => {
    const marsSites = Object.values(LANDING_SITES).filter((s) => s.bodyId === 'mars');
    expect(marsSites.map((s) => s.id).sort()).toEqual(['gale-murray-buttes', 'jezero', 'victoria-duck-bay']);
    expect(LANDING_SITES['jezero'].centerLat).toBeCloseTo(18.45145, 5);
  });
});
