/**
 * 天体物理状态提供器与展示策略调度器 (BodyPoseProvider)
 * 遵循主方案规范：
 * 1. 明确双精度公里单位坐标、统一 Epoch 标尺与天体真实几何；
 * 2. 严格区分宏观导航示意 (NAV_SCHEMATIC) 与真实物理观察 (PHYSICAL_OBSERVATION)；
 * 3. 严格满足月球看地球真实物理视直径 1.90° 几何数值断言；
 * 4. 提供连续平滑的双向策略过渡插值，杜绝突跳。
 */

import * as THREE from 'three';
import type { BodyId } from '../contracts/body';
import type { CameraAnchor, CameraLookTarget } from '../contracts/camera';
import type {
  PhysicalBodyState,
  PhysicalSystemSnapshot,
} from '../contracts/physics';
import {
  BODIES,
  getPlanetNavPosition,
  getSatelliteNavPosition,
  getNavDisplayRadius,
  PLANET_INITIAL_PHASES,
  SATELLITE_INITIAL_PHASES,
  PLANET_SPIN_OFFSETS,
} from './bodies';

export type PresentationPolicy = 'NAV_SCHEMATIC' | 'PHYSICAL_OBSERVATION';

export interface BodyPhysicalState {
  bodyId: BodyId;
  epochIso: string;
  epochTdbSeconds: number;
  positionKm: [number, number, number];
  velocityKmPerSec: [number, number, number];
  apparentRadiusKm: number;
  renderPosition: [number, number, number];
  renderSurfaceRadius: number;
  renderFramingRadius: number;
  sourceFrame: string;
  orientationSource: string;
  physicalSunDirection: [number, number, number];
}

export interface BodyPoseOutput {
  position: THREE.Vector3;
  displayRadius: number;
  renderSurfaceRadius: number;
  renderFramingRadius: number;
  policy: PresentationPolicy;
  policyTransitionProgress: number; // 0 (NAV) ~ 1 (PHYSICAL)
  physicalSunDirection: THREE.Vector3;
}

export interface ObservationFrame {
  sequence: number;
  simulationTime: {
    epochIso: string;
    simTimeHours: number;
    elapsedSeconds: number;
    timeBasis: string;
  };
  presentation: {
    policy: PresentationPolicy;
    blend: number;
    referenceBodyId: BodyId | null;
  };
  bodies: Map<BodyId, BodyPhysicalState>;
  observer?: {
    anchor: CameraAnchor;
    position: [number, number, number];
    lookTarget?: CameraLookTarget;
  };
}

export class BodyPoseProvider {
  public static readonly BASE_EPOCH_ISO = '2026-09-22T00:00:00Z';
  public static readonly J2000_EPOCH_MS = 946728000000; // 2000-01-01T12:00:00Z
  /**
   * 2026-09-22T00:00:00Z 相对 J2000 (2000-01-01T12:00:00Z) 的 UTC 秒差（两个 JS Date 实测，非 TDB）
   */
  public static readonly BASE_J2000_OFFSET_UTC_SEC = 843307200;
  /**
   * UTC → TT(TDB) 固定近似偏移（秒）= 37 闰秒 + 32.184s（截至 2026 年，IERS 未新增闰秒的假设）。
   * 诚实声明：这是解析近似换算，未实现星历级 TDB（TDB−TT < 2ms 周期项），quality 仍为 analytic-approximation。
   */
  public static readonly UTC_TO_TT_APPROX_SEC = 69.184;

  /**
   * 将场景 UTC 秒差换算为近似 TDB 秒（J2000 基准）
   */
  public static utcSecondsToApproxTdb(utcSecondsFromJ2000: number): number {
    return utcSecondsFromJ2000 + BodyPoseProvider.UTC_TO_TT_APPROX_SEC;
  }

  /** 惯性坐标系诚实标识：XZ 平面解析圆轨道近似黄道系，非 ICRF/J2000 星历 */
  public static readonly POSITION_FRAME_ID = 'ECLIPTIC-ANALYTIC-APPROX';
  /** 制图坐标系诚实标识：渲染边界轴约定 +X=0°经、+Y=北极、-Z=90°E，非 IAU 制图模型声明 */
  public static readonly CARTOGRAPHIC_FRAME_ID = 'BODY-FIXED-RENDER-X0-YN-Z90E';

