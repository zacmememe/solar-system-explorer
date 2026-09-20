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
import type { CameraCommand, CameraMode, CameraStateSnapshot } from '../contracts/camera';

export interface CameraControllerOptions {
  camera: THREE.PerspectiveCamera;
  minDistanceFactor?: number;
  maxDistanceFactor?: number;
}

export class CameraController {
  private camera: THREE.PerspectiveCamera;
  private mode: CameraMode = 'ORBIT_TARGET';
  private targetBodyId: BodyId = 'earth';
  private selectedBodyId: BodyId = 'earth';

  // 观察状态（球坐标：相对于 targetPosition）
  private targetPosition: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  private spherical: THREE.Spherical = new THREE.Spherical(20, Math.PI / 2.5, Math.PI / 4);
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

  constructor(options: CameraControllerOptions) {
    this.camera = options.camera;
    this.updateCameraTransform();
  }

  public getSnapshot(): CameraStateSnapshot {
    return {
      mode: this.mode,
      targetBodyId: this.targetBodyId,
      selectedBodyId: this.selectedBodyId,
      distanceToTarget: this.spherical.radius,
      minDistance: this.minDistance,
      maxDistance: this.maxDistance,
      commandId: this.currentCommandId,
      isTransitioning: this.isTransitioning,
    };
  }

  /**
   * 处理相机外部命令
   */
  public executeCommand(command: CameraCommand): number {
    this.currentCommandId++;
    const token = this.currentCommandId;

    switch (command.type) {
      case 'select':
        this.selectedBodyId = command.bodyId;
        break;

      case 'flyTo':
        this.initiateFlight(command.bodyId, command.durationSec ?? 2.5, token);
        break;

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

      case 'overview':
        this.initiateOverviewFlight(token);
        break;
    }

    return token;
  }

  /**
   * 设置目标在场景中的最新物理位置（支持运动天体跟随平移）
   */
  public updateTargetPosition(targetPos: THREE.Vector3, targetRadius: number): void {
    if (!this.isTransitioning) {
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
   */
  private initiateFlight(targetId: BodyId, durationSec: number, token: number): void {
    if (token !== this.currentCommandId) return;

    this.isTransitioning = true;
    this.mode = 'TRANSITION';
    this.targetBodyId = targetId;
    this.selectedBodyId = targetId;
    this.transitionDurationSec = Math.max(1.0, durationSec);
    this.transitionProgress = 0;

    this.transitionStartSpherical.copy(this.spherical);
    this.transitionStartTargetPos.copy(this.targetPosition);

    // 计算合理的目标观察距离（基于 FOV 留白构图）
    // 地球 radius ~6.37 -> dist ~18; 月球 radius ~1.74 -> dist ~6
    let targetDist = targetId === 'moon' ? 6.0 : 18.0;
    this.transitionTargetSpherical.set(
      targetDist,
      Math.PI / 2.3,
      this.spherical.theta + 0.3 // 轻微自然过渡角
    );

    // 目标位置若为月球，则在 render loop 中同步 targetPosition
  }

  /**
   * 启动飞向地月全景
   */
  private initiateOverviewFlight(token: number): void {
    if (token !== this.currentCommandId) return;

    this.isTransitioning = true;
    this.mode = 'TRANSITION';
    this.targetBodyId = 'earth';
    this.selectedBodyId = 'earth';
    this.transitionDurationSec = 2.0;
    this.transitionProgress = 0;

    this.transitionStartSpherical.copy(this.spherical);
    this.transitionStartTargetPos.copy(this.targetPosition);

    this.transitionTargetTargetPos.set(0, 0, 0);
    this.transitionTargetSpherical.set(500, Math.PI / 3, Math.PI / 4);
  }

  /**
   * 立即取消飞行，保持当前视角与控制权归还用户
   */
  public cancelFlight(): void {
    if (this.isTransitioning) {
      this.isTransitioning = false;
      this.mode = 'ORBIT_TARGET';
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
      }

      // Smooth step easing (3x^2 - 2x^3)
      const t = this.transitionProgress;
      const easeT = t * t * (3 - 2 * t);

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
      // 处于目标观察模式，跟随天体物理平移
      const targetInfo = getBodyPos(this.targetBodyId);
      this.targetPosition.copy(targetInfo.pos);
      this.minDistance = targetInfo.radius * 1.2;
      this.maxDistance = targetInfo.radius * 100;
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
