/**
 * 单一相机控制器 CameraController
 * 严格遵循 01-REBUILD-PLAN.zh-CN.md 与 AGENTS.md：
 * 1. 唯一相机写入者；
 * 2. 严禁空闲自动回正；
 * 3. 飞行支持用户拖拽瞬时打断；
 * 4. 递增 commandId 防竞态；
 * 5. 跟随目标平移，不跟随天体自转。
 */

import * as THREE from 'three';
import type { BodyId } from '../contracts/body';
import type { CameraCommand, CameraMode, CameraStateSnapshot, CameraAnchor, CameraLookTarget } from '../contracts/camera';
import { BODIES, getNavDisplayRadius } from '../astronomy/bodies';
import { TerrainHeightProvider } from '../surface/TerrainHeightProvider';

export interface CameraControllerOptions {
  camera: THREE.PerspectiveCamera;
  minDistanceFactor?: number;
  maxDistanceFactor?: number;
}

export class CameraController {
  private camera: THREE.PerspectiveCamera;
  private mode: CameraMode = 'ORBIT_TARGET';
  private anchor: CameraAnchor = { kind: 'body', bodyId: 'earth' };
  private lookTarget: CameraLookTarget = { kind: 'center' };
  private targetBodyId: BodyId = 'earth';
  private selectedBodyId: BodyId = 'earth';
  private sourceBodyId: BodyId | null = 'earth';

  // 地面原地环顾姿态 (SURFACE_LOOK 模式)
  private surfaceYawDeg: number = 225.0; // 默认朝向西南偏南 (正对月面看地球方向)
  private surfacePitchDeg: number = 12.0; // 默认轻微平视山谷地平线
  private latestGetBodyPos?: (id: BodyId) => {
    pos: THREE.Vector3;
    radius: number;
    surfaceRadius?: number;
    framingRadius?: number;
  };

  // 观察状态（球坐标：相对于 targetPosition）
  private targetPosition: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  private spherical: THREE.Spherical = new THREE.Spherical(6.2, Math.PI / 2.22, Math.PI / 4);
  private minDistance: number = 7.5;
  private maxDistance: number = 800;

  // 对数间距与时间衰减平滑状态 (B1 连续无级缩放内核)
  // 分离物理地表半径、全景观赏构图半径与安全避障净空 (CAM-04)
  private surfaceRadius: number = 2.0;
  private framingRadius: number = 2.0;
  private collisionClearance: number = 0.04;
  private readonly shift: number = 1.0;
  private qActual: number = Math.log(6.2 + 1.0);
  private qTarget: number = Math.log(6.2 + 1.0);
  private lastInputSign: number = 0;
  private readonly tauSec: number = 0.09; // 90ms 指数衰减时间常数

  // 飞行过渡动画状态
  private isTransitioning: boolean = false;
  private transitionStartSpherical: THREE.Spherical = new THREE.Spherical();
  private transitionTargetSpherical: THREE.Spherical = new THREE.Spherical();
  private transitionStartTargetPos: THREE.Vector3 = new THREE.Vector3();
  private transitionTargetTargetPos: THREE.Vector3 = new THREE.Vector3();
  private transitionProgress: number = 0; // 0 to 1
  private transitionDurationSec: number = 2.5;

  // 命令令牌，防止异步与旧动画干扰
  private currentCommandId: number = 0;

  private reduceMotion: boolean = false;

  constructor(options: CameraControllerOptions) {
    this.camera = options.camera;
    this.syncLogDollyFromRadius();
    this.updateCameraTransform();
  }

  public setReduceMotion(enabled: boolean): void {
    this.reduceMotion = enabled;
  }

  public isReduceMotion(): boolean {
    return this.reduceMotion;
  }

