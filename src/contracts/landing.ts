/**
 * 月球与地表着陆闭环契约规范 (Landing Contracts)
 * 依据第二轮 Pro model 优化审计报告与《太阳系漫游-下一阶段工程方案与Antigravity交接.md》第 9 节规范
 */

import type { BodyId } from './body';

/**
 * 着陆生命周期状态机语义：
 * ORBIT → PREPARING → DESCENDING → SURFACE_LOOK
 *                        ↘ HOLD ↗
 * SURFACE_LOOK → ASCENDING → ORBIT
 */
export type LandingState =
  | 'ORBIT'
  | 'PREPARING'
  | 'DESCENDING'
  | 'HOLD'
  | 'SURFACE_LOOK'
  | 'ASCENDING';

/**
 * 降落地点权威定义
 */
export interface LandingSite {
  id: string;
  bodyId: BodyId;
  name: string;
  nameEn: string;
  subtitle: string;
  description: string;
  provenance: string;
  centerLat: number; // 纬度 (度, 北纬为正)
  centerLon: number; // 经度 (度, 东经为正)
  datumRadiusKm: number; // 基准球半径 (km)
  elevationDatumOffsetM: number; // 相对基准球的基础高程偏置 (m)
  elevationRangeM: [number, number]; // [最低海拔, 最高海拔] (m)
  lookTargetBodyId?: BodyId; // 在地面仰望的目标母星 (如地球)
}

/**
 * 实时遥测仪表数据包
 */
export interface LandingTelemetry {
  state: LandingState;
  site: LandingSite;
  altitudeAGLM: number; // 离地真高 (Above Ground Level, 米)
  altitudeMSLM: number; // 离基准球面高度 (Mean Surface Level, 米)
  verticalSpeedMps: number; // 垂直速度 (米/秒)
  horizontalSpeedMps: number; // 水平推移速度 (米/秒)
  progress: number; // 下降/升空进度 0.0 ~ 1.0
  currentLat: number;
  currentLon: number;
  surfaceYawDeg: number; // 地面水平方位角 (0°~360°, 0°为北, 90°为东)
  surfacePitchDeg: number; // 地面俯仰角 (-85°~+85°, 正为仰视, 0°为平视)
  simTimeAdjusted: boolean; // 是否临时调控了 1x 天文时间倍率
}

/**
 * 预设着陆点列表
 * 首发第一站：月球陶拉斯—利特罗山谷 (Apollo 17 区域)
 */
export const LANDING_SITES: Record<string, LandingSite> = {
  'taurus-littrow': {
    id: 'taurus-littrow',
    bodyId: 'moon',
    name: '陶拉斯—利特罗山谷',
    nameEn: 'Taurus–Littrow Valley',
    subtitle: '陶拉斯—利特罗山谷 · 虚拟降落',
    description:
      '位于月球澄海东南边缘的狭长山谷，两侧耸立着高出谷底逾 2000 米的北断块山与南断块山，阿波罗 17 号任务曾在此着陆考察。',
    provenance: 'NASA LROC NAC DTM Apollo 17 / CGI Moon Kit (5m DEM Reference)',
    centerLat: 20.35,
    centerLon: 30.78,
    datumRadiusKm: 1737.4,
    elevationDatumOffsetM: -2500, // 谷底平原低于 1737.4km 参考球约 2.5km
    elevationRangeM: [-2600, 2300],
    lookTargetBodyId: 'earth',
  },
};
