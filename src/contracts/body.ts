/**
 * 天体数据规范
 * 依据 01-REBUILD-PLAN.zh-CN.md 第 5、6 节定义
 */

export type BodyId =
  | 'sun'
  | 'mercury'
  | 'venus'
  | 'earth'
  | 'moon'
  | 'mars'
  | 'phobos'
  | 'deimos'
  | 'jupiter'
  | 'io'
  | 'europa'
  | 'ganymede'
  | 'callisto'
  | 'amalthea'
  | 'saturn'
  | 'mimas'
  | 'enceladus'
  | 'tethys'
  | 'dione'
  | 'rhea'
  | 'titan'
  | 'hyperion'
  | 'iapetus'
  | 'uranus'
  | 'miranda'
  | 'ariel'
  | 'umbriel'
  | 'titania'
  | 'oberon'
  | 'neptune'
  | 'triton'
  | 'proteus'
  | string;

export type BodyType = 'star' | 'planet' | 'moon' | 'spacecraft';

export interface RingConfig {
  innerRadiusRatio: number;
  outerRadiusRatio: number;
  textureAssetId: string;
}

export interface CelestialBodyData {
  id: BodyId;
  name: string;
  nameEn: string;
  type: BodyType;
  parentId: BodyId | null;
  /** 平均物理半径（千米） */
  radiusKm: number;
  /** 三维主轴物理尺寸（千米，针对不规则非球体天体 [x, y, z]） */
  dimensionsKm?: [number, number, number];
  /** 外观几何形态：标准圆球或不规则三轴多面体 */
  shapeType?: 'sphere' | 'irregular';
  /** 自转倾角（度） */
  axialTiltDeg: number;
  /** 自转周期（小时，负数代表逆向自转如金星与天王星） */
  rotationPeriodHours: number;
  /** 距父天体平均轨道半长轴（千米） */
  orbitSemiMajorAxisKm: number;
  /** 公转周期（日） */
  orbitPeriodDays: number;
  /** 轨道倾角（度，相对于黄道面或母星赤道面） */
  orbitalInclinationDeg?: number;
  /** 轨道离心率 */
  eccentricity?: number;
  /** 代表色（用于轨道线及未载入贴图时的底色） */
  colorHex?: number;
  /** 亲子观察简短提示（给孩子的一句话） */
  observationTip: string;
  /** 详细科学说明（家长可展开阅读） */
  description: string;
  /** 趣味冷知识（激发好奇心） */
  funFact?: string;
  /** 默认颜色纹理资产 ID */
  colorAssetId: string;
  /** 备选或特殊图层资产 ID（例如金星地表雷达图） */
  secondaryAssetId?: string;
  /** 星环配置（如土星） */
  ringConfig?: RingConfig;
  /** 是否拥有大气层 */
  hasAtmosphere?: boolean;
  /** 数据来源说明 */
  sourceRef: string;
}
