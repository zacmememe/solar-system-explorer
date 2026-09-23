/**
 * 太阳系漫游 · 局部米制渲染帧与空间变换中枢 (src/world-support/local-frame.ts)
 * 依据 260923 Pro Model 优化审计与《02-公共内核与数据规范.md》制定
 *
 * 核心功能：
 * 1. 标准大地/球心经纬高程到天体固连系米制直角坐标转换 (支持 WGS84 椭球体)；
 * 2. 固连系到惯性系公里坐标的四元数姿态叠加变换；
 * 3. CPU 双精度大数相减 (observerRelativeMeters)，彻底杜绝 GPU 浮点截断与深度抖动；
 * 4. 严谨的物理视张角 (apparentAngularDiameter) 公式，保持地表观察时母星角尺度物理一致。
 */

import type { V3 } from './frames';

const DEG = Math.PI / 180.0;

export interface EllipsoidDatum {
  /** 赤道长半轴 (米) */
  semiMajorM: number;
  /** 极半轴 (米) */
  semiMinorM: number;
  /** 名称标识 */
  name: string;
}

/** 常用基准椭球体定义 */
export const DATUM_WGS84: EllipsoidDatum = {
  semiMajorM: 6378137.0,
  semiMinorM: 6356752.314245,
  name: 'WGS84',
};

export const DATUM_MOON_SPHERE: EllipsoidDatum = {
  semiMajorM: 1737400.0,
  semiMinorM: 1737400.0,
  name: 'MOON_PA453',
};

export const DATUM_MARS_ELLIPSOID: EllipsoidDatum = {
  semiMajorM: 3396190.0,
  semiMinorM: 3376200.0,
  name: 'MARS_IAU2000',
};

/**
 * 由天体平均物理半径 (公里) 构造球体基准面（无椭球资料的天体使用）
 */
export function sphereDatumFromRadiusKm(radiusKm: number, name: string): EllipsoidDatum {
  const m = radiusKm * 1000.0;
  return { semiMajorM: m, semiMinorM: m, name };
}

/**
 * 按天体选择基准椭球体：Earth=WGS84、Moon=PA453 球、Mars=IAU2000 椭球、其余=物理半径球
 */
export function datumForBody(
  bodyId: string,
  radiusKmFallback: number
): EllipsoidDatum {
  switch (bodyId) {
    case 'earth':
      return DATUM_WGS84;
    case 'moon':
      return DATUM_MOON_SPHERE;
    case 'mars':
      return DATUM_MARS_ELLIPSOID;
    default:
      return sphereDatumFromRadiusKm(radiusKmFallback, `${bodyId.toUpperCase()}_SPHERE`);
  }
}

/**
 * 将大地经纬度与高程转换为天体固连直角坐标 (米)
 * 遵循与 frames.ts 及 SurfaceTileScheme 完全一致的基底约定：
 * +X = 0° 经度赤道交点
 * +Y = 北极
 * -Z = 90°E
 *
 * 对于球体 (semiMajor == semiMinor)，退化为标准球面公式；
 * 对于扁椭球体 (如地球 WGS84)，严格计算卯酉圈曲率半径 N(phi)。
 */
export function geodeticToBodyFixedM(
  latDeg: number,
  lonDeg: number,
  heightM: number = 0,
  datum: EllipsoidDatum = DATUM_WGS84
): V3 {
  if (![latDeg, lonDeg, heightM].every(Number.isFinite)) {
    throw new RangeError(`Invalid geodetic coordinates: lat=${latDeg}, lon=${lonDeg}, h=${heightM}`);
  }

  const phi = latDeg * DEG;
  const lambda = lonDeg * DEG;
  const a = datum.semiMajorM;
  const b = datum.semiMinorM;

  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const cosLambda = Math.cos(lambda);
  const sinLambda = Math.sin(lambda);

  if (Math.abs(a - b) < 1e-4) {
    // 正球体快速解析
    const r = a + heightM;
    return [r * cosPhi * cosLambda, r * sinPhi, -r * cosPhi * sinLambda];
  }

  // 椭球第一偏心率平方: e^2 = 1 - (b^2 / a^2)
  const e2 = 1.0 - (b * b) / (a * a);
  // 卯酉圈曲率半径 N(phi)
  const N = a / Math.sqrt(1.0 - e2 * sinPhi * sinPhi);

  const x = (N + heightM) * cosPhi * cosLambda;
  const y = (N * (1.0 - e2) + heightM) * sinPhi;
  const z = -(N + heightM) * cosPhi * sinLambda;

  return [x, y, z];
}