  // 权威物理常数 (千米)
  public static readonly PHYSICAL_RADII_KM: Record<string, number> = {
    sun: 696340.0,
    earth: 6371.0,
    moon: 1737.4,
    mars: 3389.5,
    jupiter: 69911.0,
    saturn: 58232.0,
    uranus: 25362.0,
    neptune: 24622.0,
    mercury: 2439.7,
    venus: 6051.8,
    phobos: 11.26,
    deimos: 6.2,
  };

  /**
   * 真实三轴物理半径 [a, b, c] (千米)
   * 保留天体自转动力学扁率（如地球、木星、土星）与不规则形状（如火卫一、土卫七）
   */
  public static readonly TRIAXIAL_RADII_KM: Record<string, [number, number, number]> = {
    sun: [696340.0, 696340.0, 696340.0],
    mercury: [2439.7, 2439.7, 2439.7],
    venus: [6051.8, 6051.8, 6051.8],
    earth: [6378.137, 6378.137, 6356.752], // WGS84 赤道与极半径
    moon: [1738.1, 1738.1, 1736.0],
    mars: [3396.2, 3396.2, 3376.2],
    phobos: [13.0, 11.4, 9.1], // 三轴半轴
    deimos: [7.8, 6.0, 5.1],
    jupiter: [71492.0, 71492.0, 66854.0], // 气态巨行星扁率
    io: [1829.4, 1819.4, 1815.7],
    europa: [1560.8, 1560.8, 1560.8],
    ganymede: [2634.1, 2634.1, 2634.1],
    callisto: [2410.3, 2410.3, 2410.3],
    saturn: [60268.0, 60268.0, 54364.0], // 强自转扁率
    titan: [2574.7, 2574.7, 2574.7],
    hyperion: [180.0, 133.0, 103.0],
    uranus: [25559.0, 25559.0, 24973.0],
    neptune: [24764.0, 24764.0, 24341.0],
    triton: [1353.4, 1353.4, 1353.4],
  };

  // 权威地月轨道平均距离 (千米)
  public static readonly MOON_ORBIT_SEMI_MAJOR_AXIS_KM = 384400.0;

  private currentPolicy: PresentationPolicy = 'NAV_SCHEMATIC';
  private targetPolicy: PresentationPolicy = 'NAV_SCHEMATIC';
  private transitionProgress: number = 0; // 0.0 ~ 1.0
  private transitionDurationSec: number = 2.0;
  private frameSequence: number = 0;

  /**
   * PHYSICAL_OBSERVATION 下被线性化的父子系统基准行星（默认地月系）。
   * 引擎聚焦其他系统（如木星/土星）时切换，保证各父子系统内部半径/距离比例物理一致。
   */
  private physicalReferenceBodyId: BodyId = 'earth';

  constructor(initialPolicy: PresentationPolicy = 'NAV_SCHEMATIC') {
    this.currentPolicy = initialPolicy;
    this.targetPolicy = initialPolicy;
    this.transitionProgress = initialPolicy === 'PHYSICAL_OBSERVATION' ? 1.0 : 0.0;
  }

  public getPolicy(): PresentationPolicy {
    return this.currentPolicy;
  }

  public getPresentationPolicy(): PresentationPolicy {
    return this.currentPolicy;
  }

  public setPolicy(policy: PresentationPolicy, durationSec: number = 2.0): void {
    if (this.targetPolicy === policy) return;
    this.targetPolicy = policy;
    this.transitionDurationSec = Math.max(0.1, durationSec);
  }

  public setPresentationPolicy(policy: PresentationPolicy, durationSec: number = 2.0): void {
    this.setPolicy(policy, durationSec);
  }

