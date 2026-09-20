/**
 * 天体数据规范
 * 依据 01-REBUILD-PLAN.zh-CN.md 第 5、6 节定义
 */

export type BodyId = 'earth' | 'moon' | 'sun' | 'saturn' | 'titan' | 'enceladus' | string;

export type BodyType = 'star' | 'planet' | 'moon' | 'spacecraft';

export interface CelestialBodyData {
  id: BodyId;
  name: string;
  nameEn: string;
  type: BodyType;
  parentId: BodyId | null;
  /** 平均物理半径（千米） */
  radiusKm: number;
  /** 自转倾角（度） */
  axialTiltDeg: number;
  /** 自转周期（小时） */
  rotationPeriodHours: number;
  /** 距父天体平均轨道半长轴（千米） */
  orbitSemiMajorAxisKm: number;
  /** 公转周期（日） */
  orbitPeriodDays: number;
  /** 亲子观察简短提示（给孩子的一句话） */
  observationTip: string;
  /** 详细科学说明（家长可展开阅读） */
  description: string;
  /** 默认颜色纹理资产 ID */
  colorAssetId: string;
  /** 数据来源 */
  sourceRef: string;
}
