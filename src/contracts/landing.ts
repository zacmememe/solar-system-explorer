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
 * P3b-A：降落入口权威可用性（引擎发布，HUD 与产品 API 共用）。
 * 不以"选中天体 + 着陆状态机空闲"冒充到达——先到达，再降落（Pro P3b 审查 §4.1）。
 */
export type LandingAvailabilityAction =
  | 'land'            // 可执行降落
  | 'travel-to-site'  // 已在月球本地但落区在背面 → 前往着陆区
  | 'wait'            // 到达但框架/资源未就绪 → 显示有原因的不可执行状态
  | 'none';           // 未到达/任务进行中 → 不显示降落入口

export type LandingAvailabilityReason =
  | 'ready'
  | 'not-at-body'        // 未在目标天体本地观察（正常导航前往）
  | 'travel-in-progress' // 导航飞行未结束
  | 'mission-active'     // 降落任务/地表停驻进行中（HUD 显示任务控制）
  | 'frame-transition'   // 比例框架切换中
  | 'far-side-site'      // 落区在当前半球背面
  | 'assets-loading'     // DTM 数据装载中
  | 'assets-error';      // DTM 装载失败

export interface LandingAvailability {
  action: LandingAvailabilityAction;
  reason: LandingAvailabilityReason;
  /** 人类可读的原因说明（等待态展示给用户） */
  detail?: string;
}

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
  /** S3b 地貌化碎石场参数（示意层）——缺省由引擎取保守默认 */
  rockField?: {
    count: number; // 块数
    radiusM: number; // 分布半径（站点周边）
    sizeMaxM: number; // 最大半尺度（幂律上界）
    slopeWeight: number; // 0..1 坡度偏好：0=均匀分布，1=碎石显著富集于坡脚/坡面
  };
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
 * 高程字段取自真实 NAC DTM APOLLO17 窗口实测值（12×12 km 窗口，整文件本地裁窗 +
 * 远程小范围独立读数交叉校验，2026-09-24）：
 * 站点双线性采样 −2641.1 m，窗口范围 [−2746.5, −646.9] m（相对 1737.4 km 参考球）。
 * 2026-09-24 站点南移：原中心 (20.35, 30.78) 实测坡度 42°（位于谷缘山坡，触地视野
 * 被山体遮挡）——按 DEM 坡度/视线开阔度扫描迁至谷底平坦点 (20.2108, 30.7997)
 * （坡度 0.8°、200m 起伏 18m、2km 内无遮挡），距阿波罗 17 真实着陆点约 1km。
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
    centerLat: 20.2108,
    centerLon: 30.7997,
    datumRadiusKm: 1737.4,
    elevationDatumOffsetM: -2641.1, // 站点真实 DEM 双线性值 (2026-09-24 谷底平坦点)
    elevationRangeM: [-2746.5, -646.9], // 12×12 km 窗口实测范围
    lookTargetBodyId: 'earth',
    // S3b：谷底碎石场——断块山崩积裙地貌，坡度偏好中等（碎石富集于山麓坡脚，
    // 谷底中心相对干净——与阿波罗 17 实照的谷底景象一致）
    rockField: { count: 500, radiusM: 1200, sizeMaxM: 2.5, slopeWeight: 0.55 },
  },
};
