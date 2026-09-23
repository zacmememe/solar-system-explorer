/**
 * 着陆控制器与下降状态机 LandingController
 * 遵循批次 R5 与《下一阶段工程方案与交接》第 9 节规范：
 * 1. 驱动 ORBIT -> PREPARING -> DESCENDING -> HOLD -> SURFACE_LOOK -> ASCENDING 状态流转；
 * 2. 连续一阶平滑下降曲线 (50km 轨道 -> 1.7m 月面人眼视高)；
 * 3. 严格遵循交互可打断原则：下降中用户拖拽/缩放立即进入 HOLD 状态，相机停驻原位并保留姿态；
 * 4. 触地停驻支持 360° yaw 与 ±85° pitch 第一人称环顾，一键仰望地球与返回轨道；
 * 5. 天文时钟协同：下降时自动下调至 1x 真实物理时间流速，返轨时安全恢复。
 */

import * as THREE from 'three';
import type { LandingSite, LandingState, LandingTelemetry } from '../contracts/landing';
import { LANDING_SITES } from '../contracts/landing';
import { TerrainHeightProvider } from './TerrainHeightProvider';

export type TelemetryListener = (telemetry: LandingTelemetry) => void;

export class LandingController {
  private state: LandingState = 'ORBIT';
  private site: LandingSite = LANDING_SITES['taurus-littrow'];
  private progress: number = 0; // 0.0 ~ 1.0

  // 动画时长配置 (秒)
  private descentDurationSec: number = 42.0;
  private ascendDurationSec: number = 18.0;

  // 轨迹高度端点 (米)
  private readonly ORBIT_ALTITUDE_M: number = 50000.0; // 50km 近月轨道
  private readonly SURFACE_EYE_HEIGHT_M: number = 1.7; // 1.7m 宇航员人眼视高

  // 初始入轨切入点与落地点
  private startLat: number = 20.10;
  private startLon: number = 30.50;
  private targetLat: number = 20.35;
  private targetLon: number = 30.78;

  // 地面视线控制姿态 (度)
  private surfaceYawDeg: number = 225.0; // 默认朝向西南偏南 (正对地球仰角方向)
  private surfacePitchDeg: number = 12.0; // 轻微仰视地平线与山峦

  // 物理时间调谐记忆
  private simTimeAdjusted: boolean = false;
  private originalTimeScale: number = 1.0;

  private listeners: Set<TelemetryListener> = new Set();
  private heightProvider: TerrainHeightProvider = TerrainHeightProvider.getInstance();

  constructor(siteId: string = 'taurus-littrow') {
    if (LANDING_SITES[siteId]) {
      this.site = LANDING_SITES[siteId];
      this.targetLat = this.site.centerLat;
      this.targetLon = this.site.centerLon;
    }
  }

  public getState(): LandingState {
    return this.state;
  }

  public getSite(): LandingSite {
    return this.site;
  }

  public getProgress(): number {
    return this.progress;
  }

  public getSurfaceOrientation(): { yawDeg: number; pitchDeg: number } {
    return {
      yawDeg: this.surfaceYawDeg,
      pitchDeg: this.surfacePitchDeg,
    };
  }

  public setSurfaceOrientation(yawDeg: number, pitchDeg: number): void {
    this.surfaceYawDeg = THREE.MathUtils.euclideanModulo(yawDeg, 360);
    this.surfacePitchDeg = Math.max(-85, Math.min(85, pitchDeg));
    this.notifyTelemetry();
  }

  public addListener(listener: TelemetryListener): () => void {
    this.listeners.add(listener);
    listener(this.getTelemetry());
    return () => this.listeners.delete(listener);
  }

  /**
   * 启动降落任务序列
   * @param getTimeScale 获取当前时钟倍率函数
   * @param setTimeScale 调整时钟倍率函数
   */
  public startDescent(
    getTimeScale?: () => number,
    setTimeScale?: (scale: number) => void
  ): void {
    if (this.state === 'DESCENDING' || this.state === 'SURFACE_LOOK') return;

    // 天文时间协同：临时下调到 1x 真实物理时间流速
    if (getTimeScale && setTimeScale) {
      const cur = getTimeScale();
      if (cur > 1.0) {
        this.originalTimeScale = cur;
        this.simTimeAdjusted = true;
        setTimeScale(1.0);
      }
    }

    this.state = 'DESCENDING';
    this.progress = 0;
    this.notifyTelemetry();
  }

  /**
   * 悬停 / 响应用户交互打断 (HOLD)
   * 核心铁律：用户在下降过程中拖拽视角或缩放时立即停住位移，保留机位与控制权
   */
  public holdDescent(): void {
    if (this.state === 'DESCENDING') {
      this.state = 'HOLD';
      this.notifyTelemetry();
    }
  }

  /**
   * 从悬停中恢复持续下降
   */
  public resumeDescent(): void {
    if (this.state === 'HOLD') {
      this.state = 'DESCENDING';
      this.notifyTelemetry();
    }
  }

  /**
   * 触地到达，进入月表第一人称停驻环顾
   */
  public touchdown(): void {
    this.state = 'SURFACE_LOOK';
    this.progress = 1.0;
    this.notifyTelemetry();
  }

  /**
   * 启动升空返回轨道
   */
  public returnToOrbit(): void {
    if (this.state === 'SURFACE_LOOK' || this.state === 'HOLD') {
      this.state = 'ASCENDING';
      this.notifyTelemetry();
    }
  }