  public getSnapshot(): CameraStateSnapshot {
    return {
      mode: this.mode,
      anchor: this.anchor,
      lookTarget: this.lookTarget,
      surfaceOrientation: {
        yawDeg: this.surfaceYawDeg,
        pitchDeg: this.surfacePitchDeg,
      },
      targetBodyId: this.anchor.kind === 'body' || this.anchor.kind === 'surface' ? this.anchor.bodyId : this.targetBodyId,
      selectedBodyId: this.selectedBodyId,
      sourceBodyId: this.sourceBodyId,
      transitionProgress: this.transitionProgress,
      distanceToTarget: this.spherical.radius,
      minDistance: this.minDistance,
      maxDistance: this.maxDistance,
      commandId: this.currentCommandId,
      isTransitioning: this.isTransitioning,
      spherical: {
        radius: this.spherical.radius,
        phi: this.spherical.phi,
        theta: this.spherical.theta,
      },
    };
  }

  public setLookTarget(lookTarget: CameraLookTarget): void {
    this.lookTarget = lookTarget;
    this.updateCameraTransform();
  }

  public getLookTarget(): CameraLookTarget {
    return this.lookTarget;
  }

  public getMinDistance(): number {
    return this.minDistance;
  }

  /**
   * 处理相机外部命令
   */
  public executeCommand(command: CameraCommand): number {
    const token = ++this.currentCommandId;

    switch (command.type) {
      case 'select':
        this.selectedBodyId = command.bodyId;
        break;

      case 'flyTo': {
        const dur = command.durationSec ?? (this.reduceMotion ? 0.15 : 2.5);
        this.lookTarget = command.lookTarget ?? { kind: 'center' };
        this.initiateFlight(command.bodyId, dur, token, command.targetPos);
        break;
      }

      case 'setLookTarget': {
        this.lookTarget = command.lookTarget;
        this.updateCameraTransform();
        break;
      }

      case 'cancelFlight':
        this.cancelFlight();
        break;

      case 'orbit':
        // 用户主动操作，若正在飞行则立即打断
        if (this.isTransitioning) {
          this.cancelFlight();
        }
        if (this.mode === 'SURFACE_LOOK') {
          // 地表第一人称视线环顾：水平拖拽转动 yaw (360°)，垂直拖拽调整 pitch (±85°)
          this.surfaceYawDeg = THREE.MathUtils.euclideanModulo(
            this.surfaceYawDeg - command.deltaTheta * (180 / Math.PI),
            360
          );
          this.surfacePitchDeg = Math.max(
            -85,
            Math.min(85, this.surfacePitchDeg - command.deltaPhi * (180 / Math.PI))
          );
          this.lookTarget = { kind: 'center' }; // 用户手动环顾时解除特定天体视线锁定
          this.updateCameraTransform();
          break;
        }
        this.spherical.theta -= command.deltaTheta;
        this.spherical.phi = Math.max(0.01, Math.min(Math.PI - 0.01, this.spherical.phi - command.deltaPhi));
        this.spherical.makeSafe();
        this.updateCameraTransform();
        break;

      case 'zoomInput':
        if (this.isTransitioning) {
          this.cancelFlight();
        }
        if (this.mode === 'SURFACE_LOOK') {
          break; // 地面人眼停驻状态下不响应宏观对数 Dolly
        }
        this.applyLogDollyInput(command.logDelta);
        this.updateCameraTransform();
        break;

      case 'zoom':
        if (this.isTransitioning) {
          this.cancelFlight();
        }
        if (this.mode === 'SURFACE_LOOK') {
          break;
        }
        // 兼容旧 zoom 命令：将绝对距离转为等效相对 logDelta，避免突跳触底
        this.applyLogDollyInput(command.deltaDist / Math.max(1.0, this.spherical.radius));
        this.updateCameraTransform();
        break;

      case 'enterSurfaceLook': {
        if (this.isTransitioning) {
          this.cancelFlight();
        }
        this.mode = 'SURFACE_LOOK';
        this.anchor = {
          kind: 'surface',
          bodyId: command.bodyId,
          lat: command.lat,
          lon: command.lon,
          eyeHeightM: command.eyeHeightM ?? 1.7,
        };
        this.targetBodyId = command.bodyId;
        this.selectedBodyId = command.bodyId;
        if (command.initialYawDeg !== undefined) {
          this.surfaceYawDeg = command.initialYawDeg;
        }
        if (command.initialPitchDeg !== undefined) {
          this.surfacePitchDeg = command.initialPitchDeg;
        }
        this.lookTarget = { kind: 'center' };
        this.updateCameraTransform();
        break;
      }

      case 'setSurfaceLook': {
        if (this.mode === 'SURFACE_LOOK') {
          this.surfaceYawDeg = THREE.MathUtils.euclideanModulo(command.yawDeg, 360);
          this.surfacePitchDeg = Math.max(-85, Math.min(85, command.pitchDeg));
          this.lookTarget = { kind: 'center' };
          this.updateCameraTransform();
        }
        break;
      }

      case 'lookAtSkyTarget': {
        if (this.mode === 'SURFACE_LOOK') {
          this.lookTarget = { kind: 'body', bodyId: command.targetBodyId };
          this.updateCameraTransform();
        }
        break;
      }

      case 'overview': {
        const dur = this.reduceMotion ? 0.15 : 2.5;
        this.lookTarget = { kind: 'center' };
        this.initiateOverviewFlight(token, dur);
        break;
      }

      case 'restoreBookmark': {
        const dur = command.durationSec ?? (this.reduceMotion ? 0.15 : 2.5);
        this.lookTarget = command.lookTarget ?? { kind: 'center' };
        this.initiateBookmarkFlight(command.targetBodyId, command.spherical, dur, token);
        break;
      }

      case 'focusRegion': {
        const dur = command.durationSec ?? (this.reduceMotion ? 0.15 : 2.5);
        this.lookTarget = { kind: 'center' };
        this.initiateFocusRegionFlight(
          command.bodyId,
          command.lat,
          command.lon,
          command.altitude ?? 0.08,
          dur,
          token
        );
        break;
      }
    }

    return token;
  }