  public update(deltaSec: number): void {
    if (this.targetPolicy === 'PHYSICAL_OBSERVATION' && this.transitionProgress < 1.0) {
      this.transitionProgress = Math.min(1.0, this.transitionProgress + deltaSec / this.transitionDurationSec);
      if (this.transitionProgress >= 1.0) {
        this.currentPolicy = 'PHYSICAL_OBSERVATION';
      }
    } else if (this.targetPolicy === 'NAV_SCHEMATIC' && this.transitionProgress > 0.0) {
      this.transitionProgress = Math.max(0.0, this.transitionProgress - deltaSec / this.transitionDurationSec);
      if (this.transitionProgress <= 0.0) {
        this.currentPolicy = 'NAV_SCHEMATIC';
      }
    }
  }

  public updateTransition(deltaSec: number): void {
    this.update(deltaSec);
  }

  public getTransitionProgress(): number {
    return this.transitionProgress;
  }

  /**
   * 设置 PHYSICAL_OBSERVATION 模式下的参考父子系统（基准行星）
   */
  public setPhysicalReferenceBody(id: BodyId): void {
    const data = BODIES[id];
    if (data && (data.type === 'planet' || data.type === 'star')) {
      this.physicalReferenceBodyId = id;
    }
  }

  public getPhysicalReferenceBody(): BodyId {
    return this.physicalReferenceBodyId;
  }

  /**
   * 计算指定距离下球体的视直径（角直径，单位：度）
   * 公式：θ = 2 * arcsin(radius / distance)
   */
  public static computeAngularDiameterDeg(radiusKm: number, distanceKm: number): number {
    if (distanceKm <= radiusKm) return 180.0;
    const sinHalf = radiusKm / distanceKm;
    const halfAngleRad = Math.asin(Math.min(1.0, sinHalf));
    return (2.0 * halfAngleRad * 180.0) / Math.PI;
  }

  /**
   * 获取月球中心处观测地球的视直径（度）
   * 物理真实值应精确为约 1.899° ~ 1.90°
   */
  public static getMoonCenterEarthAngularDiameterDeg(): number {
    const rEarth = BodyPoseProvider.PHYSICAL_RADII_KM.earth;
    const dist = BodyPoseProvider.MOON_ORBIT_SEMI_MAJOR_AXIS_KM;
    return BodyPoseProvider.computeAngularDiameterDeg(rEarth, dist);
  }

  /**
   * 获取月球近侧正中地表观测地球的视直径（度）
   */
  public static getMoonSurfaceEarthAngularDiameterDeg(): number {
    const rEarth = BodyPoseProvider.PHYSICAL_RADII_KM.earth;
    const dist = BodyPoseProvider.MOON_ORBIT_SEMI_MAJOR_AXIS_KM - BodyPoseProvider.PHYSICAL_RADII_KM.moon;
    return BodyPoseProvider.computeAngularDiameterDeg(rEarth, dist);
  }

