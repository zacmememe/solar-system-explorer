/**
 * 着陆控制器与下降状态机 LandingController
 * 批次规范：R5 建立，P2 按 Pro 交接重写下降段，P3b-B 按 Pro 复审再重构：
 * 1. ORBIT → PREPARING → DESCENDING → HOLD ⇄ SURFACE_LOOK → ASCENDING → ORBIT；
 * 2. PREPARING 门槛：资源/比例/光照/同帧姿态捕获由引擎准备流水线驱动，
 *    completePreparation(pose) 后才开始下降（控制器不自行 auto-begin）；
 * 3. P3b-B：单一连续腿（无 接近段/主段 拼接零速停顿），高度一律用基准面高
 *    datum 规划（跨 DTM 窗口边界无基准跳变）；时长按落差对数伸缩（12..55s）；
 * 4. 路径为短大圆 + smootherstep 参考曲线；AGL = H − elev 为报告量非规划量；
 * 5. 姿态：控制器只输出路线切向航向 + 名义地平线俯仰（HUD 用）；权威姿态
 *    由引擎用实际 FOV 的地平线投影四元数 + 角速率受限收敛计算（含滚转）；
 * 6. 交互铁律：用户拖拽 → HOLD 冻结位移、保留视线；恢复导引由引擎按当前
 *    姿态重新收敛（requestLandingReguide），不做开环倒放；
 * 7. 返轨：从当前实际位姿重规划直上爬升（Pro §8.5），不倒放主腿；
 * 8. 天文时钟协同：下降自动 1x，返轨恢复（用户期间手动改过则不覆盖）。
 */

import type { LandingSite, LandingState, LandingTelemetry } from '../contracts/landing';
import { LANDING_SITES } from '../contracts/landing';
import { TerrainHeightProvider } from './TerrainHeightProvider';
import { sampleDescent, smootherstep, smootherstepDerivative, latLonDirection as latLonDir, horizonDip, pitchForHorizonElevation, type DescentLeg } from '../world-support/descentCurve';

export type TelemetryListener = (telemetry: LandingTelemetry) => void;

export interface DescentStartPose {
  latDeg: number;
  lonDeg: number;
  /** 当前机位相对基准球的净空（米）——P3b-B 起一律为 datum 口径 */
  clearanceM: number;
}

export class LandingController {
  private state: LandingState = 'ORBIT';
  private site: LandingSite = LANDING_SITES['taurus-littrow'];

  // 参考曲线腿：P3b-B 单一连续腿（接近+主下降合并，无段边界零速停顿）
  private legs: DescentLeg[] = [];
  private legIndex = 0;
  private elapsedSec = 0;
  private ascendSec: number = 0; // ASCENDING 剩余时长
  private ascendTotalSec: number = 18.0;
  /** P3b-B：返轨起点（returnToOrbit 时从当前实际轨迹位姿捕获，重规划基准） */
  private ascendFrom: { latDeg: number; lonDeg: number; datumM: number } | null = null;
  private ascendTargetM = 50000;
  private completedAscent = false;
  /** P3b-B：路线切向航向最后稳定值（接近落点退化时保持，返轨/接地沿用） */
  private lastTangentHeadingDeg: number = 225;

  private readonly ORBIT_ALTITUDE_M = 50000.0; // 近月下降段上限
  private SURFACE_EYE_HEIGHT_M = 1.7; // 默认人眼视高；地表书签可恢复保存的眼高

  private targetLat: number;
  private targetLon: number;

  // 地面默认视线（仅 SURFACE_LOOK 导出用；用户接管后引擎不再覆盖）
  private surfaceYawDeg = 225.0;
  private surfacePitchDeg = 12.0;

  // 用户交互状态
  private userInterrupted = false;

  // 物理时间调谐记忆
  private simTimeAdjusted = false;
  private timeScaleChosenByUser = false;
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

  /**
   * S4c：切换任务站点（下降流泛化——月/火多站共用一个状态机）。
   * 仅 ORBIT 态允许（任务进行中切换会破坏轨迹/遥测语义，拒绝并返回 false）。
   */
  public switchSite(siteId: string): boolean {
    const next = LANDING_SITES[siteId];
    if (!next || this.state !== 'ORBIT') return false;
    if (next.id === this.site.id) return true;
    this.site = next;
    this.targetLat = next.centerLat;
    this.targetLon = next.centerLon;
    this.lastTangentHeadingDeg = 225;
    this.notifyTelemetry();
    return true;
  }

  public getState(): LandingState {
    return this.state;
  }

