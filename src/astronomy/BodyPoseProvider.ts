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
import {
  BODIES,
  getPlanetNavPosition,
  getSatelliteNavPosition,
  getNavDisplayRadius,
} from './bodies';

export type PresentationPolicy = 'NAV_SCHEMATIC' | 'PHYSICAL_OBSERVATION';

export interface BodyPhysicalState {
  bodyId: BodyId;
  epochIso: string;
  epochTdbSeconds: number;
  positionKm: [number, number, number];
  velocityKmPerSec: [number, number, number];
  apparentRadiusKm: number;
  sourceFrame: string;
}

export interface BodyPoseOutput {
  position: THREE.Vector3;
  displayRadius: number;
  policy: PresentationPolicy;
  policyTransitionProgress: number; // 0 (NAV) ~ 1 (PHYSICAL)
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
   * 计算天体在当前展示策略与过渡进度下的位置与显示半径
   * 采用 Smootherstep 保证二阶导数平滑无跳跃
   */
  public getBodyPose(
    id: BodyId,
    simTimeHours: number
  ): BodyPoseOutput {
    const data = BODIES[id];
    const navRadius = data ? getNavDisplayRadius(data.radiusKm, data.type) : 1.0;

    // 默认宏观导航示意位置
    let navPos = new THREE.Vector3(0, 0, 0);
    if (data.type === 'planet') {
      const [px, py, pz] = getPlanetNavPosition(id, simTimeHours);
      navPos.set(px, py, pz);
    } else if (data.type === 'moon') {
      const [mx, my, mz] = getSatelliteNavPosition(id, simTimeHours);
      navPos.set(mx, my, mz);
    }

    // 若完全处于宏观导航模式
    if (this.transitionProgress <= 0.0) {
      return {
        position: navPos,
        displayRadius: navRadius,
        policy: 'NAV_SCHEMATIC',
        policyTransitionProgress: 0.0,
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
        policy: this.currentPolicy,
        policyTransitionProgress: this.transitionProgress,
      };
    }

    if (id === 'moon') {
      // 物理真实比例换算：
      // 地球基准显示半径为 1.35
      // 真实半径比: 1737.4 / 6371.0 ≈ 0.2727044
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
        policy: this.currentPolicy,
        policyTransitionProgress: this.transitionProgress,
      };
    }

    // 其他天体平滑保持原有导航位置
    return {
      position: navPos,
      displayRadius: navRadius,
      policy: this.currentPolicy,
      policyTransitionProgress: this.transitionProgress,
    };
  }
}
