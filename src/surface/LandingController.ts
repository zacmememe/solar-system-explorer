/**
 * 着陆控制器与下降状态机 LandingController
 * 批次规范：R5 建立，P2 按 Pro 交接重写下降段：
 * 1. ORBIT → PREPARING → DESCENDING → HOLD ⇄ SURFACE_LOOK → ASCENDING → ORBIT；
 * 2. PREPARING 门槛：真实 DTM 数据装载且站点采样为 measured-dem 才放行，
 *    用户改选后过期准备不自动发起（cancelPreparation 显式收回）；
 * 3. 下降起点来自当前机位（body-fixed 地面投射点 + 当前净空），
 *    超远机位先构造连续接近段，不瞬移到固定 50km 点；
 * 4. 路径为短大圆 + smootherstep 参考曲线（src/world-support/descentCurve.ts），
 *    速度用曲线真实导数（commanded 口径），HUD 明确语义；
 * 5. 交互铁律：用户拖拽 → HOLD 冻结位移、保留视线；resume 只继续位移，
 *    不重设 yaw/pitch（userInterrupted 置位后导引朝向不再覆盖用户转头）；
 * 6. 天文时钟协同：下降自动 1x，返轨恢复（用户期间手动改过则不覆盖）。
 */

import type { LandingSite, LandingState, LandingTelemetry } from '../contracts/landing';
import { LANDING_SITES } from '../contracts/landing';
import { TerrainHeightProvider } from './TerrainHeightProvider';
import { sampleDescent, smootherstep, latLonDirection as latLonDir, type DescentLeg } from '../world-support/descentCurve';

export type TelemetryListener = (telemetry: LandingTelemetry) => void;

export interface DescentStartPose {
  latDeg: number;
  lonDeg: number;
  clearanceM: number;
  /** P3b-A：同帧捕获的起始视线（站点局部基 yaw/pitch，来自实际 q0 提取）。
   * 提供时下降导引从该姿态连续混合到导引目标（首帧=用户当前视角，无 SNAP）。 */
  yaw0Deg?: number;
  pitch0Deg?: number;
}

export class LandingController {
  private state: LandingState = 'ORBIT';
  private site: LandingSite = LANDING_SITES['taurus-littrow'];

  // 参考曲线腿：接近段（超远机位）+ 主下降段
  private legs: DescentLeg[] = [];
  private legIndex = 0;
  private elapsedSec = 0;
  private ascendSec = 0; // ASCENDING 反向播放的剩余时长

  private readonly ORBIT_ALTITUDE_M = 50000.0; // 近月下降段上限
  private readonly SURFACE_EYE_HEIGHT_M = 1.7; // 默认人眼视高（可调）
  private readonly MAIN_DESCENT_SEC = 42.0;
  private readonly APPROACH_SEC = 8.0;
  private readonly ASCEND_SEC = 18.0;

  private targetLat: number;
  private targetLon: number;

  // 地面默认视线（仅导引段使用；用户接管后不再覆盖）
  private surfaceYawDeg = 225.0;
  private surfacePitchDeg = 12.0;

  // P3b-A：同帧捕获的起始视线与混合时长（首帧=用户真实视角，~5°/s 常态角速率）
  private startYaw0Deg = 225.0;
  private startPitch0Deg = 12.0;
  private readonly ORIENT_BLEND_SEC = 12.0;

  // 用户交互状态
  private userInterrupted = false;

  // 物理时间调谐记忆
  private simTimeAdjusted = false;
  private originalTimeScale = 1.0;

  private listeners: Set<TelemetryListener> = new Set();
  private heightProvider: TerrainHeightProvider = TerrainHeightProvider.getInstance();

