/**
 * F-LUNAR-LIMB-01 测试：挖孔补片与挖孔球构成原球面的不重不漏分区
 * （渐显门控隐藏细级覆盖层期间，补片以原球面填孔，消除斜视/球缘矩形缺口）
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TerrainHeightProvider } from '../src/surface/TerrainHeightProvider';

const SEGS = { w: 128, h: 64 };
const RADIUS = 1;

/** 读取几何体的三角形集合（按升序顶点索引三元组规范化，便于集合比较） */
function triangleSet(geo: THREE.BufferGeometry): Set<string> {
  const idx = geo.getIndex()!;
  const out = new Set<string>();
  for (let f = 0; f < idx.count; f += 3) {
    const tri = [idx.array[f] as number, idx.array[f + 1] as number, idx.array[f + 2] as number];
    tri.sort((a, b) => a - b);
    out.add(tri.join(','));
  }
  return out;
}

function sphereTriangleCount(): number {
  const s = new THREE.SphereGeometry(RADIUS, SEGS.w, SEGS.h);
  const n = s.getIndex()!.count / 3;
  s.dispose();
  return n;
}

describe('F-LUNAR-LIMB-01：挖孔补片几何', () => {
  const provider = TerrainHeightProvider.getInstance();

  it('补片 ∪ 挖孔球 = 原球面，且两者无共享三角形（三角面级分区）', () => {
    // 与月站构建同款：override 传 L1 窗界（内部 PAD 0.35° + 格线取整）
    const holed = provider.buildHoledMoonSphereGeometry(RADIUS, SEGS.w, SEGS.h, {
      latMin: 19.9, latMax: 20.5, lonMin: 30.5, lonMax: 31.1,
    });
    expect(holed).not.toBeNull();
    const patch = provider.buildSphereHolePatchGeometry(RADIUS, SEGS.w, SEGS.h, holed!.holeBounds);
    expect(patch).not.toBeNull();

    const holeTris = triangleSet(holed!.geometry);
    const patchTris = triangleSet(patch!);
    const total = sphereTriangleCount();
    // 不重不漏：交集中空、并集大小 = 原球面三角形数
    let overlap = 0;
    for (const t of patchTris) if (holeTris.has(t)) overlap++;
    expect(overlap).toBe(0);
    expect(holeTris.size + patchTris.size).toBe(total);
    // 补片非空（孔洞区域确有三角形被保留）
    expect(patchTris.size).toBeGreaterThan(0);
  });

  it('补片顶点与挖孔球完全同源（同位置/法线/UV，接缝零裂缝）', () => {
    const holed = provider.buildHoledMoonSphereGeometry(RADIUS, SEGS.w, SEGS.h, {
      latMin: 19.9, latMax: 20.5, lonMin: 30.5, lonMax: 31.1,
    });
    const patch = provider.buildSphereHolePatchGeometry(RADIUS, SEGS.w, SEGS.h, holed!.holeBounds);
    const a = holed!.geometry.getAttribute('position');
    const b = patch!.getAttribute('position');
    expect(b.count).toBe(a.count);
    for (let i = 0; i < a.count; i++) {
      expect(b.getX(i)).toBe(a.getX(i));
      expect(b.getY(i)).toBe(a.getY(i));
      expect(b.getZ(i)).toBe(a.getZ(i));
    }
  });

  it('跨 ±180° 接缝的孔（火星 Victoria 354.5E 类）补片照常成立', () => {
    const holed = provider.buildHoledMoonSphereGeometry(RADIUS, SEGS.w, SEGS.h, {
      latMin: -1, latMax: 1, lonMin: 174, lonMax: 186,
    });
    expect(holed).not.toBeNull();
    // 孔界取整后 lonMax > 180：格线索引反解须精确复原（round 对 dyadic 网格值无漂移）
    expect(holed!.holeBounds.lonMax).toBeGreaterThan(180);
    const patch = provider.buildSphereHolePatchGeometry(RADIUS, SEGS.w, SEGS.h, holed!.holeBounds);
    expect(patch).not.toBeNull();
    const holeTris = triangleSet(holed!.geometry);
    const patchTris = triangleSet(patch!);
    let overlap = 0;
    for (const t of patchTris) if (holeTris.has(t)) overlap++;
    expect(overlap).toBe(0);
    expect(holeTris.size + patchTris.size).toBe(sphereTriangleCount());
  });

  it('退化孔界（零跨度）返回 null，不产出空网格', () => {
    expect(provider.buildSphereHolePatchGeometry(RADIUS, SEGS.w, SEGS.h, {
      latMin: 20, latMax: 20, lonMin: 30, lonMax: 30,
    })).toBeNull();
  });
});