  /**
   * 设置目标在场景中的最新物理位置（支持运动天体跟随平移）
   */
  public updateTargetPosition(targetPos: THREE.Vector3, targetRadius: number): void {
    if (!this.isTransitioning && this.anchor.kind === 'body') {
      this.targetPosition.copy(targetPos);
      this.surfaceRadius = targetRadius;
      this.collisionClearance = Math.max(0.01, targetRadius * 0.02);
      this.minDistance = Math.max(0.1, targetRadius + this.collisionClearance);
      this.maxDistance = Math.max(100, targetRadius * 100);
      if (this.spherical.radius < this.minDistance) {
        this.spherical.radius = this.minDistance;
      }
      this.updateCameraTransform();
    }
  }

  /**
   * 直接设置球坐标 (用于特定视角定向如 ROI 特写或书签直达)，保持单一相机控制器约束
   */
  public setSphericalDirect(radius: number, phi: number, theta: number): void {
    if (this.isTransitioning) {
      this.cancelFlight();
    }
    this.spherical.radius = THREE.MathUtils.clamp(radius, this.minDistance, this.maxDistance);
    this.spherical.phi = Math.max(0.01, Math.min(Math.PI - 0.01, phi));
    this.spherical.theta = theta;
    this.spherical.makeSafe();
    this.syncLogDollyFromRadius();
    this.updateCameraTransform();
  }

