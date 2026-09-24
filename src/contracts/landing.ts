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
  | 'observe'         // S4b：可进入地表观察（火星 v1——无下降导引，直达站点 1.7m 视高）
  | 'exit-observe'    // S4b：地表观察进行中 → 显示返回轨道入口
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
  /** S4c：动作对应的目标站点（land/travel-to-site/wait——HUD 按站点名渲染入口） */
  siteId?: string;
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
  /**
   * S4b：是否开放完整下降流程（导引/暂停/返轨）。火星站 v1 仅地表观察
   * （真实地形+正射+碎石已就位；下降导引的月面硬编码泛化在 S4c）。
   */
  descentEnabled?: boolean;
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
  /**
   * S5-3：月面第二站（Apollo 15，哈德利月溪）。高程字段取自 apollo15-v1 包实测
   * （2m/px NAC DTM，3×6km 窗 100% 有效；MCP 远程字节校验 3/3、LOLA 交叉差
   * −0.7/−1.3/−1.4m，2026-09-24）。站心为着陆点北 141m 的平坦点（坡度 1.12°，
   * 着陆点本身 3.40°——同 taurus 站的谷底平坦点准则）。
   */
  'hadley-rille': {
    id: 'hadley-rille',
    bodyId: 'moon',
    name: '哈德利月溪',
    nameEn: 'Hadley Rille',
    subtitle: '哈德利月溪 · 真实 DTM 降落',
    description:
      '亚平宁山北麓的月海平原，西侧蜿蜒着深逾两百米的熔岩通道哈德利月溪，阿波罗 15 号曾在此着陆并驾漫游车考察月溪边缘与斯旺山前坡。',
    provenance: 'NASA LROC NAC DTM APOLLO15 v1.9 (2 m/px, PDS LRO-L-LROC-5-RDR-V1.0)',
    centerLat: 26.135698,
    centerLon: 3.630127,
    datumRadiusKm: 1737.4,
    elevationDatumOffsetM: -1921.7, // 站心平坦点双线性值
    elevationRangeM: [-2218.3, -1875.6], // 3×6km 窗实测范围
    lookTargetBodyId: 'earth',
    descentEnabled: true,
    // 山前平原碎石场：月溪陡坎崩积 + 斯旺山坡面碎屑，坡度偏好中等
    rockField: { count: 400, radiusM: 1000, sizeMaxM: 2, slopeWeight: 0.4 },
  },
  'jezero': {
    id: 'jezero',
    bodyId: 'mars',
    name: '耶泽罗撞击坑 · 火星',
    nameEn: 'Jezero Crater',
    subtitle: '耶泽罗坑底 · 真实 HiRISE 地表观察',
    description:
      '火星耶泽罗撞击坑西部坑底，毗邻毅力号着陆点与古老河流三角洲。地表为火山碎屑撞击坑底地貌，散布丰富的小碎石。',
    provenance:
      'NASA MRO HiRISE 受控立体 DTM DTEEC_045994_1985_046060_1985 (1.01 m/px, PDS MRO-M-HIRISE-5-DTM-V1.0) + RED 正射 (0.25 m/px)',
    centerLat: 18.45145,
    centerLon: 77.43657,
    datumRadiusKm: 3394.8398,
    elevationDatumOffsetM: -2561.6, // 站点 HiRISE DTM 双线性值（Mars 2000 areoid，米）
    elevationRangeM: [-2616.6, -2423.8], // 4×5.5km 窗实测范围
    // S4c：开放完整下降流（下降/悬停/触地/返轨与月面同链路）。
    // 注意窗仅 4×5.5km：下降末段（<8km 高度）的窗外地面回退基准球，
    // 渐显门控保证 DTM 在屏幕张角足够时才出现（同月面两级栈语义）。
    descentEnabled: true,
    // 火山坑底：碎石丰富但偏小（毅力号实拍坑底遍布小石、间距米级）、坡度偏好低。
    // S4b 实测校准：1.7m 眼高可见需米级间距——450m 盘 30000 块 ≈ 1.45m 间距
    rockField: { count: 30000, radiusM: 450, sizeMaxM: 1.2, slopeWeight: 0.25 },
  },
};
