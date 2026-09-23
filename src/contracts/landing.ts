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
  verticalSpeedMps: number; // 垂直速度 (米/秒，语义见 verticalSpeedSemantics)
  verticalSpeedSemantics: 'commanded-clearance-rate'; // 速度为参考曲线净空导数，非惯性速度/非 MSL 变化率
  horizontalSpeedMps: number; // 切向推移速度 (米/秒，commanded 口径)
  progress: number; // 下降/升空进度 0.0 ~ 1.0
  currentLat: number;
  currentLon: number;
  surfaceYawDeg: number; // 地面水平方位角 (0°~360°, 0°为北, 90°为东)
  surfacePitchDeg: number; // 地面俯仰角 (-85°~+85°, 正为仰视, 0°为平视)
  simTimeAdjusted: boolean; // 是否临时调控了 1x 天文时间倍率
  terrain: {
    fidelity: 'measured-dem' | 'datum-sphere' | null;
    sourceId: string | null;
    admissionState: string; // DTM 准入状态 (requires-source-and-registration-review / admitted-*)
  };
}

/**
 * 预设着陆点列表
 * 首发第一站：月球陶拉斯—利特罗山谷 (Apollo 17 区域)
 * 高程字段取自真实 NAC DTM APOLLO17 窗口实测值（6×6 km 窗口，整文件本地裁窗 +
 * 远程小范围独立读数交叉校验，2026-09-24）：
 * 站点双线性采样 −1690.9 m，窗口范围 [−2712.2, −878.2] m（相对 1737.4 km 参考球），
 * 谷地向东南下切加深（SW/SE 角约 −2585/−2687 m）。
 */
export const LANDING_SITES: Record<string, LandingSite> = {
  'taurus-littrow': {
    id: 'taurus-littrow',
    bodyId: 'moon',
    name: '陶拉斯—利特罗山谷',
    nameEn: 'Taurus–Littrow Valley',
    subtitle: '陶拉斯—利特罗山谷 · 真实 DTM 降落',
    description:
      '位于月球澄海东南边缘的狭长山谷，两侧耸立着高出谷底逾 2000 米的北断块山与南断块山，阿波罗 17 号任务曾在此着陆考察。',
    provenance: 'NASA LROC NAC DTM APOLLO17 v1.9 (5 m/px, PDS LRO-L-LROC-5-RDR-V1.0)',
    centerLat: 20.35,
    centerLon: 30.78,
    datumRadiusKm: 1737.4,
    elevationDatumOffsetM: -1690.9, // 站点真实 DEM 双线性值 (2026-09-24 校验后数据)
    elevationRangeM: [-2712.2, -878.2], // 6×6 km 窗口实测范围
    lookTargetBodyId: 'earth',
  },
};