  /**
   * 启动飞向指定天体动画
   * 采用真实天文导引：将相机精准导引至向阳面（Sunlit Side）并形成绝美侧光立体阴影
   */
  private initiateFlight(
    targetId: BodyId,
    durationSec: number,
    token: number,
    targetPos?: [number, number, number]
  ): void {
    if (token !== this.currentCommandId) return;

    this.sourceBodyId = this.targetBodyId || this.selectedBodyId || 'earth';
    this.isTransitioning = true;
    this.mode = 'TRANSITION';
    this.targetBodyId = targetId;
    this.selectedBodyId = targetId;
    this.anchor = { kind: 'body', bodyId: targetId };
    this.transitionDurationSec = Number.isFinite(durationSec) ? Math.max(0.05, durationSec) : (this.reduceMotion ? 0.15 : 2.5);
    this.transitionProgress = 0;

    this.transitionStartSpherical.copy(this.spherical);
    this.transitionStartTargetPos.copy(this.targetPosition);

    // 计算合理的目标观察距离（留白构图：天体占据视口约 45%~55% 高度，避免压迫感，并给卫星留下优雅环绕空间）
    const vFovRad = THREE.MathUtils.degToRad(this.camera.fov);
    const hFovRad = 2 * Math.atan(Math.tan(vFovRad / 2) * Math.max(0.2, this.camera.aspect));
    const limitingFovRad = Math.min(vFovRad, hFovRad);

    const body = BODIES[targetId];
    let baseRadius = 1.4;
    if (body) {
      if (body.type === 'star') {
        baseRadius = 7.0; // 太阳特写尺寸
      } else {
        baseRadius = getNavDisplayRadius(body.radiusKm, body.type);
        if (body.ringConfig) {
          baseRadius *= body.ringConfig.outerRadiusRatio;
        }
      }
    }
    baseRadius = Math.max(0.8, baseRadius);

    const framingFactor = body?.type === 'moon' ? 1.40 : 1.65;
    const targetDist = Math.max(
      baseRadius * 1.8,
      (baseRadius / Math.sin(limitingFovRad / 2)) * framingFactor
    );

    let targetTheta = this.spherical.theta + 0.25;
    let targetPhi = Math.PI / 2.22;

    // 太阳位于原点 (0, 0, 0)。
    // 行星指向太阳的矢量为 -P_target。
    // 在 Three.js 球坐标系中 (x = r sin(phi) sin(theta), z = r sin(phi) cos(theta))：
    // 向阳方向的方位角 theta_sun = atan2(-Px, -Pz)。
    // 偏转 24° (0.42 rad) 形成绝美 3/4 凸月盈亏立体侧光，太阳位于视线斜后方，杜绝逆光死黑！
    if (targetPos && targetId !== 'sun') {
      const px = targetPos[0];
      const pz = targetPos[2];
      const distFromSun = Math.sqrt(px * px + pz * pz);
      if (distFromSun > 0.01) {
        const thetaSun = Math.atan2(-px, -pz);
        targetTheta = thetaSun + 0.42;
        targetPhi = Math.PI / 2.22;
      }
    }

    // 计算最短球面角路径，杜绝跨越 2PI 缝隙产生多圈剧烈乱转
    const deltaTheta = THREE.MathUtils.euclideanModulo(targetTheta - this.spherical.theta + Math.PI, 2 * Math.PI) - Math.PI;
    const finalTheta = this.spherical.theta + deltaTheta;

    this.transitionTargetSpherical.set(
      targetDist,
      targetPhi,
      finalTheta
    );
  }

  /**
   * 启动飞向太阳系全景（Overview）
   */
  private initiateOverviewFlight(token: number, durationSec: number = 2.5): void {
    if (token !== this.currentCommandId) return;

    this.sourceBodyId = this.targetBodyId || this.selectedBodyId || 'earth';
    this.isTransitioning = true;
    this.mode = 'TRANSITION';
    this.targetBodyId = 'sun';
    this.selectedBodyId = 'sun';
    this.anchor = { kind: 'body', bodyId: 'sun' };
    this.transitionDurationSec = Number.isFinite(durationSec) ? Math.max(0.05, durationSec) : (this.reduceMotion ? 0.15 : 2.5);
    this.transitionProgress = 0;

    this.transitionStartSpherical.copy(this.spherical);
    this.transitionStartTargetPos.copy(this.targetPosition);

    this.transitionTargetTargetPos.set(0, 0, 0);
    this.transitionTargetSpherical.set(280, Math.PI / 3.2, Math.PI / 4);
  }

  /**
   * 启动恢复书签/观察点飞行动画
   */
  private initiateBookmarkFlight(
    targetId: BodyId,
    targetSpherical: { radius: number; phi: number; theta: number },
    durationSec: number,
    token: number
  ): void {
    if (token !== this.currentCommandId) return;

    this.sourceBodyId = this.targetBodyId || this.selectedBodyId || 'earth';
    this.isTransitioning = true;
    this.mode = 'TRANSITION';
    this.targetBodyId = targetId;
    this.selectedBodyId = targetId;
    this.anchor = { kind: 'body', bodyId: targetId };
    this.transitionDurationSec = Number.isFinite(durationSec) ? Math.max(0.05, durationSec) : (this.reduceMotion ? 0.15 : 2.5);
    this.transitionProgress = 0;

    this.transitionStartSpherical.copy(this.spherical);
    this.transitionStartTargetPos.copy(this.targetPosition);
    this.transitionTargetSpherical.set(
      targetSpherical.radius,
      targetSpherical.phi,
      targetSpherical.theta
    );
  }