/**
 * 天体固连米制直角坐标逆变换为球心经纬度 (planetocentric) 与地心距
 * 适用于球体基准；扁椭球的严密迭代逆解不在此实现（P1 未使用椭球逆变换路径）
 */
export function bodyFixedToPlanetocentric(
  posM: readonly [number, number, number]
): { latDeg: number; lonDeg: number; radiusM: number } {
  const [x, y, z] = posM;
  const rXY = Math.hypot(x, z);
  const radiusM = Math.hypot(rXY, y);
  const latDeg = Math.atan2(y, rXY) / DEG;
  // 轴约定 +X=0°经、-Z=90°E：lon = atan2(-z, x)
  const lonDeg = Math.atan2(-z, x) / DEG;
  return { latDeg, lonDeg, radiusM };
}

/**
 * 四元数旋转三维向量: v' = q * v * q^-1
 * q 为四元数 [x, y, z, w]
 */
export function rotateByQuaternion(v: V3, q: readonly [number, number, number, number]): V3 {
  const [vx, vy, vz] = v;
  const [qx, qy, qz, qw] = q;

  // t = 2 * cross(q.xyz, v)
  const tx = 2.0 * (qy * vz - qz * vy);
  const ty = 2.0 * (qz * vx - qx * vz);
  const tz = 2.0 * (qx * vy - qy * vx);

  // v' = v + qw * t + cross(q.xyz, t)
  const rx = vx + qw * tx + (qy * tz - qz * ty);
  const ry = vy + qw * ty + (qz * tx - qx * tz);
  const rz = vz + qw * tz + (qx * ty - qy * tx);

  return [rx, ry, rz];
}

/**
 * 固连系米制位置转换为 ICRF/J2000 惯性系绝对公里坐标
 * 公式: P_inertial_km = P_body_center_km + q_fixed_to_inertial * (P_fixed_m / 1000)
 */
export function bodyFixedToInertialKm(
  bodyFixedM: V3,
  fixedToInertialQuat: readonly [number, number, number, number],
  bodyCenterPosKm: readonly [number, number, number]
): V3 {
  const localKm: V3 = [bodyFixedM[0] / 1000.0, bodyFixedM[1] / 1000.0, bodyFixedM[2] / 1000.0];
  const rotatedLocalKm = rotateByQuaternion(localKm, fixedToInertialQuat);

  return [
    bodyCenterPosKm[0] + rotatedLocalKm[0],
    bodyCenterPosKm[1] + rotatedLocalKm[1],
    bodyCenterPosKm[2] + rotatedLocalKm[2],
  ];
}

/**
 * CPU 双精度大数相减：计算目标点相对于观察者视点的局部米制向量
 * 公式: (P_target_km - P_observer_km) * 1000.0
 * 确保即使在几十亿公里的外太阳系，近处几米的渲染顶点也不损失精度
 */
export function observerRelativeMeters(
  targetInertialKm: readonly [number, number, number],
  observerInertialKm: readonly [number, number, number]
): V3 {
  return [
    (targetInertialKm[0] - observerInertialKm[0]) * 1000.0,
    (targetInertialKm[1] - observerInertialKm[1]) * 1000.0,
    (targetInertialKm[2] - observerInertialKm[2]) * 1000.0,
  ];
}

/**
 * 物理天体在给定距离处的视直径张角 (弧度)
 * 公式: theta = 2 * asin( clamp(R / d, -1, 1) )
 */
export function apparentAngularDiameterRad(radiusKm: number, distanceKm: number): number {
  if (radiusKm <= 0 || distanceKm <= 0) return 0;
  if (radiusKm >= distanceKm) return Math.PI;
  return 2.0 * Math.asin(Math.min(1.0, radiusKm / distanceKm));
}

/**
 * 物理天体在给定距离处的视直径张角 (度)
 */
export function apparentAngularDiameterDeg(radiusKm: number, distanceKm: number): number {
  return apparentAngularDiameterRad(radiusKm, distanceKm) / DEG;
}
