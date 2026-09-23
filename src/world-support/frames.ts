/**
 * 太阳系漫游 · 纯坐标系几何与天体姿态变换数学
 * 渲染器坐标轴约定：+X=0°经度, +Y=北极, -Z=90°E。
 * 单位显式标定：米(m)、千米(km)、角度(deg)。
 */

export type V3 = readonly [number, number, number];
export type Q4 = readonly [number, number, number, number]; // x, y, z, w

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export function unit(a: V3): V3 {
  const d = Math.hypot(...a);
  if (!Number.isFinite(d) || d < 1e-14) {
    throw new RangeError('Zero/invalid direction');
  }
  return mul(a, 1 / d);
}

export function normalizedQ(q: Q4): Q4 {
  const n = Math.hypot(...q);
  if (!Number.isFinite(n) || n < 1e-14) {
    throw new RangeError('Zero/invalid quaternion');
  }
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

export function rotate(q0: Q4, v: V3): V3 {
  const q = normalizedQ(q0);
  const qv: V3 = [q[0], q[1], q[2]];
  const t = mul(cross(qv, v), 2);
  return add(v, add(mul(t, q[3]), cross(qv, t)));
}

export function inverseQ(q0: Q4): Q4 {
  const q = normalizedQ(q0);
  return [-q[0], -q[1], -q[2], q[3]];
}

export function latLonDirection(latDeg: number, lonDeg: number): V3 {
  if (!Number.isFinite(latDeg) || Math.abs(latDeg) > 90 || !Number.isFinite(lonDeg)) {
    throw new RangeError('Invalid lat/lon');
  }
  const p = (latDeg * Math.PI) / 180;
  const l = (lonDeg * Math.PI) / 180;
  return [Math.cos(p) * Math.cos(l), Math.sin(p), -Math.cos(p) * Math.sin(l)];
}

export function directionLatLon(v: V3) {
  const u = unit(v);
  return {
    latDeg: (Math.asin(Math.max(-1, Math.min(1, u[1]))) * 180) / Math.PI,
    lonDeg: (Math.atan2(-u[2], u[0]) * 180) / Math.PI,
  };
}

export interface LocalSiteFrame {
  pointM: V3;
  up: V3;
  east: V3;
  north: V3;
}

function tangents(pointM: V3, up: V3, lonDeg: number): LocalSiteFrame {
  const l = (lonDeg * Math.PI) / 180;
  const e0: V3 = [-Math.sin(l), 0, -Math.cos(l)];
  const east = unit(sub(e0, mul(up, dot(e0, up))));
  return { pointM, up, east, north: unit(cross(up, east)) };
}

export function sphereSiteFrame(
  radiusM: number,
  latDeg: number,
  lonDeg: number,
  heightM = 0
): LocalSiteFrame {
  if (
    !Number.isFinite(radiusM) ||
    radiusM <= 0 ||
    !Number.isFinite(heightM) ||
    radiusM + heightM <= 0
  ) {
    throw new RangeError('Invalid radius/height');
  }
  const up = latLonDirection(latDeg, lonDeg);
  return tangents(mul(up, radiusM + heightM), up, lonDeg);
}

/**
 * 地球大地测量 WGS84 椭球站点坐标
 */
export function earthGeodeticSiteFrame(
  latDeg: number,
  lonDeg: number,
  ellipsoidalHeightM = 0
): LocalSiteFrame {
  const up = latLonDirection(latDeg, lonDeg);
  const p = (latDeg * Math.PI) / 180;
  const l = (lonDeg * Math.PI) / 180;
  if (!Number.isFinite(ellipsoidalHeightM)) {
    throw new RangeError('Invalid height');
  }
  const a = 6378137;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const N = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
  const pointM: V3 = [
    (N + ellipsoidalHeightM) * Math.cos(p) * Math.cos(l),
    (N * (1 - e2) + ellipsoidalHeightM) * Math.sin(p),
    -(N + ellipsoidalHeightM) * Math.cos(p) * Math.sin(l),
  ];
  return tangents(pointM, up, lonDeg);
}

export function surfacePoseRelativeM(
  site: LocalSiteFrame,
  bodyCenterKm: V3,
  renderOriginKm: V3,
  q: Q4,
  eyeHeightM: number,
  yawDeg: number,
  pitchDeg: number
) {
  if (
    ![...bodyCenterKm, ...renderOriginKm, eyeHeightM, yawDeg, pitchDeg].every(Number.isFinite) ||
    eyeHeightM <= 0 ||
    Math.abs(pitchDeg) > 90
  ) {
    throw new RangeError('Invalid pose');
  }
  const up = rotate(q, site.up);
  const east = rotate(q, site.east);
  const north = rotate(q, site.north);

  const center = mul(sub(bodyCenterKm, renderOriginKm), 1000);
  const eye = add(add(center, rotate(q, site.pointM)), mul(up, eyeHeightM));
  const y = (yawDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  const horizontal = add(mul(north, Math.cos(y)), mul(east, Math.sin(y)));
  const direction = unit(add(mul(horizontal, Math.cos(p)), mul(up, Math.sin(p))));
  return { positionM: eye, up, direction };
}

export function nearPlaneMeters(clearanceM: number, maxNearM = 0.1): number {
  if (
    !Number.isFinite(clearanceM) ||
    clearanceM <= 0 ||
    !Number.isFinite(maxNearM) ||
    maxNearM <= 0
  ) {
    throw new RangeError('Positive clearance required');
  }
  return Math.min(maxNearM, clearanceM * 0.1);
}

export function angularDiameterDeg(radiusM: number, distanceM: number): number {
  if (
    !Number.isFinite(radiusM) ||
    radiusM <= 0 ||
    !Number.isFinite(distanceM) ||
    distanceM <= radiusM
  ) {
    throw new RangeError('Observer must be outside body');
  }
  return 2 * Math.asin(radiusM / distanceM) * (180 / Math.PI);
}

export function solarElevationDeg(up: V3, sunDirection: V3): number {
  return (
    Math.asin(Math.max(-1, Math.min(1, dot(unit(up), unit(sunDirection))))) *
    (180 / Math.PI)
  );
}