  /**
   * 启动飞向特定地表地理区域 (focusRegion)
   * 严格遵循 R2 规范：
   * 1. 结合经纬度计算真实地表法线单位向量；
   * 2. 转换为相机的目标 (radius, phi, theta) 球坐标；
   * 3. 目标高度为 surfaceRadius + altitude，且不低于 minDistance；
   * 4. 执行可打断的平滑飞行插值。
   */
  private initiateFocusRegionFlight(
    targetId: BodyId,
    lat: number,
    lon: number,
    altitude: number,
    durationSec: number,
    token: number
  ): void {
    if (token !== this.currentCommandId) return;

    this.sourceBodyId = this.targetBodyId || this.selectedBodyId || 'earth';
    this.isTransitioning = true;
    this.mode = 'TRANSITION';
    this.targetBodyId = targetId;
    this.selectedBodyId = targetId;
    this.anchor = { kind: 'body', bodyId: targetId };
    this.transitionDurationSec = Number.isFinite(durationSec)
      ? Math.max(0.05, durationSec)
      : (this.reduceMotion ? 0.15 : 2.5);
    this.transitionProgress = 0;

    this.transitionStartSpherical.copy(this.spherical);
    this.transitionStartTargetPos.copy(this.targetPosition);

    // 计算地表渲染法线方向向量
    // 与 SurfaceTileScheme.latLonToCartesian 一致的基：
    // x = cos(lat) * cos(lon)
    // y = sin(lat)
    // z = -cos(lat) * sin(lon)
    const latRad = THREE.MathUtils.degToRad(lat);
    const lonRad = THREE.MathUtils.degToRad(lon);
    const cosLat = Math.cos(latRad);
    const normal = new THREE.Vector3(
      cosLat * Math.cos(lonRad),
      Math.sin(latRad),
      -cosLat * Math.sin(lonRad)
    ).normalize();

    // 转换为 Three.js 球坐标 (r, phi, theta)
    const targetSph = new THREE.Spherical().setFromVector3(normal);

    // 目标半径：物理地表半径 + altitude 净高度
    const safeAltitude = Math.max(this.collisionClearance, altitude);
    const targetRadius = Math.max(this.minDistance, this.surfaceRadius + safeAltitude);
    targetSph.radius = targetRadius;

    // 最短球面角路径，防止跨周期大圈翻转
    const deltaTheta =
      THREE.MathUtils.euclideanModulo(targetSph.theta - this.spherical.theta + Math.PI, 2 * Math.PI) - Math.PI;
    const finalTheta = this.spherical.theta + deltaTheta;

    this.transitionTargetSpherical.set(
      targetRadius,
      Math.max(0.01, Math.min(Math.PI - 0.01, targetSph.phi)),
      finalTheta
    );
  }

  /**
   * 立即取消飞行，保持当前视角与控制权归还用户
   * 核心修复：自由锚点基于当前实际距离设立合法范围，彻底杜绝继承小天体微观限距导致内跳！
   */
  public cancelFlight(): void {
    if (this.isTransitioning) {
      this.isTransitioning = false;
      this.mode = 'ORBIT_TARGET';
      this.anchor = {
        kind: 'free',
        pivotScene: [this.targetPosition.x, this.targetPosition.y, this.targetPosition.z],
      };
      // 自由观察状态下的宽阔安全限距范围
      this.minDistance = 0.5;
      this.maxDistance = Math.max(20000, this.spherical.radius * 3);
      this.surfaceRadius = 0;
      this.syncLogDollyFromRadius();
      this.updateCameraTransform();
    }
  }