  /**
   * 退出着陆系统回到初始轨道状态
   */
  public cancel(
    setTimeScale?: (scale: number) => void
  ): void {
    this.state = 'ORBIT';
    this.progress = 0;

    // 恢复先前天文时间倍率
    if (this.simTimeAdjusted && setTimeScale) {
      setTimeScale(this.originalTimeScale);
      this.simTimeAdjusted = false;
    }

    this.notifyTelemetry();
  }

  /**
   * 每帧状态更新驱动下降/升空插值
   */
  public update(
    deltaSec: number,
    setTimeScale?: (scale: number) => void
  ): void {
    if (this.state === 'DESCENDING') {
      const step = deltaSec / this.descentDurationSec;
      this.progress = Math.min(1.0, this.progress + step);

      if (this.progress >= 1.0) {
        this.touchdown();
      } else {
        this.notifyTelemetry();
      }
    } else if (this.state === 'ASCENDING') {
      const step = deltaSec / this.ascendDurationSec;
      this.progress = Math.max(0.0, this.progress - step);

      if (this.progress <= 0.0) {
        this.cancel(setTimeScale);
      } else {
        this.notifyTelemetry();
      }
    }
  }

  /**
   * 计算当前轨迹点在月面局部参考系下的位置、朝向与高度
   */
  public evaluateTrajectory(): {
    lat: number;
    lon: number;
    altitudeAGLM: number;
    altitudeMSLM: number;
    cameraPitchDeg: number;
    cameraYawDeg: number;
  } {
    if (this.state === 'SURFACE_LOOK') {
      const elevM = this.heightProvider.getHeightMeters('moon', this.targetLat, this.targetLon);
      return {
        lat: this.targetLat,
        lon: this.targetLon,
        altitudeAGLM: this.SURFACE_EYE_HEIGHT_M,
        altitudeMSLM: elevM + this.SURFACE_EYE_HEIGHT_M,
        cameraPitchDeg: this.surfacePitchDeg,
        cameraYawDeg: this.surfaceYawDeg,
      };
    }

    const t = this.progress;
    // 缓动曲线：Perlin Smootherstep
    const easeT = t * t * t * (t * (t * 6 - 15) + 10);

    // 经纬度航向渐进
    const lat = THREE.MathUtils.lerp(this.startLat, this.targetLat, easeT);
    const lon = THREE.MathUtils.lerp(this.startLon, this.targetLon, easeT);

    // 对数/幂律高度下降（高空高速，低空平稳减速接地）
    const altExp = Math.pow(1 - easeT, 2.8);
    const altitudeAGLM = this.SURFACE_EYE_HEIGHT_M + (this.ORBIT_ALTITUDE_M - this.SURFACE_EYE_HEIGHT_M) * altExp;

    const terrainElevM = this.heightProvider.getHeightMeters('moon', lat, lon);
    const altitudeMSLM = terrainElevM + altitudeAGLM;

    // 相机俯仰角从高空俯瞰月表逐渐抬起到地平线平视
    const cameraPitchDeg = THREE.MathUtils.lerp(-45.0, this.surfacePitchDeg, Math.pow(easeT, 0.7));
    const cameraYawDeg = THREE.MathUtils.lerp(180.0, this.surfaceYawDeg, easeT);

    return {
      lat,
      lon,
      altitudeAGLM,
      altitudeMSLM,
      cameraPitchDeg,
      cameraYawDeg,
    };
  }

  /**
   * 生成当前遥测数据包
   */
  public getTelemetry(): LandingTelemetry {
    const traj = this.evaluateTrajectory();

    // 垂直速度估算 (m/s)
    let verticalSpeedMps = 0;
    if (this.state === 'DESCENDING') {
      const remainH = Math.max(0, traj.altitudeAGLM - this.SURFACE_EYE_HEIGHT_M);
      const remainT = Math.max(0.1, (1 - this.progress) * this.descentDurationSec);
      verticalSpeedMps = -Number((remainH / remainT * 1.2).toFixed(1));
    } else if (this.state === 'ASCENDING') {
      const remainH = Math.max(0, this.ORBIT_ALTITUDE_M - traj.altitudeAGLM);
      const remainT = Math.max(0.1, this.progress * this.ascendDurationSec);
      verticalSpeedMps = Number((remainH / remainT * 1.2).toFixed(1));
    }

    return {
      state: this.state,
      site: this.site,
      altitudeAGLM: Number(traj.altitudeAGLM.toFixed(1)),
      altitudeMSLM: Number(traj.altitudeMSLM.toFixed(1)),
      verticalSpeedMps,
      horizontalSpeedMps: this.state === 'DESCENDING' ? Number(((1 - this.progress) * 85.0).toFixed(1)) : 0,
      progress: Number(this.progress.toFixed(3)),
      currentLat: Number(traj.lat.toFixed(4)),
      currentLon: Number(traj.lon.toFixed(4)),
      surfaceYawDeg: Number(traj.cameraYawDeg.toFixed(1)),
      surfacePitchDeg: Number(traj.cameraPitchDeg.toFixed(1)),
      simTimeAdjusted: this.simTimeAdjusted,
    };
  }

  private notifyTelemetry(): void {
    const data = this.getTelemetry();
    for (const listener of this.listeners) {
      try {
        listener(data);
      } catch (err) {
        console.error('[LandingController] 遥测监听回调异常:', err);
      }
    }
  }
}