  constructor(siteId: string = 'taurus-littrow') {
    this.targetLat = this.site.centerLat;
    this.targetLon = this.site.centerLon;
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

  /** 当前下降进度（跨腿折算 0..1，供 HUD 进度条） */
  public getProgress(): number {
    if (this.state === 'SURFACE_LOOK') return 1;
    const total = this.legs.reduce((s, l) => s + l.durationSec, 0);
    if (total <= 0) return 0;
    const done = this.legs.slice(0, this.legIndex).reduce((s, l) => s + l.durationSec, 0) + this.elapsedSec;
    return Math.max(0, Math.min(1, done / total));
  }

  public getSurfaceOrientation(): { yawDeg: number; pitchDeg: number } {
    return { yawDeg: this.surfaceYawDeg, pitchDeg: this.surfacePitchDeg };
  }

  public setSurfaceOrientation(yawDeg: number, pitchDeg: number): void {
    this.surfaceYawDeg = ((yawDeg % 360) + 360) % 360;
    this.surfacePitchDeg = Math.max(-85, Math.min(85, pitchDeg));
    this.notifyTelemetry();
  }

  public addListener(listener: TelemetryListener): () => void {
    this.listeners.add(listener);
    listener(this.getTelemetry());
    return () => this.listeners.delete(listener);
  }

  /**
   * P3b-A：进入准备阶段。降落入口由引擎验证可用性后调用；资源就绪检查、比例框架
   * 稳定、光照选时与同帧 pose 捕获全部由引擎的准备流水线驱动完成，完成后引擎调用
   * completePreparation(pose) 才真正开始下降。控制器不再自行 auto-begin。
   */
  public startDescent(): void {
    if (this.state === 'DESCENDING' || this.state === 'SURFACE_LOOK' || this.state === 'PREPARING') return;
    this.state = 'PREPARING';
    this.notifyTelemetry();
  }

  /** 引擎准备流水线完成：以同帧捕获的完整起点（含姿态）开始下降 */
  public completePreparation(
    getTimeScale: (() => number) | undefined,
    setTimeScale: ((scale: number) => void) | undefined,
    startPose: DescentStartPose
  ): void {
    if (this.state !== 'PREPARING') return;
    this.beginDescent(getTimeScale, setTimeScale, startPose);
  }

  /** 用户改选/离开月球：收回过期的 PREPARING（不自动重发） */
  public cancelPreparation(): void {
    if (this.state === 'PREPARING') {
      this.state = 'ORBIT';
      this.notifyTelemetry();
    }
  }

  private beginDescent(
    getTimeScale?: () => number,
    setTimeScale?: (scale: number) => void,
    startPose?: DescentStartPose
  ): void {
    // 天文时间协同：临时下调到 1x
    if (getTimeScale && setTimeScale) {
      const cur = getTimeScale();
      if (cur > 1.0) {
        this.originalTimeScale = cur;
        this.simTimeAdjusted = true;
        setTimeScale(1.0);
      }
    }

    // 构造连续腿：起点 = 当前机位地面投射（缺省默认切入点）
    const from = startPose ?? {
      latDeg: this.site.centerLat - 0.25,
      lonDeg: this.site.centerLon - 0.28,
      clearanceM: this.ORBIT_ALTITUDE_M,
      yaw0Deg: this.surfaceYawDeg,
      pitch0Deg: this.surfacePitchDeg,
    };
    // P3b-A（Pro §3.2）：对跖起点不再修改经度规避——路径能力不足就拒绝启动，
    // 由引擎入口的可用性检查（far-side → 前往着陆区）保证不会走到这里。
    const dotStart = this.dotOf(from.latDeg, from.lonDeg, this.targetLat, this.targetLon);
    if (dotStart < -0.99995) {
      throw new RangeError('antipodal descent start: route requires explicit off-sphere waypoints (P3b-B)');
    }
    // P3b-A：移除 400km 起点截断——首帧位置必须等于用户当前真实机位；
    // 接近段时长按距离对数延长，保证远处起步的推进速率不失控（节奏细化归 P3b-B）。
    const startClearance = Math.max(from.clearanceM, this.SURFACE_EYE_HEIGHT_M);
    const approachSec = startClearance > this.ORBIT_ALTITUDE_M * 1.1
      ? this.APPROACH_SEC * Math.max(1, Math.log10(startClearance / this.ORBIT_ALTITUDE_M) + 1)
      : 0;
    const radiusM = this.site.datumRadiusKm * 1000;

    this.legs = [];
    if (approachSec > 0) {
      // 超远机位：先同点连续降到近月下降段上限（接近段，不做瞬移）
      this.legs.push({
        from: { latDeg: from.latDeg, lonDeg: from.lonDeg, clearanceM: startClearance },
        to: { latDeg: from.latDeg, lonDeg: from.lonDeg, clearanceM: this.ORBIT_ALTITUDE_M },
        durationSec: approachSec,
        radiusM,
      });
    }
    this.legs.push({
      from: { latDeg: from.latDeg, lonDeg: from.lonDeg, clearanceM: Math.min(startClearance, this.ORBIT_ALTITUDE_M) },
      to: { latDeg: this.targetLat, lonDeg: this.targetLon, clearanceM: this.SURFACE_EYE_HEIGHT_M },
      durationSec: this.MAIN_DESCENT_SEC,
      radiusM,
    });

    // P3b-A：起始视线（来自同帧 q0 提取）。导引从此姿态连续混合到目标（见 evaluateTrajectory）。
    this.startYaw0Deg = from.yaw0Deg ?? this.surfaceYawDeg;
    this.startPitch0Deg = Math.max(-85, Math.min(85, from.pitch0Deg ?? this.surfacePitchDeg));

    this.legIndex = 0;
    this.elapsedSec = 0;
    this.userInterrupted = false;
    this.state = 'DESCENDING';
    this.notifyTelemetry();
  }

  /** 悬停/用户交互打断：冻结位移，保留机位与视线控制权 */
  public holdDescent(): void {
    if (this.state === 'DESCENDING') {
      this.state = 'HOLD';
      this.userInterrupted = true;
      this.notifyTelemetry();
    }
  }

  /** 从悬停恢复：只继续位移，不重设朝向（userInterrupted 保持置位） */
  public resumeDescent(): void {
    if (this.state === 'HOLD') {
      this.state = 'DESCENDING';
      this.notifyTelemetry();
    }
  }

  public touchdown(): void {
    this.state = 'SURFACE_LOOK';
    this.legIndex = Math.max(0, this.legs.length - 1);
    this.elapsedSec = this.legs[this.legIndex]?.durationSec ?? 0;
    this.notifyTelemetry();
  }

  public returnToOrbit(): void {
    if (this.state === 'SURFACE_LOOK' || this.state === 'HOLD' || this.state === 'DESCENDING') {
      this.state = 'ASCENDING';
      this.ascendSec = this.ASCEND_SEC;
      this.notifyTelemetry();
    }
  }

  /** 两地面点方向向量点积（对跖判定用） */
  private dotOf(latA: number, lonA: number, latB: number, lonB: number): number {
    const a = latLonDir(latA, lonA);
    const b = latLonDir(latB, lonB);
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  public cancel(setTimeScale?: (scale: number) => void): void {
    this.state = 'ORBIT';
    this.legs = [];
    this.legIndex = 0;
    this.elapsedSec = 0;
    this.userInterrupted = false;

    if (this.simTimeAdjusted && setTimeScale) {
      setTimeScale(this.originalTimeScale);
      this.simTimeAdjusted = false;
    }
    this.notifyTelemetry();
  }

  /** 每帧更新：下降推进 / 升空推进（P3b-A：PREPARING 不再自行 auto-begin，由引擎准备流水线驱动） */
  public update(deltaSec: number, setTimeScale?: (scale: number) => void): void {
    if (this.state === 'PREPARING') {
      return;
    }

    if (this.state === 'DESCENDING') {
      this.elapsedSec += deltaSec;
      const leg = this.legs[this.legIndex];
      if (!leg) {
        this.touchdown();
        return;
      }
      if (this.elapsedSec >= leg.durationSec) {
        if (this.legIndex >= this.legs.length - 1) {
          this.touchdown();
        } else {
          this.legIndex += 1;
          this.elapsedSec = 0;
          this.notifyTelemetry();
        }
      } else {
        this.notifyTelemetry();
      }
    } else if (this.state === 'ASCENDING') {
      this.ascendSec -= deltaSec;
      if (this.ascendSec <= 0) {
        this.cancel(setTimeScale);
      } else {
        this.notifyTelemetry();
      }
    }
  }

  /**
   * 当前轨迹点（body-fixed 地面点 + 净空 + 导引朝向）。
   * cameraYawDeg/cameraPitchDeg 为 null 表示用户已接管视线——引擎只推进位移。
   */
  public evaluateTrajectory(): {
    lat: number;
    lon: number;
    altitudeAGLM: number;
    altitudeMSLM: number;
    cameraPitchDeg: number | null;
    cameraYawDeg: number | null;
    /** P3b-A:?????????(??? q0??????? slerp;null=?????) */
    guideYawDeg: number | null;
    guidePitchDeg: number | null;
    guideBlend: number | null;
    commandedClearanceRateMps: number;
    commandedTangentialSpeedMps: number;
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
        guideYawDeg: this.surfaceYawDeg,
        guidePitchDeg: this.surfacePitchDeg,
        guideBlend: 1,
        commandedClearanceRateMps: 0,
        commandedTangentialSpeedMps: 0,
      };
    }

    if (this.state === 'ASCENDING') {
      // 反向播放主下降腿（净空从眼高回到下降段起点上限）
      const main = this.legs[this.legs.length - 1];
      const total = Math.max(this.ASCEND_SEC, this.legs.reduce((s, l) => s + l.durationSec, 0) * 0.4);
      const t = Math.max(0, Math.min(1, this.ascendSec / total));
      const lat = main ? main.from.latDeg + (main.to.latDeg - main.from.latDeg) * t : this.targetLat;
      const lon = main ? main.from.lonDeg + (main.to.lonDeg - main.from.lonDeg) * t : this.targetLon;
      const clearance = main
        ? main.from.clearanceM + (main.to.clearanceM - main.from.clearanceM) * t
        : this.ORBIT_ALTITUDE_M;
      const elevM = this.heightProvider.getHeightMeters('moon', lat, lon);
      return {
        lat,
        lon,
        altitudeAGLM: clearance,
        altitudeMSLM: elevM + clearance,
        cameraPitchDeg: this.userInterrupted ? null : -20,
        cameraYawDeg: this.userInterrupted ? null : this.surfaceYawDeg,
        guideYawDeg: this.userInterrupted ? null : this.surfaceYawDeg,
        guidePitchDeg: this.userInterrupted ? null : -20,
        guideBlend: this.userInterrupted ? null : 1,
        commandedClearanceRateMps: (main ? main.to.clearanceM - main.from.clearanceM : this.ORBIT_ALTITUDE_M) / total,
        commandedTangentialSpeedMps: 0,
      };
    }

    const leg = this.legs[this.legIndex];
    if (!leg) {
      // PREPARING/ORBIT 无轨迹
      return {
        lat: this.targetLat,
        lon: this.targetLon,
        altitudeAGLM: this.ORBIT_ALTITUDE_M,
        altitudeMSLM: this.ORBIT_ALTITUDE_M,
        cameraPitchDeg: this.userInterrupted ? null : this.surfacePitchDeg,
        cameraYawDeg: this.userInterrupted ? null : this.surfaceYawDeg,
        guideYawDeg: this.userInterrupted ? null : this.surfaceYawDeg,
        guidePitchDeg: this.userInterrupted ? null : this.surfacePitchDeg,
        guideBlend: this.userInterrupted ? null : 1,
        commandedClearanceRateMps: 0,
        commandedTangentialSpeedMps: 0,
      };
    }

    const s = sampleDescent(leg, this.elapsedSec);
    const elevM = this.heightProvider.getHeightMeters('moon', s.latDeg, s.lonDeg);
    // P3-T1：导引朝向按"全部腿合并的全局进度"参数化（接近段+主段共用一条曲线）。
    // P3b-A：从同帧捕获的起始视线 (yaw0/pitch0) 连续混合到导引目标——首帧严格等于
    // 用户当前真实视角（无 SNAP）；smootherstep 混合同时抑制 pow(0.7) 在 t=0 的无界导数
    // （w~t³ × t^-0.3 → 0），角速率约 (57°+45°)/12s ≈ 8.5°/s 上限内。
    const totalDur = this.legs.reduce((acc, l) => acc + l.durationSec, 0);
    let prefixDur = 0;
    for (let i = 0; i < this.legIndex; i++) prefixDur += this.legs[i].durationSec;
    const legElapsed = s.progress * leg.durationSec;
    const globalT = totalDur > 0 ? Math.min(1, (prefixDur + legElapsed) / totalDur) : 1;
    const blend = smootherstep(Math.min(1, (prefixDur + legElapsed) / this.ORIENT_BLEND_SEC));
    // 导引目标：高空俯瞰 → 接地前抬头看地平线（P3b-B 将替换为地平线投影导引）。
    const guidePitch = -45 + (this.surfacePitchDeg + 45) * Math.pow(globalT, 0.7);
    const guideYaw = 180 + (this.surfaceYawDeg - 180) * globalT;
    // 偏航走最短弧（±180° 内），不做跨零绕远
    let dYaw = ((guideYaw - this.startYaw0Deg + 540) % 360) - 180;
    if (dYaw === -180) dYaw = 180;
    return {
      lat: s.latDeg,
      lon: s.lonDeg,
      altitudeAGLM: s.clearanceM,
      altitudeMSLM: elevM + s.clearanceM,
      cameraPitchDeg: this.userInterrupted
        ? null
        : this.startPitch0Deg + (guidePitch - this.startPitch0Deg) * blend,
      cameraYawDeg: this.userInterrupted
        ? null
        : this.startYaw0Deg + dYaw * blend,
      guideYawDeg: this.userInterrupted ? null : guideYaw,
      guidePitchDeg: this.userInterrupted ? null : guidePitch,
      guideBlend: this.userInterrupted ? null : blend,
      commandedClearanceRateMps: s.commandedClearanceRateMps,
      commandedTangentialSpeedMps: s.commandedTangentialSpeedMps,
    };
  }

