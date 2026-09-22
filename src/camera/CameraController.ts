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
import type { CameraCommand, CameraMode, CameraStateSnapshot, CameraAnchor } from '../contracts/camera';
import { BODIES, getNavDisplayRadius } from '../astronomy/bodies';

export interface CameraControllerOptions {
  camera: THREE.PerspectiveCamera;
  minDistanceFactor?: number;
  maxDistanceFactor?: number;
}

export class CameraController {
  private camera: THREE.PerspectiveCamera;
  private mode: CameraMode = 'ORBIT_TARGET';
  private anchor: CameraAnchor = { kind: 'body', bodyId: 'earth' };
  private targetBodyId: BodyId = 'earth';
  private selectedBodyId: BodyId = 'earth';
  private sourceBodyId: BodyId | null = 'earth';

  // 观察状态（球坐标：相对于 targetPosition）
  private targetPosition: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  private spherical: THREE.Spherical = new THREE.Spherical(6.2, Math.PI / 2.22, Math.PI / 4);
  private minDistance: number = 7.5;
  private maxDistance: number = 800;

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
      targetBodyId: this.anchor.kind === 'body' ? this.anchor.bodyId : this.targetBodyId,
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
        this.initiateFlight(command.bodyId, dur, token, command.targetPos);
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
        this.spherical.theta -= command.deltaTheta;
        this.spherical.phi = Math.max(0.01, Math.min(Math.PI - 0.01, this.spherical.phi - command.deltaPhi));
        this.spherical.makeSafe();
        this.updateCameraTransform();
        break;

      case 'zoom':
        if (this.isTransitioning) {
          this.cancelFlight();
        }
        this.spherical.radius = Math.max(
          this.minDistance,
          Math.min(this.maxDistance, this.spherical.radius + command.deltaDist)
        );
        this.updateCameraTransform();
        break;

      case 'overview': {
        const dur = this.reduceMotion ? 0.15 : 2.5;
        this.initiateOverviewFlight(token, dur);
        break;
      }

      case 'restoreBookmark': {
        const dur = command.durationSec ?? (this.reduceMotion ? 0.15 : 2.5);
        this.initiateBookmarkFlight(command.targetBodyId, command.spherical, dur, token);
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
      this.minDistance = Math.max(1.5, targetRadius * 1.2);
      this.maxDistance = Math.max(100, targetRadius * 100);
      if (this.spherical.radius < this.minDistance) {
        this.spherical.radius = this.minDistance;
      }
      this.updateCameraTransform();
    }
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
   * 立即取消飞行，保持当前视角与控制权归还用户
   */
  public cancelFlight(): void {
    if (this.isTransitioning) {
      this.isTransitioning = false;
      this.mode = 'ORBIT_TARGET';
      this.anchor = {
        kind: 'free',
        pivotScene: [this.targetPosition.x, this.targetPosition.y, this.targetPosition.z],
      };
      this.updateCameraTransform();
    }
  }

  /**
   * 每帧由单一 render loop 调用，更新相机位置与平滑缓动
   */
  public update(deltaSec: number, getBodyPos: (id: BodyId) => { pos: THREE.Vector3; radius: number }): void {
    if (this.isTransitioning) {
      this.transitionProgress += deltaSec / this.transitionDurationSec;
      if (this.transitionProgress >= 1.0) {
        this.transitionProgress = 1.0;
        this.isTransitioning = false;
        this.mode = 'ORBIT_TARGET';
        this.anchor = { kind: 'body', bodyId: this.targetBodyId };
      }

      // Perlin Smootherstep 极佳丝滑缓动: 6t^5 - 15t^4 + 10t^3 (一阶二阶导数在起终点均为0)
      const t = this.transitionProgress;
      const easeT = t * t * t * (t * (t * 6 - 15) + 10);

      const targetInfo = getBodyPos(this.targetBodyId);
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

      this.minDistance = targetInfo.radius * 1.2;
      this.maxDistance = targetInfo.radius * 100;
    } else {
      // 处于目标观察模式：跟随天体物理平移或保持自由观察锚点
      if (this.anchor.kind === 'body') {
        const targetInfo = getBodyPos(this.anchor.bodyId);
        this.targetPosition.copy(targetInfo.pos);
        this.minDistance = targetInfo.radius * 1.2;
        this.maxDistance = targetInfo.radius * 100;
      } else {
        this.targetPosition.set(this.anchor.pivotScene[0], this.anchor.pivotScene[1], this.anchor.pivotScene[2]);
      }
    }

    this.updateCameraTransform();
  }

  /**
   * 写入 Three.js Camera 变换
   * 唯一相机写入者！
   */
  private updateCameraTransform(): void {
    const offset = new THREE.Vector3().setFromSpherical(this.spherical);
    this.camera.position.copy(this.targetPosition).add(offset);
    this.camera.lookAt(this.targetPosition);
  }
}
