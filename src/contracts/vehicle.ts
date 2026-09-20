/**
 * 航天器载具系统数据契约
 * 遵循 04-VEHICLES.zh-CN.md 规范：
 * 1. 严格区分载人舱、探测器、空间望远镜与空间站；
 * 2. 真实米制物理尺寸（长/宽/高）与对比标尺；
 * 3. 区分产品定义 (VehicleCatalog)、实例 (VehicleInstance) 与任务历史。
 */

export type VehicleId =
  | 'apollo-lm'
  | 'voyager-1'
  | 'james-webb'
  | 'iss'
  | 'tiangong'
  | 'cassini';

export type VehicleType =
  | 'crewed-lander'    // 载人登月舱/着陆器
  | 'interstellar'     // 星际飞掠探测器
  | 'space-telescope'  // 太空望远镜
  | 'space-station'    // 轨道空间站
  | 'orbiter';         // 行星轨道探测器

export type EraCategory = 'classic' | 'contemporary' | 'future-concept';

export interface VehicleDimensions {
  lengthM: number;
  widthM: number;
  heightM: number;
}

export interface VehicleHotspot {
  id: string;
  name: string;
  relativePosM: [number, number, number];
  kidTip: string;
  scienceDetail: string;
}

export interface VehicleDefinition {
  id: VehicleId;
  name: string;
  nameEn: string;
  type: VehicleType;
  era: EraCategory;
  agency: string;
  launchYear: number;
  dimensions: VehicleDimensions;
  massKg: number;
  /** 给孩子的一句话记忆点 */
  kidFact: string;
  /** 详细任务档案与科学成就（家长可展开阅读） */
  description: string;
  /** 著名搭乘航天员或代表性发现 */
  keyMilestone: string;
  /** 结构热点解释 */
  hotspots: VehicleHotspot[];
  /** 默认生成颜色/材质标识 */
  accentColorHex: number;
  /** 历史真实来源 */
  sourceRef: string;
}

export type ViewCameraMode =
  | 'PLANET_OBSERVE'    // 自由观察行星
  | 'VEHICLE_FORMATION' // 伴飞视角（航天器在前景）
  | 'VEHICLE_ONBOARD';  // 随船前向第一人称观察视角