  /**
   * 同步对数间距状态机，使其与当前 spherical.radius 保持一致
   */
  private syncLogDollyFromRadius(): void {
    const isBody = this.anchor.kind === 'body';
    const effectiveSurface = isBody ? this.surfaceRadius : 0;
    const h = Math.max(0.01, this.spherical.radius - effectiveSurface);
    this.qActual = Math.log(h + this.shift);
    this.qTarget = this.qActual;
    this.lastInputSign = 0;
  }

  /**
   * 应用无量纲对数缩放输入
   * 反向输入立即清空旧方向 pending 目标，下一帧即刻反向
   */
  public applyLogDollyInput(logDelta: number): void {
    if (!Number.isFinite(logDelta) || logDelta === 0) return;
    const sign = Math.sign(logDelta);
    if (this.lastInputSign !== 0 && sign !== this.lastInputSign) {
      this.qTarget = this.qActual;
    }
    this.lastInputSign = sign;

    const isBody = this.anchor.kind === 'body';
    const effectiveSurface = isBody ? this.surfaceRadius : 0;
    const minClearance = Math.max(0.01, this.minDistance - effectiveSurface);
    const maxClearance = Math.max(minClearance + 1.0, this.maxDistance - effectiveSurface);

    const minQ = Math.log(minClearance + this.shift);
    const maxQ = Math.log(maxClearance + this.shift);

    this.qTarget = Math.max(minQ, Math.min(maxQ, this.qTarget + logDelta));
  }

