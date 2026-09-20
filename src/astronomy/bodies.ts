/**
 * 天体数据表与坐标系变换
 * 遵循 01-REBUILD-PLAN.zh-CN.md：保留双精度公里数据，给 GPU 局部坐标
 */

import type { CelestialBodyData } from '../contracts/body';

export const BODIES: Record<string, CelestialBodyData> = {
  earth: {
    id: 'earth',
    name: '地球',
    nameEn: 'Earth',
    type: 'planet',
    parentId: null, // 全景时指向太阳，M0/M1局部系统以地球为原点
    radiusKm: 6371.0,
    axialTiltDeg: 23.44,
    rotationPeriodHours: 23.934,
    orbitSemiMajorAxisKm: 149598023,
    orbitPeriodDays: 365.256,
    observationTip: '看大洋与大陆的轮廓；注意南极与北极的白色冰盖。',
    description: '地球是人类的家园，表面约 71% 被水覆盖。本模型采用 Solar System Scope 基于 NASA 观测数据加工的 2K 白昼纹理。',
    colorAssetId: 'earth-day-sss-2k',
    sourceRef: 'Solar System Scope / NASA',
  },
  moon: {
    id: 'moon',
    name: '月球',
    nameEn: 'Moon',
    type: 'moon',
    parentId: 'earth',
    radiusKm: 1737.4,
    axialTiltDeg: 1.54,
    rotationPeriodHours: 655.72,
    orbitSemiMajorAxisKm: 384400,
    orbitPeriodDays: 27.321,
    observationTip: '观察正面的深色平原（月海），转到背面看密密麻麻的撞击坑。',
    description: '月球是地球唯一的天然卫星，处于潮汐锁定状态。本模型采用 NASA CGI Moon Kit (2025/2026) LROC 广角相机多光谱正射拼图。',
    colorAssetId: 'moon-svs-2025-2k',
    sourceRef: 'NASA SVS CGI Moon Kit',
  },
};

/**
 * 局部场景单位换算：1 Scene Unit = 1000 km
 */
export const KM_PER_SCENE_UNIT = 1000.0;

export interface RenderTransform {
  renderPosition: [number, number, number];
  renderRadius: number;
}

/**
 * 将双精度公里物理坐标转换为 GPU 局部渲染坐标
 * @param physicalPosKm 物理坐标 [x, y, z] (km)
 * @param focusOriginKm 当前观察焦点原点 [x, y, z] (km)
 * @param radiusKm 天体物理半径 (km)
 */
export function computeRenderTransform(
  physicalPosKm: [number, number, number],
  focusOriginKm: [number, number, number],
  radiusKm: number
): RenderTransform {
  const relX = (physicalPosKm[0] - focusOriginKm[0]) / KM_PER_SCENE_UNIT;
  const relY = (physicalPosKm[1] - focusOriginKm[1]) / KM_PER_SCENE_UNIT;
  const relZ = (physicalPosKm[2] - focusOriginKm[2]) / KM_PER_SCENE_UNIT;
  const renderRadius = radiusKm / KM_PER_SCENE_UNIT;

  return {
    renderPosition: [relX, relY, relZ],
    renderRadius,
  };
}

/**
 * 局部地月系统简化轨道位置计算（解析轨道，M0/M1基准）
 * @param timeHours 距历元时间（小时）
 */
export function getMoonPositionKm(timeHours: number): [number, number, number] {
  const moonOrbitPeriodHours = 27.3216 * 24.0;
  const angleRad = ((2 * Math.PI) / moonOrbitPeriodHours) * timeHours;
  const distanceKm = 384400.0;
  // 黄道面/白道面近似轨道，倾角约 5.14 度
  const inclinationRad = (5.14 * Math.PI) / 180.0;

  const x = distanceKm * Math.cos(angleRad);
  const y = distanceKm * Math.sin(angleRad) * Math.sin(inclinationRad);
  const z = distanceKm * Math.sin(angleRad) * Math.cos(inclinationRad);

  return [x, y, z];
}
