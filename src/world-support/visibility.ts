/**
 * 太阳系漫游 · 观测模式与能见度策略
 * 严格区分物理观测与地貌研究两种意图：
 * - 物理观测 (physical)：保持模拟时钟、昼夜晨昏与真实云层，夜面与阴云诚实披露；
 * - 地貌观察 (terrain-study)：用户主动开启，隐藏云层并使用全向参考照明，严禁修改世界时间或转动天体。
 */

import { dot, unit, type V3 } from './frames';

export type ObservationMode = 'physical' | 'terrain-study';

export interface ObservationPolicyResult {
  mode: ObservationMode;
  hideClouds: boolean;
  useReferenceLighting: boolean;
  changeSimulationTime: false;
  physicalNight: boolean;
  disclosure: string;
}

export function observationPolicy(
  mode: ObservationMode,
  solarElevationDeg: number
): ObservationPolicyResult {
  if (!Number.isFinite(solarElevationDeg) || Math.abs(solarElevationDeg) > 90) {
    throw new RangeError(`Invalid solar elevation: ${solarElevationDeg}`);
  }
  if (mode !== 'physical' && mode !== 'terrain-study') {
    throw new RangeError(`Invalid observation mode: ${mode}`);
  }

  const isNight = solarElevationDeg < 0;
  return {
    mode,
    hideClouds: mode === 'terrain-study',
    useReferenceLighting: mode === 'terrain-study',
    changeSimulationTime: false,
    physicalNight: isNight,
    disclosure:
      mode === 'terrain-study'
        ? '地貌观察 · 已隐藏云层 · 参考照明'
        : isNight
        ? '当前为夜面 · 可开启地貌观察查看地形'
        : '物理观测 · 真实昼夜与云层',
  };
}

type Interval = readonly [number, number];

function intersectSphere(o: V3, d: V3, r: number): Interval | null {
  const b = dot(o, d);
  const c = dot(o, o) - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  return [-b - s, -b + s];
}

/**
 * 计算穿过球层云层的视线光程（米），并在碰到不透明地表处截断。
 * 杜绝站在云下看地面时仍被地面后侧的云遮盖。
 */
export function cloudPathLengthM(
  origin: V3,
  direction: V3,
  baseRadiusM: number,
  topRadiusM: number,
  opaqueHitDistanceM: number
): number {
  if (
    ![...origin, baseRadiusM, topRadiusM, opaqueHitDistanceM].every(Number.isFinite) ||
    baseRadiusM <= 0 ||
    topRadiusM <= baseRadiusM ||
    opaqueHitDistanceM < 0
  ) {
    throw new RangeError('Invalid cloud interval');
  }
  const d = unit(direction);
  const outer = intersectSphere(origin, d, topRadiusM);
  if (!outer) return 0;
  const a = Math.max(0, outer[0]);
  const b = Math.min(opaqueHitDistanceM, outer[1]);
  if (b <= a) return 0;
  const inner = intersectSphere(origin, d, baseRadiusM);
  if (!inner) return b - a;
  return Math.max(0, b - a - Math.max(0, Math.min(b, inner[1]) - Math.max(a, inner[0])));
}

export function transmittance(extinctionPerM: number, pathM: number): number {
  if (
    !Number.isFinite(extinctionPerM) ||
    extinctionPerM < 0 ||
    !Number.isFinite(pathM) ||
    pathM < 0
  ) {
    throw new RangeError('Invalid optical depth');
  }
  return Math.exp(-extinctionPerM * pathM);
}
