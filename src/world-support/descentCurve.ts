/**
 * 下降参考曲线（纯函数，无引擎依赖）
 * 移植自 Pro 交接包 reference/descent.ts，语义保持一致：
 * - 平滑 easing（smootherstep）与真实导数（导数用于 HUD 速度语义，非数值微分）；
 * - 短大圆插值：对跖路径（角距≈180°）无航点时拒绝；
 * - 这是镜头路径，不是动力学仿真：clearance 变化率 ≠ 惯性速度 ≠ MSL 变化率，
 *   三者在有地形起伏时不同，HUD 必须明确使用哪一个（本模块返回 commanded 口径）。
 */

export interface GeoClearancePose {
  latDeg: number;
  lonDeg: number;
  /** P3b-B：相对基准球的净空 H（datum 口径，可为负——低于基准面的着陆点合法） */
  clearanceM: number;
}

export interface DescentLeg {
  from: GeoClearancePose;
  to: GeoClearancePose;
  durationSec: number;
  radiusM: number; // 天体基准球半径（米），用于切向速度换算
}

export interface DescentSample {
  latDeg: number;
  lonDeg: number;
  clearanceM: number;
  progress: number; // 0..1
  commandedClearanceRateMps: number; // d(clearance)/dt（米/秒，下降为负）
  commandedTangentialSpeedMps: number; // 切向速度（米/秒，恒为正）
}

export function smootherstep(t: number): number {
  if (!Number.isFinite(t)) throw new RangeError('Invalid progress');
  const c = Math.max(0, Math.min(1, t));
  return c * c * c * (c * (6 * c - 15) + 10);
}

export function smootherstepDerivative(t: number): number {
  if (!Number.isFinite(t)) throw new RangeError('Invalid progress');
  return t <= 0 || t >= 1 ? 0 : 30 * t * t * (1 - t) * (1 - t);
}

/** P3b-A：四元数最短弧 slerp（Pro 参考 slerpShortest 的等价实现，纯函数，[x,y,z,w]） */
export function slerpShortestQuat(
  a: [number, number, number, number],
  b: [number, number, number, number],
  t: number
): [number, number, number, number] {
  const la = Math.hypot(a[0], a[1], a[2], a[3]);
  const lb = Math.hypot(b[0], b[1], b[2], b[3]);
  const A: [number, number, number, number] = [a[0] / la, a[1] / la, a[2] / la, a[3] / la];
  let B: [number, number, number, number] = [b[0] / lb, b[1] / lb, b[2] / lb, b[3] / lb];
  let d = A[0] * B[0] + A[1] * B[1] + A[2] * B[2] + A[3] * B[3];
  if (d < 0) {
    B = [-B[0], -B[1], -B[2], -B[3]];
    d = -d;
  }
  const tt = Math.max(0, Math.min(1, t));
  if (d > 0.9995) {
    return [
      A[0] + (B[0] - A[0]) * tt,
      A[1] + (B[1] - A[1]) * tt,
      A[2] + (B[2] - A[2]) * tt,
      A[3] + (B[3] - A[3]) * tt,
    ];
  }
  const angle = Math.acos(Math.min(1, Math.max(-1, d)));
  const s = Math.sin(angle);
  const wa = Math.sin((1 - tt) * angle) / s;
  const wb = Math.sin(tt * angle) / s;
  return [A[0] * wa + B[0] * wb, A[1] * wa + B[1] * wb, A[2] * wa + B[2] * wb, A[3] * wa + B[3] * wb];
}

/** 两四元数夹角（弧度，2·acos|dot|，归一化后计算） */
export function quatAngle(
  a: [number, number, number, number],
  b: [number, number, number, number]
): number {
  const la = Math.hypot(a[0], a[1], a[2], a[3]);
  const lb = Math.hypot(b[0], b[1], b[2], b[3]);
  const d = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]) / (la * lb);
  return 2 * Math.acos(Math.min(1, Math.max(0, Math.abs(d))));
}

/**
 * P3b-B：视线角速率受限的朝向收敛（每帧调用，纯函数）。
 * 只限制角速度，不限制角加速度——整体时间律由参考曲线的 smootherstep 保证。
 */
export function stepOrientationQuat(
  current: [number, number, number, number],
  target: [number, number, number, number],
  dtSec: number,
  maxRateRadSec: number
): [number, number, number, number] {
  if (!(dtSec >= 0) || !(maxRateRadSec > 0)) throw new RangeError('Invalid orientation step');
  const d = quatAngle(current, target);
  if (d < 1e-10) return current;
  return slerpShortestQuat(current, target, Math.min(1, (maxRateRadSec * dtSec) / d));
}

/**
 * P3b-B：球面地平线俯角 δ = atan2(√(h(2R+h)), R)（Pro 参考 §5）。
 * atan2 形式在近地处比 acos(R/(R+h)) 数值更稳。h 为相对基准球高度（米）。
 */
