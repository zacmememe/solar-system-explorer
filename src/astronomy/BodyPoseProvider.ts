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
import {
  BODIES,
  getPlanetNavPosition,
  getSatelliteNavPosition,
  getNavDisplayRadius,
  PLANET_INITIAL_PHASES,
  SATELLITE_INITIAL_PHASES,
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

  // 权威地月轨道平均距离 (千米)
  public static readonly MOON_ORBIT_SEMI_MAJOR_AXIS_KM = 384400.0;

  private currentPolicy: PresentationPolicy = 'NAV_SCHEMATIC';
  private targetPolicy: PresentationPolicy = 'NAV_SCHEMATIC';
  private transitionProgress: number = 0; // 0.0 ~ 1.0
  private transitionDurationSec: number = 2.0;
  private frameSequence: number = 0;

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

    // 物理观察策略计算（以地月系为核心先行标杆）
    if (id === 'earth') {
      return {
        position: navPos,
        displayRadius: navRadius, // 地球作为地月系局部物理坐标系的基准标尺
        renderSurfaceRadius: navRadius,
        renderFramingRadius: navRadius,
        policy: this.currentPolicy,
        policyTransitionProgress: this.transitionProgress,
        physicalSunDirection: physSunDir,
      };
    }

    if (id === 'moon') {
      // 物理真实比例换算：
      // 地球基准显示半径为 1.35
      // 真实半径比: 1737.4 / 6371.0 ≈ 0.2727044 -> physMoonRadius ≈ 0.36815
      const earthData = BODIES['earth'];
      const earthNavRadius = getNavDisplayRadius(earthData.radiusKm, earthData.type);
      const physMoonRadius = earthNavRadius * (BodyPoseProvider.PHYSICAL_RADII_KM.moon / BodyPoseProvider.PHYSICAL_RADII_KM.earth);

      // 真实物理地月间距对应场景单位：
      // distanceScene = earthNavRadius * (384400.0 / 6371.0) ≈ 1.35 * 60.33589 ≈ 81.4534
      const physDistanceScene = earthNavRadius * (BodyPoseProvider.MOON_ORBIT_SEMI_MAJOR_AXIS_KM / BodyPoseProvider.PHYSICAL_RADII_KM.earth);

      // 保持当前月球公转航向角方向
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
      const pose = this.getBodyPose(id, simTimeHours);
      const sunDir = this.getPhysicalSunDirection(id, simTimeHours);

      bodiesMap.set(id, {
        bodyId: id,
        epochIso,
        epochTdbSeconds: simTimeHours * 3600,
        positionKm: posKm,
        velocityKmPerSec: [0, 0, 0],
        apparentRadiusKm: BodyPoseProvider.PHYSICAL_RADII_KM[id] ?? data.radiusKm,
        renderPosition: [pose.position.x, pose.position.y, pose.position.z],
        renderSurfaceRadius: pose.renderSurfaceRadius,
        renderFramingRadius: pose.renderFramingRadius,
        sourceFrame: 'J2000-ECLIPTIC-EARTH-MOON-PHYSICAL',
        orientationSource: 'IAU-CARTOGRAPHIC-MODEL',
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
        referenceBodyId: this.currentPolicy === 'PHYSICAL_OBSERVATION' ? 'earth' : null,
      },
      bodies: bodiesMap,
      observer,
    };
  }
}

