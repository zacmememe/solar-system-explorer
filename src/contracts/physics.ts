/**
 * 太阳系漫游 · 物理全系统与米制空间契约规范 (src/contracts/physics.ts)
 * 依据 260923 Pro Model 优化审计与《02-公共内核与数据规范.md》制定
 *
 * 核心目标：
 * 1. 明确区分物理公里空间 (CPU double)、表面站点空间 (Body-Fixed) 与 GPU 局部米制渲染空间；
 * 2. 标定统一惯性参考框架 (ICRF/J2000) 与 J2000 历元秒数；
 * 3. 拒绝恒零速度与虚假 IAU 保证，真实计算切向公里速度并诚实标定质量为 'analytic-approximation'；
 * 4. 三轴真实物理半径保留天体扁率（如地球、木星、土星赤道与极半径分别独立存储）。
 */

import type { BodyId } from './body';

/**
 * 姿态与轨道解算品质
 * - 'ephemeris': 经核验的完整数值星历/SPICE 历元表
 * - 'analytic-approximation': 开普勒椭圆/圆轨道解析几何近似
 * - 'modelled-attitude': 理论/动力学模型解算姿态（如非潮汐锁定混沌体）
 */
export type PoseQuality = 'ephemeris' | 'analytic-approximation' | 'modelled-attitude';

/**
 * 单个天体的瞬时完整物理状态描述符
 */
export interface PhysicalBodyState {
  /** 天体唯一标识 */
  id: BodyId;
  /**
   * J2000 基准近似 TDB 秒数。
   * 当前实现 = UTC 秒差 + 69.184s 固定偏移（37 闰秒 + 32.184s，TT≈TDB 假设），
   * 属 analytic-approximation 换算，非星历级 TDB（未含 TDB−TT 毫秒级周期项）。
   */
  tdbSecondsFromJ2000: number;
  /** 相对太阳中心在解析近似黄道系下的物理坐标 (公里) [x, y, z]；实际轴系见 positionFrameId */
  positionKm: readonly [number, number, number];
  /** 相对惯性系在当前轨道上的瞬时切向物理速度 (公里/秒) [vx, vy, vz] */
  velocityKmPerSec: readonly [number, number, number];
  /** 天体固连坐标系到惯性系的标准自转姿态四元数 [x, y, z, w] */
  fixedToInertialQuaternion: readonly [number, number, number, number];
  /** 天体三轴真实物理半径 [a, b, c] (公里，a=b 为赤道半径，c 为极半径) */
  radiiKm: readonly [number, number, number];
  /** 天体平均名义物理半径 (公里) */
  meanRadiusKm: number;
  /** 位置所属参考系 (默认 'ICRF/J2000') */
  positionFrameId: string;
  /** 制图坐标系名称 (如 'IAU_EARTH', 'IAU_MOON') */
  cartographicFrameId: string;
  /** 解算品质等级 */
  quality: PoseQuality;
  /** 物理数据版本 */
  sourceVersion: string;
}

/**
 * 太阳系全系统瞬时物理快照
 */
export interface PhysicalSystemSnapshot {
  /** 严格以 J2000 为基准的 TDB 秒数 */
  tdbSecondsFromJ2000: number;
  /** 场景相对基准历元的模拟小时数 */
  simTimeHours: number;
  /** 对应的世界标准时 ISO 字符串 */
  epochIso: string;
  /** 全系统所有天体的物理状态字典 */
  bodies: Record<string, PhysicalBodyState>;
  /** 统一物理坐标系标识 */
  frameId: string;
}

/**
 * 地表米制站点描述符
 * 区分地面高程 (heightM) 与观察者眼高 (eyeHeightM)：
 * 站点地面高程来自地形提供器（相对基准面，可为负，如月面谷底约 -2500m）；
 * 眼高是站姿观察点相对地面的高度（默认 1.7m 人眼视高）。
 */
export interface MetricStation {
  /** 所属天体 ID */
  bodyId: BodyId;
  /** 坐标类型：大地经纬高程 (含椭球偏心率) 或球心经纬度 */
  coordinateType: 'geodetic' | 'planetocentric';
  /** 高程基准面标识 (如 'WGS84', 'MOON_PA453', 'MARS_IAU2000') */
  datum: string;
  /** 纬度 (度，北纬为正，-90 ~ +90) */
  latDeg: number;
  /** 经度 (度，东经为正，-180 ~ +180) */
  lonDeg: number;
  /** 站点地面高程：相对基准面的地形高程 (米，可为负) */
  heightM: number;
  /** 观察者眼高：相对站点地面的高度 (米，>0，默认人眼 1.7) */
  eyeHeightM: number;
  /** 站点在天体固连坐标系中的米制三维直角坐标 [x, y, z]（含地面高程，轴约定 +X=0°经 +Y=北极 -Z=90°E） */
  bodyFixedPosM: readonly [number, number, number];
  /** 站点局部正交外法线单位向量 [nx, ny, nz]（body-fixed 系） */
  surfaceNormal: readonly [number, number, number];
  /** 保存时用户的地面环顾朝向（度；yaw 0=正北 顺时针，pitch -85~85） */
  orientationDeg?: {
    yawDeg: number;
    pitchDeg: number;
  };
}