  public getTelemetry(): LandingTelemetry {
    const traj = this.evaluateTrajectory();

    // 速度语义：commanded 净空变化率（参考曲线真实导数），非数值微分、非 MSL 变化率
    let verticalSpeedMps = 0;
    if (this.state === 'DESCENDING') {
      verticalSpeedMps = Number(traj.commandedClearanceRateMps.toFixed(1));
    } else if (this.state === 'ASCENDING') {
      verticalSpeedMps = Number(Math.abs(traj.commandedClearanceRateMps).toFixed(1));
    }

    const sample = this.heightProvider.getHeightSample('moon', this.targetLat, this.targetLon);
    const provenance = this.heightProvider.rasterAdmissionState;

    return {
      state: this.state,
      site: this.site,
      altitudeAGLM: Number(traj.altitudeAGLM.toFixed(1)),
      altitudeMSLM: Number(traj.altitudeMSLM.toFixed(1)),
      verticalSpeedMps,
      verticalSpeedSemantics: 'commanded-clearance-rate',
      horizontalSpeedMps: Number(traj.commandedTangentialSpeedMps.toFixed(1)),
      progress: Number(this.getProgress().toFixed(3)),
      currentLat: Number(traj.lat.toFixed(4)),
      currentLon: Number(traj.lon.toFixed(4)),
      surfaceYawDeg: traj.cameraYawDeg == null ? Number(this.surfaceYawDeg.toFixed(1)) : Number(traj.cameraYawDeg.toFixed(1)),
      surfacePitchDeg: traj.cameraPitchDeg == null ? Number(this.surfacePitchDeg.toFixed(1)) : Number(traj.cameraPitchDeg.toFixed(1)),
      simTimeAdjusted: this.simTimeAdjusted,
      terrain: {
        fidelity: sample.fidelity,
        sourceId: sample.sourceId,
        admissionState: provenance,
      },
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
