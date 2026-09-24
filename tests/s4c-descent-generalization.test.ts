/**
 * S4c 测试：下降流泛化（月/火多站共用一个状态机）
 * - switchSite 站点切换语义（ORBIT-only、非法站点拒绝）
 * - 火星站点的控制器全链：起点捕获 → 单腿轨迹（mars datum）→ 触地遥测
 *   （高程路由 jezero not-loaded → fidelity null，不伪造）
 * - 对跖起点拒绝（Pro §3.2：不修改起点规避）
 */
import { describe, it, expect } from 'vitest';
import { LandingController } from '../src/surface/LandingController';
import { LANDING_SITES } from '../src/contracts/landing';

describe('S4c：下降流泛化', () => {
  it('switchSite：ORBIT 态可切换并更新站点/body；非法 id 拒绝', () => {
    const ctl = new LandingController('taurus-littrow');
    expect(ctl.getSite().bodyId).toBe('moon');
    expect(ctl.switchSite('jezero')).toBe(true);
    expect(ctl.getSite().id).toBe('jezero');
    expect(ctl.getSite().bodyId).toBe('mars');
    expect(ctl.switchSite('no-such-site')).toBe(false);
    expect(ctl.getSite().id).toBe('jezero');
  });

  it('火星站点下降轨迹：datum/半径/时长按站点契约规划，遥测如实标注未装载', () => {
    const ctl = new LandingController('jezero');
    ctl.startDescent();
    expect(ctl.getState()).toBe('PREPARING');
    // 引擎准备完成的同款调用（Node 环境：数据未装载不影响轨迹规划——规划量全为 datum 口径）
    ctl.completePreparation(undefined, undefined, {
      latDeg: LANDING_SITES['jezero'].centerLat - 0.05,
      lonDeg: LANDING_SITES['jezero'].centerLon - 0.05,
      clearanceM: 50000,
    });
    expect(ctl.getState()).toBe('DESCENDING');
    ctl.update(1.0); // 推进 1s：smootherstep 起步后 H 开始下降（t=0 时恒为起点 50000）
    const traj = ctl.evaluateTrajectory();
    expect(traj.datumAltitudeM).toBeLessThan(50000);
    expect(traj.datumAltitudeM).toBeGreaterThan(LANDING_SITES['jezero'].elevationDatumOffsetM);
    // 窗外高程回退基准球 0（Node 未装载 → getHeightMeters 0）——AGL = H
    expect(traj.altitudeAGLM).toBeCloseTo(traj.datumAltitudeM, 6);
    // 遥测溯源：jezero 未装载 → fidelity null + admission unavailable（不伪造 measured）
    const tele = ctl.getTelemetry();
    expect(tele.site.id).toBe('jezero');
    expect(tele.terrain.fidelity).toBeNull();
    expect(tele.terrain.admissionState).toBe('unavailable');
  });

  it('对跖起点拒绝（RangeError，不修改起点规避）', () => {
    const ctl = new LandingController('jezero');
    ctl.startDescent();
    const site = LANDING_SITES['jezero'];
    expect(() =>
      ctl.completePreparation(undefined, undefined, {
        latDeg: -site.centerLat,
        lonDeg: site.centerLon + 180,
        clearanceM: 50000,
      })
    ).toThrow(RangeError);
    expect(ctl.getState()).toBe('PREPARING'); // 拒绝启动，不进入 DESCENDING
  });

  it('任务进行中禁止切换站点（状态机语义保护）', () => {
    const ctl = new LandingController('taurus-littrow');
    ctl.startDescent();
    expect(ctl.switchSite('jezero')).toBe(false);
    expect(ctl.getSite().id).toBe('taurus-littrow');
  });
});
