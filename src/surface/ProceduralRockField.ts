/**
 * 程序碎石场（P3-S3a，Pro 260924 方案六：观测支持的宏观地形 + 有资料约束的
 * 局部重建 + 明确标识的细小程序细节）
 *
 * 诚实边界（AGENTS 约定"明确区分物理量与示意"）：本模块生成的是**示意碎石**——
 * 尺度分布参考月面碎石统计（幂律：小石多、大石少，0.15–2.5m），位置由确定性
 * 种子随机采样并贴合实测 DTM 地形（高程/坡度来自 NAC 5m DEM），**不声称任何
 * 一块石头在历史上的准确位置**。宏观地形与影像均为实测，不因本层改变。
 *
 * 确定性：固定种子的 mulberry32——同版本同参数产出逐位一致（验收可复现）。
 */
import * as THREE from 'three';

export interface RockPlacement {
  latDeg: number;
  lonDeg: number;
  heightM: number;
  /** 三轴半尺度（米）——非均匀缩放提供形态差异 */
  scaleM: [number, number, number];
  rotYRad: number;
  variant: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RockFieldOptions {
  siteLat: number;
  siteLon: number;
  /** 分布半径（米），站点周边 */
  radiusM: number;
  count: number;
  /** 触地净空区半径（米）：停驻点附近不布石 */
  clearZoneM: number;
  /** 坡度过滤：局部坡度超过该值（度）不放石（石块不会停在陡坡上） */
  maxSlopeDeg: number;
  /** 地形采样（返回 null 表示窗外，跳过） */
  sampleHeight: (latDeg: number, lonDeg: number) => { heightM: number } | null;
  seed: number;
}

/** 月面局部度→米换算（R=1737400，纬向 30325.7 m/°，经向乘 cos 纬度） */
const M_PER_DEG_LAT = 1737400 * Math.PI / 180;

export function generateRockPlacements(opts: RockFieldOptions): RockPlacement[] {
  const rng = mulberry32(opts.seed);
  const out: RockPlacement[] = [];
  let attempts = 0;
  const maxAttempts = opts.count * 12;
  while (out.length < opts.count && attempts < maxAttempts) {
    attempts++;
    // 均匀盘面采样 r=sqrt(u)·R，避开净空区
    const r = Math.sqrt(opts.clearZoneM * opts.clearZoneM + rng() * (opts.radiusM * opts.radiusM - opts.clearZoneM * opts.clearZoneM));
    const theta = rng() * Math.PI * 2;
    const dLat = (r * Math.sin(theta)) / M_PER_DEG_LAT;
    const dLon = (r * Math.cos(theta)) / (M_PER_DEG_LAT * Math.cos((opts.siteLat * Math.PI) / 180));
    const lat = opts.siteLat + dLat;
    const lon = opts.siteLon + dLon;
    const h = opts.sampleHeight(lat, lon);
    if (!h) continue; // DTM 窗外 fail-closed
    // 坡度过滤（4m 基线双向差分）
    const d2 = 2;
    const hx = opts.sampleHeight(lat, lon + d2 / (M_PER_DEG_LAT * Math.cos((opts.siteLat * Math.PI) / 180)));
    const hy = opts.sampleHeight(lat + d2 / M_PER_DEG_LAT, lon);
    if (!hx || !hy) continue;
    const slope = Math.atan(Math.max(Math.abs(hx.heightM - h.heightM), Math.abs(hy.heightM - h.heightM)) / d2);
    if ((slope * 180) / Math.PI > opts.maxSlopeDeg) continue;
    // 幂律尺寸：u^-0.9 归一到 [0.15, 2.5] m
    const u = rng();
    const s = Math.min(2.5, 0.15 * Math.pow(1 - u, -1.1));
    out.push({
      latDeg: lat,
      lonDeg: lon,
      heightM: h.heightM,
      scaleM: [s * (0.7 + rng() * 0.6), s * (0.5 + rng() * 0.5), s * (0.7 + rng() * 0.6)],
      rotYRad: rng() * Math.PI * 2,
      variant: Math.floor(rng() * 3),
    });
  }
  return out;
}

/**
 * 单变体碎石几何：icosahedron 顶点径向确定性抖动 + 竖向压扁（石块贴地形态）。
 * 引擎按变体各建一个 InstancedMesh（共享材质）。
 */
export function buildRockGeometry(seed: number, variant: number): THREE.BufferGeometry {
  const rng = mulberry32(seed + 101 * (variant + 1));
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const jitter = 0.72 + rng() * 0.56;
    pos.setXYZ(
      i,
      pos.getX(i) * jitter,
      pos.getY(i) * jitter * 0.72,
      pos.getZ(i) * jitter
    );
  }
  g.computeVertexNormals();
  return g;
}

/** 站点 body-fixed 局部坐标 → 场景坐标（与 DTM/L1 网格同一半径公式） */
export function rockScenePosition(
  latDeg: number,
  lonDeg: number,
  heightM: number,
  baseRadius: number
): THREE.Vector3 {
  const rr = baseRadius + heightM * (baseRadius / 1737400);
  const latRad = THREE.MathUtils.degToRad(latDeg);
  const lonRad = THREE.MathUtils.degToRad(lonDeg);
  const cosLat = Math.cos(latRad);
  return new THREE.Vector3(rr * cosLat * Math.cos(lonRad), rr * Math.sin(latRad), -rr * cosLat * Math.sin(lonRad));
}