  public restoreSurfaceStation(siteId: string, lat: number, lon: number, eyeHeight: number): boolean {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(eyeHeight) || eyeHeight <= 0 || !this.switchSite(siteId)) return false;
    this.targetLat = lat;
    this.targetLon = lon;
    this.SURFACE_EYE_HEIGHT_M = eyeHeight;
    this.state = 'SURFACE_LOOK';
    this.notifyTelemetry();
    return true;
  }

  public getSite(): LandingSite {
    return this.site;
  }

  /** 当前下降进度（跨腿折算 0..1，供 HUD 进度条） */
  public getProgress(): number {
    if (this.state === 'ASCENDING') return Math.max(0, Math.min(1, 1 - this.ascendSec / Math.max(1, this.ascendTotalSec)));
    if (this.state === 'PREPARING' || this.state === 'ORBIT') return 0;
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
    if (Math.abs(this.surfaceYawDeg-yawDeg)<0.001 && Math.abs(this.surfacePitchDeg-pitchDeg)<0.001) return;
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
    this.completedAscent = false;
    this.timeScaleChosenByUser = false;
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
  public cancelPreparation(setTimeScale?: (scale: number) => void): void {
    if (this.state === 'PREPARING') {
      this.cancel(setTimeScale);
    }
  }

  public acquireTimeScaleOverride(getTimeScale: () => number, setTimeScale: (scale:number) => void, newJourney = false): void {
    if (newJourney) this.timeScaleChosenByUser = false;
    if (this.timeScaleChosenByUser) return;
    if (getTimeScale() > 1) {
      if (!this.simTimeAdjusted) this.originalTimeScale = getTimeScale();
      this.simTimeAdjusted = true;
      setTimeScale(1);
    }
  }

  public restoreTimeScaleOverride(setTimeScale: (scale:number) => void): void {
    if (this.simTimeAdjusted) setTimeScale(this.originalTimeScale);
    this.simTimeAdjusted = false;
  }

  private beginDescent(
    getTimeScale?: () => number,
    setTimeScale?: (scale: number) => void,
    startPose?: DescentStartPose
  ): void {
    this.SURFACE_EYE_HEIGHT_M = 1.7;
    this.targetLat = this.site.centerLat;
    this.targetLon = this.site.centerLon;
    // 天文时间协同：临时下调到 1x
    if (getTimeScale && setTimeScale) {
      this.acquireTimeScaleOverride(getTimeScale, setTimeScale);
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
    // P3b-B（Pro §4.2/B1）：单一连续腿替代 接近段+主段 两段拼片——段边界不再各自零速
    // 停顿；总时长按起点净空对数伸缩（~50s 预算，低空起步自然裁短）。
    // 高度一律用基准面高程（datum）规划，跨 DTM 窗口边界无基准跳变；终端段由
    // 引擎按 AGL 权重混合（§3.4）。
    const startDatumM = Math.max(from.clearanceM, this.site.elevationDatumOffsetM + this.SURFACE_EYE_HEIGHT_M);
    const endDatumM = this.site.elevationDatumOffsetM + this.SURFACE_EYE_HEIGHT_M;
    const totalSec = Math.max(
      12,
      Math.min(55, 10 + 11 * Math.log10(Math.max(10, startDatumM - endDatumM) / 100))
    );
    const radiusM = this.site.datumRadiusKm * 1000;

    this.legs = [{
      from: { latDeg: from.latDeg, lonDeg: from.lonDeg, clearanceM: startDatumM },
      to: { latDeg: this.targetLat, lonDeg: this.targetLon, clearanceM: endDatumM },
      durationSec: totalSec,
      radiusM,
    }];
    // P3b-B：起始姿态不再走 yaw/pitch 混合——引擎持有同帧捕获的完整 q0
    //（含滚转），以地平线投影目标 + 角速率受限收敛（见 SolarEngine）。

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

  public returnToOrbit(actualPose?: DescentStartPose): void {
    if (this.state === 'SURFACE_LOOK' || this.state === 'HOLD' || this.state === 'DESCENDING') {
      // P3b-B（Pro §8.5）：返轨从当前实际位姿重规划——不再把半路返轨当作已到
      // 落点后倒放完整主腿。当前位置水平不动，垂直爬升到轨道高度。
      const traj = this.evaluateTrajectory();
      this.ascendFrom = actualPose
        ? { latDeg: actualPose.latDeg, lonDeg: actualPose.lonDeg, datumM: actualPose.clearanceM }
        : { latDeg: traj.lat, lonDeg: traj.lon, datumM: traj.altitudeMSLM };
      const radiusM = this.site.datumRadiusKm * 1000;
      // An abort above the old 50 km ceiling must still climb. Keep the current
      // side of the body and leave room for a local orbital view, not a reset.
      this.ascendTargetM = Math.max(radiusM * 0.18, this.ascendFrom.datumM + radiusM * 0.08, this.ascendFrom.datumM * 1.35);
      this.completedAscent = false;
      const climbM = this.ascendTargetM - this.ascendFrom.datumM;
      this.ascendTotalSec = Math.max(6, Math.min(18, 4 + 7 * Math.log10(climbM / 100)));
      this.ascendSec = this.ascendTotalSec;
      this.state = 'ASCENDING';
      this.notifyTelemetry();
    }
  }

  /** 两地面点方向向量点积（对跖判定用） */
  private dotOf(latA: number, lonA: number, latB: number, lonB: number): number {
    const a = latLonDir(latA, lonA);
    const b = latLonDir(latB, lonB);
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  /** A deliberate user speed choice revokes the temporary landing override. */
  public releaseTimeScaleOverride(): void {
    this.simTimeAdjusted = false;
    this.timeScaleChosenByUser = true;
  }

  public cancel(setTimeScale?: (scale: number) => void): void {
    this.state = 'ORBIT';
    this.legs = [];
    this.legIndex = 0;
    this.elapsedSec = 0;
    this.userInterrupted = false;
    this.completedAscent = false;
    this.ascendFrom = null;

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
      this.ascendSec = Math.max(0, this.ascendSec - deltaSec);
      if (this.ascendSec <= 0) {
        // Retain the actual endpoint for the engine's final rendered frame.
        // cancel() clears it and would make that frame jump to the landing site.
        this.completedAscent = true;
        this.state = 'ORBIT';
        if (this.simTimeAdjusted && setTimeScale) setTimeScale(this.originalTimeScale);
        this.simTimeAdjusted = false;
        this.notifyTelemetry();
      } else {
        this.notifyTelemetry();
      }
    }
  }

  /**
   * 当前轨迹点（body-fixed 地面点 + 基准面高 + 切向航向）。
   * P3b-B 语义：规划量一律是基准面高 H（datumAltitudeM = altitudeMSLM），
   * altitudeAGLM = H − elev(lat,lon) 为报告量而非规划量；相机姿态由引擎用
   * 地平线投影 + 实际 FOV 计算四元数，控制器只提供名义导引（HUD 显示用）。
   * cameraYawDeg/cameraPitchDeg 为 null 表示用户已接管视线。
   */
  public evaluateTrajectory(): {
    lat: number;
    lon: number;
    /** 相机相对基准球高度 H（米）＝ MSL：位置规划量 */
    datumAltitudeM: number;
    altitudeAGLM: number;
    altitudeMSLM: number;
    /** 路线切向航向（站点局部基，顺时针自北）：姿态导引的偏航目标 */
    tangentHeadingDeg: number;
    cameraPitchDeg: number | null;
    cameraYawDeg: number | null;
    commandedClearanceRateMps: number;
    commandedTangentialSpeedMps: number;
  } {
    if (this.state === 'SURFACE_LOOK') {
      const elevM = this.heightProvider.getHeightMeters(this.site.bodyId, this.targetLat, this.targetLon);
      return {
        lat: this.targetLat,
        lon: this.targetLon,
        datumAltitudeM: elevM + this.SURFACE_EYE_HEIGHT_M,
        altitudeAGLM: this.SURFACE_EYE_HEIGHT_M,
        altitudeMSLM: elevM + this.SURFACE_EYE_HEIGHT_M,
        tangentHeadingDeg: this.lastTangentHeadingDeg,
        cameraPitchDeg: this.surfacePitchDeg,
        cameraYawDeg: this.surfaceYawDeg,
        commandedClearanceRateMps: 0,
        commandedTangentialSpeedMps: 0,
      };
    }

    if (this.state === 'ASCENDING' || (this.state === 'ORBIT' && this.completedAscent)) {
      // P3b-B（Pro §8.5）：从捕获的当前位姿直上爬升（水平不动）到轨道高度。
      // 不再倒放主腿——半路返轨的起点就是当前实际位置。
      const from =
        this.ascendFrom ??
        (() => {
          const elevM = this.heightProvider.getHeightMeters(this.site.bodyId, this.targetLat, this.targetLon);
          return {
            latDeg: this.targetLat,
            lonDeg: this.targetLon,
            datumM: elevM + this.SURFACE_EYE_HEIGHT_M,
          };
        })();
      const total = Math.max(1, this.ascendTotalSec);
      const t = Math.max(0, Math.min(1, 1 - this.ascendSec / total));
      const s = smootherstep(t);
      const H = from.datumM + (this.ascendTargetM - from.datumM) * s;
      const elevM = this.heightProvider.getHeightMeters(this.site.bodyId, from.latDeg, from.lonDeg);
      const rate = ((this.ascendTargetM - from.datumM) * smootherstepDerivative(t)) / total;
      return {
        lat: from.latDeg,
        lon: from.lonDeg,
        datumAltitudeM: H,
        altitudeAGLM: H - elevM,
        altitudeMSLM: H,
        tangentHeadingDeg: this.lastTangentHeadingDeg,
        cameraPitchDeg: this.userInterrupted ? null : this.nominalHorizonPitchDeg(H),
        cameraYawDeg: this.userInterrupted ? null : this.lastTangentHeadingDeg,
        commandedClearanceRateMps: rate,
        commandedTangentialSpeedMps: 0,
      };
    }

    const leg = this.legs[this.legIndex];
    if (!leg) {
      // PREPARING/ORBIT 无轨迹
      return {
        lat: this.targetLat,
        lon: this.targetLon,
        datumAltitudeM: this.ORBIT_ALTITUDE_M,
        altitudeAGLM: this.ORBIT_ALTITUDE_M,
        altitudeMSLM: this.ORBIT_ALTITUDE_M,
        tangentHeadingDeg: this.lastTangentHeadingDeg,
        cameraPitchDeg: this.userInterrupted ? null : this.surfacePitchDeg,
        cameraYawDeg: this.userInterrupted ? null : this.surfaceYawDeg,
        commandedClearanceRateMps: 0,
        commandedTangentialSpeedMps: 0,
      };
    }

    const s = sampleDescent(leg, this.elapsedSec);
    const elevM = this.heightProvider.getHeightMeters(this.site.bodyId, s.latDeg, s.lonDeg);
    const H = s.clearanceM;
    const headingDeg = this.updateTangentHeading(s.latDeg, s.lonDeg);
    return {
      lat: s.latDeg,
      lon: s.lonDeg,
      datumAltitudeM: H,
      altitudeAGLM: H - elevM,
      altitudeMSLM: H,
      tangentHeadingDeg: headingDeg,
      cameraPitchDeg: this.userInterrupted ? null : this.nominalHorizonPitchDeg(H),
      cameraYawDeg: this.userInterrupted ? null : headingDeg,
      commandedClearanceRateMps: s.commandedClearanceRateMps,
      commandedTangentialSpeedMps: s.commandedTangentialSpeedMps,
    };
  }

  /**
   * P3b-B：路线切向航向（大圆初始方位角，站点局部基顺时针自北）。
   * 与 CameraController 的 yaw 约定一致（atan2(f·e, f·n)）；接近落点时
   * 方位角退化，保持最后稳定值。有评估副作用（更新 lastTangentHeadingDeg），
   * 仅供 evaluateTrajectory 调用。
   */
  private updateTangentHeading(latDeg: number, lonDeg: number): number {
    const φ1 = (latDeg * Math.PI) / 180;
    const φ2 = (this.targetLat * Math.PI) / 180;
    const Δλ = ((this.targetLon - lonDeg + 540) % 360) * (Math.PI / 180) - Math.PI;
    const sep = Math.acos(
      Math.max(-1, Math.min(1, this.dotOf(latDeg, lonDeg, this.targetLat, this.targetLon)))
    );
    if (sep > 1e-6) {
      const bearing =
        Math.atan2(
          Math.sin(Δλ) * Math.cos(φ2),
          Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
        ) *
        (180 / Math.PI);
      this.lastTangentHeadingDeg = ((bearing % 360) + 360) % 360;
    }
    return this.lastTangentHeadingDeg;
  }

  /** P3b-B：名义导引俯仰（HUD 显示用；引擎用实际 FOV 计算权威四元数） */
  private nominalHorizonPitchDeg(datumAltitudeM: number): number {
    const radiusM = this.site.datumRadiusKm * 1000;
    const dip = horizonDip(radiusM, Math.max(0, datumAltitudeM));
    const pitch = pitchForHorizonElevation(-dip, (45 * Math.PI) / 180, 0.32);
    return Math.max(-89, Math.min(89, (pitch * 180) / Math.PI));
  }

  public getTelemetry(): LandingTelemetry {
    const traj = this.evaluateTrajectory();

    // 速度语义：commanded 净空变化率（参考曲线真实导数），非数值微分、非 MSL 变化率
    let verticalSpeedMps = 0;
    if (this.state === 'DESCENDING') {
      verticalSpeedMps = Number(traj.commandedClearanceRateMps.toFixed(1));
    } else if (this.state === 'ASCENDING') {
      verticalSpeedMps = Number(traj.commandedClearanceRateMps.toFixed(1));
    }

    const sample = this.heightProvider.getHeightSample(this.site.bodyId, traj.lat, traj.lon);
    const provenance = this.heightProvider.getAdmissionState(this.site.bodyId);

    return {
      state: this.state,
      site: this.site,
      altitudeAGLM: Number(traj.altitudeAGLM.toFixed(1)),
      altitudeMSLM: Number(traj.altitudeMSLM.toFixed(1)),
      verticalSpeedMps,
      verticalSpeedSemantics: 'commanded-clearance-rate',
      horizontalSpeedMps: this.state === 'DESCENDING' ? Number(traj.commandedTangentialSpeedMps.toFixed(1)) : 0,
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
