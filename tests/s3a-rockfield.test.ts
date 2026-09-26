/**
 * S3a 测试：程序碎石场（示意层）的确定性与约束语义
 */
import { describe, it, expect } from 'vitest';
import { generateRockPlacements, buildRockGeometry, rockScenePosition } from '../src/surface/ProceduralRockField';

const FLAT_SAMPLER = () => ({ heightM: -2641 });

describe('S3a：程序碎石场（示意层，非实测位置）', () => {
  it('rejects diagonal slopes whose combined gradient exceeds the limit',()=>{
    const mpd=3396000*Math.PI/180,k=Math.tan(18*Math.PI/180);
    const opts={siteLat:0,siteLon:0,radiusM:100,count:30,clearZoneM:3,maxSlopeDeg:19,sizeMaxM:1,slopeWeight:0,seed:7,datumRadiusM:3396000};
    expect(generateRockPlacements({...opts,sampleHeight:(lat,lon)=>({heightM:(lat+lon)*mpd*k})})).toHaveLength(0);
    expect(generateRockPlacements({...opts,sampleHeight:(_lat,lon)=>({heightM:lon*mpd*k})}).length).toBeGreaterThan(0);
  });
  it('确定性：同种子逐位一致，不同种子不同', () => {
    const a = generateRockPlacements({
      siteLat: 20.2108, siteLon: 30.7997, radiusM: 1200, count: 60, clearZoneM: 20,
      maxSlopeDeg: 19, sizeMaxM: 2.5, slopeWeight: 0, sampleHeight: FLAT_SAMPLER, seed: 20260924,
    });
    const b = generateRockPlacements({
      siteLat: 20.2108, siteLon: 30.7997, radiusM: 1200, count: 60, clearZoneM: 20,
      maxSlopeDeg: 19, sizeMaxM: 2.5, slopeWeight: 0, sampleHeight: FLAT_SAMPLER, seed: 20260924,
    });
    expect(a).toEqual(b);
    const c = generateRockPlacements({
      siteLat: 20.2108, siteLon: 30.7997, radiusM: 1200, count: 60, clearZoneM: 20,
      maxSlopeDeg: 19, sizeMaxM: 2.5, slopeWeight: 0, sampleHeight: FLAT_SAMPLER, seed: 99,
    });
    expect(a).not.toEqual(c);
  });

  it('净空区与分布半径被遵守（平地采样器）', () => {
    const siteLat = 20.2108, siteLon = 30.7997;
    const rocks = generateRockPlacements({
      siteLat, siteLon, radiusM: 1000, count: 200, clearZoneM: 20,
      maxSlopeDeg: 19, sizeMaxM: 2.5, slopeWeight: 0, sampleHeight: FLAT_SAMPLER, seed: 7,
    });
    expect(rocks.length).toBeGreaterThan(100);
    const M_PER_DEG = 1737400 * Math.PI / 180;
    for (const r of rocks) {
      const dLat = (r.latDeg - siteLat) * M_PER_DEG;
      const dLon = (r.lonDeg - siteLon) * M_PER_DEG * Math.cos((siteLat * Math.PI) / 180);
      const d = Math.hypot(dLat, dLon);
      expect(d).toBeGreaterThan(20);
      expect(d).toBeLessThanOrEqual(1000 + 1e-6);
    }
  });

  it('坡度过滤：陡坡（差分 > 阈值）不放石', () => {
    let call = 0;
    // 前两次调用为同点与东/北差分——让差分返回大幅高差模拟陡坡
    const steep = (lat: number, lon: number) => {
      void lat; void lon;
      call++;
      return { heightM: call % 3 === 0 ? -2641 : -2600 }; // 每 3 次有 1 次差 41m/2m → >80° 坡
    };
    const rocks = generateRockPlacements({
      siteLat: 20.2108, siteLon: 30.7997, radiusM: 500, count: 100, clearZoneM: 20,
      maxSlopeDeg: 19, sizeMaxM: 2.5, slopeWeight: 0, sampleHeight: steep, seed: 3,
    });
    expect(rocks.length).toBe(0);
  });

  it('窗外采样 fail-closed：全部返回 null 时 0 块', () => {
    const rocks = generateRockPlacements({
      siteLat: 20.2108, siteLon: 30.7997, radiusM: 500, count: 50, clearZoneM: 20,
      maxSlopeDeg: 19, sizeMaxM: 2.5, slopeWeight: 0, sampleHeight: () => null, seed: 1,
    });
    expect(rocks).toHaveLength(0);
  });

  it('尺寸范围：三轴半尺度 ∈ (0, 2.5]，几何有限非退化', () => {
    const rocks = generateRockPlacements({
      siteLat: 20.2108, siteLon: 30.7997, radiusM: 800, count: 150, clearZoneM: 20,
      maxSlopeDeg: 19, sizeMaxM: 2.5, slopeWeight: 0, sampleHeight: FLAT_SAMPLER, seed: 11,
    });
    for (const r of rocks) {
      for (const s of r.scaleM) {
        expect(s).toBeGreaterThan(0);
        expect(s).toBeLessThanOrEqual(2.5 * 1.6 + 1e-9); // 三轴独立抖动上界 2.5×1.6
      }
    }
    const g = buildRockGeometry(20260924, 0);
    expect(g.attributes.position.count).toBeGreaterThan(20);
    expect((g.index ?? g.attributes.position).count).toBeGreaterThan(60);
    const pos = g.attributes.position as import('three').BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      expect(Number.isFinite(pos.getX(i))).toBe(true);
    }
  });

  it('场景坐标：谷底高度映射到基准球下（与 DTM 同一半径公式）', () => {
    const p = rockScenePosition(20.2108, 30.7997, -2641.1, 0.368);
    expect(p.length()).toBeCloseTo(0.368 * (1 - 2641.1 / 1737400), 9);
  });

  it('S3b 坡度偏好：slopeWeight=1 时碎石显著富集于陡坡侧（统计）', () => {
    const siteLat = 20.2108, siteLon = 30.7997;
    const M_PER_DEG = 1737400 * Math.PI / 180;
    const DEG_M = M_PER_DEG * Math.cos((siteLat * Math.PI) / 180);
    // 东西两半人工地形：东 15° 斜坡，西 0.5° 缓坡
    const sampler = (lat: number, lon: number) => {
      void lat;
      const k = lon >= siteLon ? Math.tan((15 * Math.PI) / 180) : Math.tan((0.5 * Math.PI) / 180);
      return { heightM: k * (lon - siteLon) * DEG_M };
    };
    const base = {
      siteLat, siteLon, radiusM: 900, count: 300, sizeMaxM: 2.5,
      clearZoneM: 20, maxSlopeDeg: 19, sampleHeight: sampler,
    };
    const flat = generateRockPlacements({ ...base, slopeWeight: 0, seed: 42 });
    const weighted = generateRockPlacements({ ...base, slopeWeight: 1, seed: 42 });
    const eastFrac = (rs: typeof flat) => rs.filter((r) => r.lonDeg >= siteLon).length / Math.max(1, rs.length);
    // 均匀权重下两侧各半；偏好权重下东坡占比显著上升（理论 ~0.73，留统计余量）
    expect(eastFrac(flat)).toBeGreaterThan(0.35);
    expect(eastFrac(flat)).toBeLessThan(0.65);
    expect(eastFrac(weighted)).toBeGreaterThan(eastFrac(flat) + 0.1);
  });
});