  /**
   * 每帧由单一 render loop 调用，更新相机位置与平滑缓动
   */
  public update(
    deltaSec: number,
    getBodyPos?: (id: BodyId) => {
      pos: THREE.Vector3;
      radius: number;
      surfaceRadius?: number;
      framingRadius?: number;
    }
  ): void {
    type BodyWorldOutput = {
      pos: THREE.Vector3;
      radius: number;
      surfaceRadius?: number;
      framingRadius?: number;
    };
    if (getBodyPos) {
      this.latestGetBodyPos = getBodyPos;
    }
    const getPos: (id: BodyId) => BodyWorldOutput =
      getBodyPos ??
      this.latestGetBodyPos ??
      ((_id: BodyId): BodyWorldOutput => ({
        pos: this.targetPosition,
        radius: this.surfaceRadius,
        surfaceRadius: this.surfaceRadius,
        framingRadius: this.framingRadius,
      }));

    if (this.mode === 'SURFACE_LOOK' && this.anchor.kind === 'surface') {
      const targetInfo = getPos(this.anchor.bodyId);
      this.targetPosition.copy(targetInfo.pos);
      this.surfaceRadius = targetInfo.surfaceRadius ?? targetInfo.radius;
      this.framingRadius = targetInfo.framingRadius ?? targetInfo.radius;
      this.updateCameraTransform();
      return;
    }

    if (this.isTransitioning) {
      this.transitionProgress += deltaSec / this.transitionDurationSec;
      if (this.transitionProgress >= 1.0) {
        this.transitionProgress = 1.0;
        this.isTransitioning = false;
        this.mode = 'ORBIT_TARGET';
        this.anchor = { kind: 'body', bodyId: this.targetBodyId };
        const targetInfo = getPos(this.targetBodyId);
        this.surfaceRadius = targetInfo.surfaceRadius ?? targetInfo.radius;
        this.framingRadius = targetInfo.framingRadius ?? targetInfo.radius;
        this.collisionClearance = Math.max(0.01, this.surfaceRadius * 0.02);
        this.minDistance = Math.max(0.1, this.surfaceRadius + this.collisionClearance);
        this.maxDistance = this.framingRadius * 100;
        this.syncLogDollyFromRadius();
      }

      // Perlin Smootherstep 极佳丝滑缓动: 6t^5 - 15t^4 + 10t^3 (一阶二阶导数在起终点均为0)
      const t = this.transitionProgress;
      const easeT = t * t * t * (t * (t * 6 - 15) + 10);

      const targetInfo = getPos(this.targetBodyId);
      this.targetPosition.lerpVectors(this.transitionStartTargetPos, targetInfo.pos, easeT);

      this.spherical.radius = THREE.MathUtils.lerp(
        this.transitionStartSpherical.radius,
        this.transitionTargetSpherical.radius,
        easeT
      );
      this.spherical.phi = THREE.MathUtils.lerp(
        this.transitionStartSpherical.phi,
        this.transitionTargetSpherical.phi,
        easeT
      );
      this.spherical.theta = THREE.MathUtils.lerp(
        this.transitionStartSpherical.theta,
        this.transitionTargetSpherical.theta,
        easeT
      );
      this.spherical.makeSafe();

      this.surfaceRadius = targetInfo.surfaceRadius ?? targetInfo.radius;
      this.framingRadius = targetInfo.framingRadius ?? targetInfo.radius;
      this.collisionClearance = Math.max(0.01, this.surfaceRadius * 0.02);
      this.minDistance = Math.max(0.1, this.surfaceRadius + this.collisionClearance);
      this.maxDistance = this.framingRadius * 100;
      this.syncLogDollyFromRadius();
    } else {
      // 处于目标观察模式：跟随天体物理平移或保持自由观察锚点
      if (this.anchor.kind === 'body') {
        const targetInfo = getPos(this.anchor.bodyId);
        this.targetPosition.copy(targetInfo.pos);
        this.surfaceRadius = targetInfo.surfaceRadius ?? targetInfo.radius;
        this.framingRadius = targetInfo.framingRadius ?? targetInfo.radius;
        this.collisionClearance = Math.max(0.01, this.surfaceRadius * 0.02);
        this.minDistance = Math.max(0.1, this.surfaceRadius + this.collisionClearance);
        this.maxDistance = this.framingRadius * 100;
      } else if (this.anchor.kind === 'surface') {
        const targetInfo = getPos(this.anchor.bodyId);
        this.targetPosition.copy(targetInfo.pos);
        this.surfaceRadius = targetInfo.surfaceRadius ?? targetInfo.radius;
        this.framingRadius = targetInfo.framingRadius ?? targetInfo.radius;
      } else {
        this.targetPosition.set(this.anchor.pivotScene[0], this.anchor.pivotScene[1], this.anchor.pivotScene[2]);
        this.surfaceRadius = 0;
        this.framingRadius = 0;
        this.collisionClearance = 0.01;
        this.minDistance = 0.5;
        this.maxDistance = Math.max(20000, this.spherical.radius * 3);
      }

      // 连续无级对数平滑跟随 (帧率无关指数衰减跟随)
      if (deltaSec > 0 && Math.abs(this.qTarget - this.qActual) > 1e-6) {
        const decayFactor = -Math.expm1(-deltaSec / this.tauSec);
        this.qActual += (this.qTarget - this.qActual) * decayFactor;
        const currentClearance = Math.exp(this.qActual) - this.shift;
        const effectiveSurface = this.anchor.kind === 'body' ? this.surfaceRadius : 0;
        this.spherical.radius = THREE.MathUtils.clamp(
          currentClearance + effectiveSurface,
          this.minDistance,
          this.maxDistance
        );
      }
    }

    this.updateCameraTransform();
  }

  /**
   * 依据当前相机到物理地表的净高度计算动态近裁剪面 (CAM-04)
   * near = min(nearMax, clearance / 4), 且不低于 nearFloor
   */
  public static nearFromClearance(clearance: number, nearMax = 0.1, nearFloor = 1e-4): number {
    if (!Number.isFinite(clearance) || clearance <= 0) {
      return nearFloor;
    }
    return Math.max(nearFloor, Math.min(nearMax, clearance * 0.25));
  }