export function horizonDip(radiusM: number, datumHeightM: number): number {
  if (!(radiusM > 0) || !Number.isFinite(datumHeightM)) throw new RangeError('Invalid horizon dip input');
  if (datumHeightM < 0) throw new RangeError('horizonDip requires nonnegative datum height');
  return Math.atan2(Math.sqrt(datumHeightM * (2 * radiusM + datumHeightM)), radiusM);
}

/**
 * P3b-B：地平线投影俯仰——把地平线（角高度 e_h，抬头为正）钉在画面 uTop 行
 * （u=0 为画面顶）所需的相机俯仰（抬头为正）：
 * pitch = e_h − atan((1−2u)·tan(vFov/2))。
 * 只控制中央列的地平线位置，非全局构图规则。
 */
export function pitchForHorizonElevation(
  horizonElevationRad: number,
  vFovRad: number,
  uTop: number
): number {
  if (!Number.isFinite(horizonElevationRad) || !(vFovRad > 0) || !(vFovRad < Math.PI)) {
    throw new RangeError('Invalid horizon pitch input');
  }
  if (uTop < 0 || uTop > 1) throw new RangeError('uTop outside viewport');
  return horizonElevationRad - Math.atan((1 - 2 * uTop) * Math.tan(vFovRad / 2));
}

type V3 = readonly [number, number, number];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const addScaled = (a: V3, s: number, b: V3): V3 => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];

/** 纬度/经度（度，行星中心坐标）→ 单位方向向量（+X=0°经，+Y=北极，−Z=90°E 渲染约定） */
export function latLonDirection(latDeg: number, lonDeg: number): V3 {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const c = Math.cos(lat);
  return [c * Math.cos(lon), Math.sin(lat), -c * Math.sin(lon)];
}

/** 单位方向向量 → 纬度/经度（度） */
export function directionLatLon(v: V3): { latDeg: number; lonDeg: number } {
  const u = unit(v);
  const lat = Math.asin(Math.max(-1, Math.min(1, u[1])));
  // atan2(-z, x)：与渲染约定一致（+X=0°经，−Z=90°E）
  const lon = Math.atan2(-u[2], u[0]);
  return { latDeg: (lat * 180) / Math.PI, lonDeg: (lon * 180) / Math.PI };
}

function greatCircle(a: V3, b: V3, t: number): V3 {
  const c = Math.max(-1, Math.min(1, dot(a, b)));
  if (c < -0.999999) throw new RangeError('Antipodal route needs an explicit waypoint');
  const angle = Math.acos(c);
  if (angle < 1e-8) return a;
  const sA = Math.sin((1 - t) * angle) / Math.sin(angle);
  const sB = Math.sin(t * angle) / Math.sin(angle);
  return unit(addScaled([a[0] * sA, a[1] * sA, a[2] * sA], 1, [b[0] * sB, b[1] * sB, b[2] * sB]));
}

/** 采样下降路径。输入必须为当前机位起点（body-fixed）；输出不含 yaw/pitch——用户视线由用户保有。 */
export function sampleDescent(leg: DescentLeg, elapsedSec: number): DescentSample {
  const nums = [leg.from.latDeg, leg.from.lonDeg, leg.from.clearanceM, leg.to.latDeg, leg.to.lonDeg, leg.to.clearanceM, leg.durationSec, leg.radiusM, elapsedSec];
  // P3b-B：clearance 为基准面高（datum）——负值合法（低于基准面的站点），
  // 仅要求几何半径 (radiusM + clearanceM) 为正
  if (
    !nums.every(Number.isFinite) ||
    leg.radiusM + leg.from.clearanceM <= 0 ||
    leg.radiusM + leg.to.clearanceM <= 0 ||
    leg.durationSec <= 0 ||
    leg.radiusM <= 0
  ) {
    throw new RangeError('Invalid descent leg');
  }
  const t = Math.max(0, Math.min(1, elapsedSec / leg.durationSec));
  const s = smootherstep(t);
  const ds = smootherstepDerivative(t) / leg.durationSec;
  const a = latLonDirection(leg.from.latDeg, leg.from.lonDeg);
  const b = latLonDirection(leg.to.latDeg, leg.to.lonDeg);
  const location = directionLatLon(greatCircle(a, b, s));
  const clearanceM = leg.from.clearanceM + (leg.to.clearanceM - leg.from.clearanceM) * s;
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
  return {
    ...location,
    clearanceM,
    progress: t,
    commandedClearanceRateMps: (leg.to.clearanceM - leg.from.clearanceM) * ds,
    commandedTangentialSpeedMps: (leg.radiusM + clearanceM) * angle * ds,
  };
}