  /**
   * 依据观察者物理坐标与目标物理坐标，计算真实视直径（角直径，单位：度）
   * 严格遵循 reference-kernel
   */
  public static apparentAngularDiameter(
    radiusKm: number,
    observerPosKm: [number, number, number],
    targetPosKm: [number, number, number]
  ): number {
    if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
      throw new RangeError('Invalid radius');
    }
    const d = Math.hypot(
      observerPosKm[0] - targetPosKm[0],
      observerPosKm[1] - targetPosKm[1],
      observerPosKm[2] - targetPosKm[2]
    );
    if (d <= radiusKm) {
      return 180.0;
    }
    return (2.0 * Math.asin(radiusKm / d) * 180.0) / Math.PI;
  }

  /**
   * 获取天体在物理空间中的绝对开普勒公里坐标（原点为太阳中心，单位：km）
   */
  public getPhysicalPositionKm(id: BodyId, simTimeHours: number): [number, number, number] {
    const data = BODIES[id];
    if (!data || data.type === 'star') {
      return [0, 0, 0];
    }

    if (data.type === 'planet') {
      const d = data.orbitSemiMajorAxisKm;
      const periodHours = data.orbitPeriodDays * 24.0;
      const initialPhase = PLANET_INITIAL_PHASES[id] || 0;
      const angleRad = ((2.0 * Math.PI) / periodHours) * simTimeHours + initialPhase;
      const incRad = ((data.orbitalInclinationDeg || 0) * Math.PI) / 180.0;
      return [
        d * Math.cos(angleRad),
        d * Math.sin(angleRad) * Math.sin(incRad),
        d * Math.sin(angleRad) * Math.cos(incRad),
      ];
    }

    if (data.type === 'moon') {
      const parentId = data.parentId || 'earth';
      const [px, py, pz] = this.getPhysicalPositionKm(parentId, simTimeHours);
      const periodHours = Math.abs(data.orbitPeriodDays) * 24.0;
      const initialPhase = SATELLITE_INITIAL_PHASES[id] || 0;
      const angleRad = ((2.0 * Math.PI) / periodHours) * simTimeHours + initialPhase;
      const d = data.orbitSemiMajorAxisKm;
      const incRad = ((data.orbitalInclinationDeg || 0) * Math.PI) / 180.0;
      return [
        px + d * Math.cos(angleRad),
        py + d * Math.sin(angleRad) * Math.sin(incRad),
        pz + d * Math.sin(angleRad) * Math.cos(incRad),
      ];
    }

    return [0, 0, 0];
  }

  /**
   * 基于物理空间公里向量计算太阳光照射方向单位向量
   * 公式：d_sun = normalize(P_sun_km - P_body_km) = normalize(-P_body_km)
   * 彻底消除场景非线性混合尺度造成的 170° 地月晨昏线逆向矛盾！
   */
  public getPhysicalSunDirection(id: BodyId, simTimeHours: number): THREE.Vector3 {
    const posKm = this.getPhysicalPositionKm(id, simTimeHours);
    const sunDir = new THREE.Vector3(-posKm[0], -posKm[1], -posKm[2]);
    if (sunDir.lengthSq() < 1e-8) {
      return new THREE.Vector3(1, 0, 0);
    }
    return sunDir.normalize();
  }

  /**
   * 获取天体在惯性系中的瞬时切向物理速度 (公里/秒)
   * 采用开普勒解析公转微分，杜绝 [0, 0, 0] 虚假占位
   */
  public getPhysicalVelocityKmPerSec(id: BodyId, simTimeHours: number): [number, number, number] {
    const data = BODIES[id];
    if (!data || data.type === 'star') {
      return [0, 0, 0];
    }

    if (data.type === 'planet') {
      const d = data.orbitSemiMajorAxisKm;
      const periodHours = data.orbitPeriodDays * 24.0;
      if (periodHours === 0) return [0, 0, 0];
      const omega = (2.0 * Math.PI) / (periodHours * 3600.0); // 弧度/秒
      const initialPhase = PLANET_INITIAL_PHASES[id] || 0;
      const angleRad = ((2.0 * Math.PI) / periodHours) * simTimeHours + initialPhase;
      const incRad = ((data.orbitalInclinationDeg || 0) * Math.PI) / 180.0;

      // x = d * cos(θ), y = d * sin(θ) * sin(i), z = d * sin(θ) * cos(i)
      return [
        -d * omega * Math.sin(angleRad),
        d * omega * Math.cos(angleRad) * Math.sin(incRad),
        d * omega * Math.cos(angleRad) * Math.cos(incRad),
      ];
    }

    if (data.type === 'moon') {
      const parentId = data.parentId || 'earth';
      const [pvx, pvy, pvz] = this.getPhysicalVelocityKmPerSec(parentId, simTimeHours);
      const periodHours = Math.abs(data.orbitPeriodDays) * 24.0;
      if (periodHours === 0) return [pvx, pvy, pvz];
      const omega = (2.0 * Math.PI) / (periodHours * 3600.0);
      const initialPhase = SATELLITE_INITIAL_PHASES[id] || 0;
      const angleRad = ((2.0 * Math.PI) / periodHours) * simTimeHours + initialPhase;
      const d = data.orbitSemiMajorAxisKm;
      const incRad = ((data.orbitalInclinationDeg || 0) * Math.PI) / 180.0;

      const relVx = -d * omega * Math.sin(angleRad);
      const relVy = d * omega * Math.cos(angleRad) * Math.sin(incRad);
      const relVz = d * omega * Math.cos(angleRad) * Math.cos(incRad);
      return [pvx + relVx, pvy + relVy, pvz + relVz];
    }

    return [0, 0, 0];
  }

  /**
   * 获取天体固连坐标系到惯性系的姿态四元数 [x, y, z, w]
   * 诚实声明：这是简化姿态模型——极轴倾角绕惯性 +Z 一次旋转 + 绕本体极轴的自转角；
   * 卫星分支采用同步自转（潮汐锁定）近似（自转角 = -轨道角 + 观赏偏置），非 IAU 精确指向解，
   * quality 标记为 analytic-approximation；非潮汐锁定天体（如 Hyperion）不应套用此假设。
   */
  public getFixedToInertialQuaternion(id: BodyId, simTimeHours: number): [number, number, number, number] {
    const data = BODIES[id];
    const axialTiltDeg = data?.axialTiltDeg || 0;
    const axialTiltRad = (axialTiltDeg * Math.PI) / 180.0;
    const spinOffset = PLANET_SPIN_OFFSETS[id] || 0;

    let rotRad = 0;
    if (data?.type === 'star') {
      const periodHours = data.rotationPeriodHours || 609.12;
      rotRad = ((2.0 * Math.PI) / periodHours) * simTimeHours;
    } else if (data?.type === 'moon') {
      const periodHours = Math.abs(data.orbitPeriodDays || 27.32) * 24.0;
      const initialPhase = SATELLITE_INITIAL_PHASES[id] || 0;
      const orbitAngle = ((2.0 * Math.PI) / periodHours) * simTimeHours + initialPhase;
      rotRad = -orbitAngle + spinOffset;
    } else if (data) {
      const periodHours = data.rotationPeriodHours || 24.0;
      rotRad = periodHours !== 0 ? ((2.0 * Math.PI) / periodHours) * simTimeHours + spinOffset : 0;
    }

    const qZ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), axialTiltRad);
    const qY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotRad);
    const q = qZ.multiply(qY);
    return [q.x, q.y, q.z, q.w];
  }

  /**
   * 获取天体三轴物理半径 [a, b, c] (公里)
   */
  public getPhysicalRadiiKm(id: BodyId): [number, number, number] {
    if (BodyPoseProvider.TRIAXIAL_RADII_KM[id]) {
      return BodyPoseProvider.TRIAXIAL_RADII_KM[id];
    }
    const r = BodyPoseProvider.PHYSICAL_RADII_KM[id] ?? BODIES[id]?.radiusKm ?? 1000.0;
    return [r, r, r];
  }

  /**
   * 获取单个天体的瞬时完整物理状态 (PhysicalBodyState)
   */
  public getPhysicalBodyState(id: BodyId, simTimeHours: number): PhysicalBodyState {
    const data = BODIES[id];
    const posKm = this.getPhysicalPositionKm(id, simTimeHours);
    const velKmS = this.getPhysicalVelocityKmPerSec(id, simTimeHours);
    const quat = this.getFixedToInertialQuaternion(id, simTimeHours);
    const radii = this.getPhysicalRadiiKm(id);
    const meanRadiusKm = BodyPoseProvider.PHYSICAL_RADII_KM[id] ?? data?.radiusKm ?? 1000.0;
    // 时间基：UTC 秒差 + 固定闰秒/TT 偏移的近似 TDB（见 UTC_TO_TT_APPROX_SEC 注释），非星历级换算
    const tdbSecondsFromJ2000 = BodyPoseProvider.utcSecondsToApproxTdb(
      BodyPoseProvider.BASE_J2000_OFFSET_UTC_SEC + simTimeHours * 3600.0
    );

    return {
      id,
      tdbSecondsFromJ2000,
      positionKm: posKm,
      velocityKmPerSec: velKmS,
      fixedToInertialQuaternion: quat,
      radiiKm: radii,
      meanRadiusKm,
      positionFrameId: BodyPoseProvider.POSITION_FRAME_ID,
      cartographicFrameId: BodyPoseProvider.CARTOGRAPHIC_FRAME_ID,
      quality: 'analytic-approximation',
      sourceVersion: '2026.09-P1-PHYSICS-V2',
    };
  }

  /**
   * 构建太阳系全系统瞬时物理快照 (PhysicalSystemSnapshot)
   */
  public getPhysicalSystemSnapshot(simTimeHours: number): PhysicalSystemSnapshot {
    const bodiesRecord: Record<string, PhysicalBodyState> = {};
    const epochDate = new Date(Date.parse(BodyPoseProvider.BASE_EPOCH_ISO) + simTimeHours * 3600 * 1000);
    const epochIso = epochDate.toISOString();
    const tdbSecondsFromJ2000 = BodyPoseProvider.utcSecondsToApproxTdb(
      BodyPoseProvider.BASE_J2000_OFFSET_UTC_SEC + simTimeHours * 3600.0
    );

    for (const id of Object.keys(BODIES) as BodyId[]) {
      bodiesRecord[id] = this.getPhysicalBodyState(id, simTimeHours);
    }

    return {
      tdbSecondsFromJ2000,
      simTimeHours,
      epochIso,
      bodies: bodiesRecord,
      frameId: BodyPoseProvider.POSITION_FRAME_ID,
    };
  }

  /**
   * 计算天体在当前展示策略与过渡进度下的位置、显示半径与物理太阳向量
   * 采用 Smootherstep 保证二阶导数平滑无跳跃
   */
  public getBodyPose(
    id: BodyId,
    simTimeHours: number
  ): BodyPoseOutput {
    const data = BODIES[id];
    const navRadius = data ? getNavDisplayRadius(data.radiusKm, data.type) : 1.0;
    const physSunDir = this.getPhysicalSunDirection(id, simTimeHours);

    // 默认构图半径（若有星环则扩充）
    let framingRadius = navRadius;
    if (data?.ringConfig) {
      framingRadius = navRadius * data.ringConfig.outerRadiusRatio;
    }

    // 默认宏观导航示意位置
    let navPos = new THREE.Vector3(0, 0, 0);
    if (data?.type === 'planet') {
      const [px, py, pz] = getPlanetNavPosition(id, simTimeHours);
      navPos.set(px, py, pz);
    } else if (data?.type === 'moon') {
      const [mx, my, mz] = getSatelliteNavPosition(id, simTimeHours);
      navPos.set(mx, my, mz);
    }

    // 若完全处于宏观导航模式
    if (this.transitionProgress <= 0.0) {
      return {
        position: navPos,
        displayRadius: navRadius,
        renderSurfaceRadius: navRadius,
        renderFramingRadius: framingRadius,
        policy: 'NAV_SCHEMATIC',
        policyTransitionProgress: 0.0,
        physicalSunDirection: physSunDir,
      };
    }

    // Smootherstep 缓动函数: 6t^5 - 15t^4 + 10t^3
    const t = this.transitionProgress;
    const smoothT = t * t * t * (t * (t * 6 - 15) + 10);

    // 物理观察策略：以参考行星系统为局部基准标尺线性化（P1 泛化：地月/木星系/土星系等同一规则）
    if (id === this.physicalReferenceBodyId) {
      // 参考行星本尊保持导航位置与半径，作为本系统局部物理坐标系的基准标尺
      // （R3-b：framingRadius 保留星环构图范围——改前参考行星丢环，土星作参考
      // 时相机按本体取景会把环裁掉）
      return {
        position: navPos,
        displayRadius: navRadius,
        renderSurfaceRadius: navRadius,
        renderFramingRadius: framingRadius,
        policy: this.currentPolicy,
        policyTransitionProgress: this.transitionProgress,
        physicalSunDirection: physSunDir,
      };
    }

    if (data?.type === 'moon' && data.parentId === this.physicalReferenceBodyId) {
      const parentData = BODIES[this.physicalReferenceBodyId];
      const parentNavRadius = getNavDisplayRadius(parentData.radiusKm, parentData.type);
      const parentPhysRadiusKm =
        BodyPoseProvider.PHYSICAL_RADII_KM[this.physicalReferenceBodyId] ?? parentData.radiusKm;
      const moonPhysRadiusKm = BodyPoseProvider.PHYSICAL_RADII_KM[id] ?? data.radiusKm;

      // 物理真实比例换算：卫星半径与轨道距离都以参考行星的导航显示半径为统一标尺
      const physMoonRadius = parentNavRadius * (moonPhysRadiusKm / parentPhysRadiusKm);
      const physDistanceScene =
        parentNavRadius * (data.orbitSemiMajorAxisKm / parentPhysRadiusKm);

      // 保持当前公转航向角方向
      const orbitDir = navPos.clone().normalize();
      if (orbitDir.lengthSq() < 1e-4) {
        orbitDir.set(1, 0, 0);
      }
      const physMoonPos = orbitDir.multiplyScalar(physDistanceScene);

      // 插值位置与半径
      const blendedPos = navPos.clone().lerp(physMoonPos, smoothT);
      const blendedRadius = THREE.MathUtils.lerp(navRadius, physMoonRadius, smoothT);

      return {
        position: blendedPos,
        displayRadius: blendedRadius,
        renderSurfaceRadius: blendedRadius,
        renderFramingRadius: blendedRadius,
        policy: this.currentPolicy,
        policyTransitionProgress: this.transitionProgress,
        physicalSunDirection: physSunDir,
      };
    }

    // 其他天体平滑保持原有导航位置
    return {
      position: navPos,
      displayRadius: navRadius,
      renderSurfaceRadius: navRadius,
      renderFramingRadius: framingRadius,
      policy: this.currentPolicy,
      policyTransitionProgress: this.transitionProgress,
      physicalSunDirection: physSunDir,
    };
  }

  /**
   * 构建同一次观察的权威快照 (ObservationFrame)
   */
  public buildObservationFrame(
    simTimeHours: number,
    observer?: {
      anchor: CameraAnchor;
      position: [number, number, number];
      lookTarget?: CameraLookTarget;
    }
  ): ObservationFrame {
    const bodiesMap = new Map<BodyId, BodyPhysicalState>();
    const epochDate = new Date(Date.parse(BodyPoseProvider.BASE_EPOCH_ISO) + simTimeHours * 3600 * 1000);
    const epochIso = epochDate.toISOString();

    for (const id of Object.keys(BODIES) as BodyId[]) {
      const data = BODIES[id];
      const posKm = this.getPhysicalPositionKm(id, simTimeHours);
      const velKmS = this.getPhysicalVelocityKmPerSec(id, simTimeHours);
      const pose = this.getBodyPose(id, simTimeHours);
      const sunDir = this.getPhysicalSunDirection(id, simTimeHours);

      bodiesMap.set(id, {
        bodyId: id,
        epochIso,
        epochTdbSeconds: BodyPoseProvider.utcSecondsToApproxTdb(
          BodyPoseProvider.BASE_J2000_OFFSET_UTC_SEC + simTimeHours * 3600
        ),
        positionKm: posKm,
        velocityKmPerSec: velKmS,
        apparentRadiusKm: BodyPoseProvider.PHYSICAL_RADII_KM[id] ?? data.radiusKm,
        renderPosition: [pose.position.x, pose.position.y, pose.position.z],
        renderSurfaceRadius: pose.renderSurfaceRadius,
        renderFramingRadius: pose.renderFramingRadius,
        sourceFrame: BodyPoseProvider.POSITION_FRAME_ID,
        orientationSource: 'analytic-approximation',
        physicalSunDirection: [sunDir.x, sunDir.y, sunDir.z],
      });
    }

    return {
      sequence: ++this.frameSequence,
      simulationTime: {
        epochIso,
        simTimeHours,
        elapsedSeconds: simTimeHours * 3600,
        timeBasis: 'UTC-SIMULATED-HOURS',
      },
      presentation: {
        policy: this.currentPolicy,
        blend: this.transitionProgress,
        referenceBodyId: this.currentPolicy === 'PHYSICAL_OBSERVATION' ? this.physicalReferenceBodyId : null,
      },
      bodies: bodiesMap,
      observer,
    };
  }
}