  /**
   * 写入 Three.js Camera 变换与动态近裁剪面自适应调度 (CAM-04)
   * 唯一相机写入者！支持 lookTarget 视线朝向解耦
   */
  private updateCameraTransform(): void {
    if (this.mode === 'SURFACE_LOOK' && this.anchor.kind === 'surface') {
      const heightProvider = TerrainHeightProvider.getInstance();
      const localSurfacePt = heightProvider.latLonToVector3(
        this.anchor.bodyId,
        this.anchor.lat,
        this.anchor.lon,
        this.surfaceRadius
      );

      // 计算地表局部正交天顶/切线基向量 (u: 天顶 Up, e: 正东 East, n: 正北 North)
      const latRad = THREE.MathUtils.degToRad(this.anchor.lat);
      const lonRad = THREE.MathUtils.degToRad(this.anchor.lon);
      const cosLat = Math.cos(latRad);
      const u = new THREE.Vector3(
        cosLat * Math.cos(lonRad),
        Math.sin(latRad),
        -cosLat * Math.sin(lonRad)
      ).normalize();
      const e = new THREE.Vector3(-Math.sin(lonRad), 0, -Math.cos(lonRad)).normalize();
      const n = new THREE.Vector3().crossVectors(u, e).normalize();

      // 人眼视高转换为场景距离单位
      const datumM = this.anchor.bodyId === 'moon' ? TerrainHeightProvider.MOON_DATUM_RADIUS_M : 6371000.0;
      const eyeHeightScene = (this.anchor.eyeHeightM || 1.7) * (this.surfaceRadius / datumM);

      const eyeWorldPos = this.targetPosition.clone().add(localSurfacePt).addScaledVector(u, eyeHeightScene);
      this.camera.position.copy(eyeWorldPos);

      // 观察朝向判断
      if (this.lookTarget.kind === 'body' && this.latestGetBodyPos) {
        const skyTargetPos = this.latestGetBodyPos(this.lookTarget.bodyId).pos;
        this.camera.up.copy(u);
        this.camera.lookAt(skyTargetPos);
      } else {
        const yawRad = THREE.MathUtils.degToRad(this.surfaceYawDeg);
        const pitchRad = THREE.MathUtils.degToRad(this.surfacePitchDeg);

        // 视线水平投影向量
        const forward = new THREE.Vector3()
          .addScaledVector(n, Math.cos(yawRad))
          .addScaledVector(e, Math.sin(yawRad))
          .normalize();

        // 视线全空间向量
        const lookDir = new THREE.Vector3()
          .addScaledVector(forward, Math.cos(pitchRad))
          .addScaledVector(u, Math.sin(pitchRad))
          .normalize();

        this.camera.up.copy(u);
        this.camera.lookAt(eyeWorldPos.clone().add(lookDir));
      }

      // 地面观察时近裁剪面极致贴近 (0.1毫米级)，防月面土壤裁剪穿透
      if (Math.abs(this.camera.near - 1e-4) > 1e-6) {
        this.camera.near = 1e-4;
        this.camera.updateProjectionMatrix();
      }
      return;
    }

    const offset = new THREE.Vector3().setFromSpherical(this.spherical);
    this.camera.position.copy(this.targetPosition).add(offset);

    // 观察朝向解耦：支持依附当前锚点天体，但视线正对 lookTarget 目标天体（如月球看地球）
    if (this.lookTarget.kind === 'body' && this.latestGetBodyPos) {
      const lookPos = this.latestGetBodyPos(this.lookTarget.bodyId).pos;
      this.camera.lookAt(lookPos);
    } else if (this.lookTarget.kind === 'point') {
      this.camera.lookAt(new THREE.Vector3(...this.lookTarget.point));
    } else {
      this.camera.lookAt(this.targetPosition);
    }

    // 动态调整近裁剪面，彻底杜绝近地观察时地表被裁剪 (CAM-04)
    const isBody = this.anchor.kind === 'body';
    const clearance = isBody
      ? Math.max(0.001, this.spherical.radius - this.surfaceRadius)
      : Math.max(0.001, this.spherical.radius);
    const dynamicNear = CameraController.nearFromClearance(clearance, 0.1, 1e-4);

    if (Math.abs(this.camera.near - dynamicNear) > 1e-6) {
      this.camera.near = dynamicNear;
      this.camera.updateProjectionMatrix();
    }
  }

  public getSurfaceRadius(): number {
    return this.surfaceRadius;
  }

  public getFramingRadius(): number {
    return this.framingRadius;
  }

  public getCollisionClearance(): number {
    return this.collisionClearance;
  }
}
