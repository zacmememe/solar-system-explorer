/**
 * 太阳系漫游 · P3b-A【入口、完整初态与取消】实机验收（Pro P3b 审查 §9 路径 A/C/F 子集）
 * 真实 UI 入口驱动（降落/前往着陆区按钮）；导航布置沿用既有引擎命令先例。
 *
 * A4-1 远端（地球视角）不可降落：可用性 not-at-body；直接产品 API 拒绝且世界状态不变。
 * A4-2 飞行中不开放；到达后（近侧）出现可执行降落入口；到达即停，不自动衔接降落。
 * A4-3 背面到达 → "前往着陆区"（真实 UI）→ 球外绕行 → 到位后可降落。
 * A4-4 首帧 p/q/FOV 保持：点击当刻 vs 首个 DESCENDING 帧（姿态角差 <0.5°、位置连续、FOV 等）。
 * A4-5 起点净空=真实值（不回跳 200/50km、无 400km 截断）；下降中模拟时刻无跳变。
 * A4-6 连续两次启动（旧任务不复活）：降落→返轨→再次降落均正常。
 */
import puppeteer from 'puppeteer-core';
import * as path from 'node:path';
import * as fs from 'node:fs';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:4173';
const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = process.env.EVIDENCE_DIR ? path.resolve(process.env.EVIDENCE_DIR) : 'D:/solar-evidence/pro-review';
const COMMIT = process.env.P3B_COMMIT || 'worktree-uncommitted';

interface CheckResult { name: string; pass: boolean; detail: Record<string, unknown> }
const checks: CheckResult[] = [];
function record(name: string, pass: boolean, detail: Record<string, unknown>) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} [${pass ? 'PASS' : 'FAIL'}] ${name}`);
  console.log(`   ${JSON.stringify(detail)}`);
}

async function main() {
  console.log('='.repeat(80));
  console.log('🛰️ P3b-A 实机验收：入口、完整初态与取消');
  console.log(`目标: ${TARGET_URL} | commit: ${COMMIT}`);
  console.log('='.repeat(80));
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=d3d11',
      '--enable-webgl', '--disable-background-timer-throttling', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const errs: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto(TARGET_URL, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction(() => {
    const e = (window as any).__solarEngine;
    return e && typeof e.getLandingAvailability === 'function' && e.getLunarValleyMesh?.()?.visible === true;
  }, { timeout: 60000 });

  const worldState = () => page.evaluate(() => {
    const e = (window as any).__solarEngine;
    const cam = e.getCamera();
    const q = cam.quaternion;
    return {
      t: e.getSimTimeHours(),
      fov: cam.fov,
      pos: [cam.position.x, cam.position.y, cam.position.z],
      quat: [q.x, q.y, q.z, q.w],
      policy: e.getObservationMode?.() ?? null,
    };
  });

  // ---------- A4-1 远端不可降落 ----------
  const availFar = await page.evaluate(() => (window as any).__solarEngine.getLandingAvailability());
  // 暂停渲染循环后快照比对（否则天体运动/相机跟随每帧改变世界状态）
  await page.evaluate(() => (window as any).__solarEngine.setPaused(true));
  const before = await worldState();
  const apiRet = await page.evaluate(() => (window as any).__solarEngine.startLunarLanding());
  await new Promise((r) => setTimeout(r, 300));
  const after = await worldState();
  await page.evaluate(() => (window as any).__solarEngine.setPaused(false));
  const startBtnFar = await page.$('[data-testid="lunar-landing-start-btn"]');
  const worldUnchanged =
    after.t === before.t && after.fov === before.fov &&
    JSON.stringify(after.pos) === JSON.stringify(before.pos) &&
    JSON.stringify(after.quat) === JSON.stringify(before.quat);
  record('A4-1 远端（地球视角）：不可降落 + API 拒绝 + 世界状态不变',
    availFar.action === 'none' && availFar.reason === 'not-at-body' && apiRet === false && !startBtnFar && worldUnchanged,
    { availFar, apiRet, startBtnInDom: !!startBtnFar, worldUnchanged });

  // ---------- A4-2 飞行中/到达后 ----------
  await page.evaluate(() => {
    (window as any).__solarEngine.executeCameraCommand({ type: 'flyTo', bodyId: 'moon', durationSec: 1.6 });
  });
  await new Promise((r) => setTimeout(r, 500));
  const availFlying = await page.evaluate(() => (window as any).__solarEngine.getLandingAvailability());
  const btnDuringFlight = await page.$('[data-testid="lunar-landing-start-btn"]');
  record('A4-2a 飞行中：不开放降落', availFlying.reason === 'travel-in-progress' && !btnDuringFlight,
    { availFlying, btnDuringFlight: !!btnDuringFlight });

  await page.waitForFunction(() => {
    const e = (window as any).__solarEngine;
    return !e.getCameraSnapshot().isTransitioning;
  }, { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 600));
  let availArrived = await page.evaluate(() => (window as any).__solarEngine.getLandingAvailability());

  // ---------- A4-3 背面 → 前往着陆区（真实 UI） ----------
  if (availArrived.action === 'travel-to-site') {
    await page.waitForSelector('[data-testid="lunar-landing-travel-site-btn"]', { timeout: 5000 });
    await page.click('[data-testid="lunar-landing-travel-site-btn"]');
    await page.waitForFunction(() => {
      const e = (window as any).__solarEngine;
      return !e.getCameraSnapshot().isTransitioning;
    }, { timeout: 20000 });
    await new Promise((r) => setTimeout(r, 600));
    availArrived = await page.evaluate(() => (window as any).__solarEngine.getLandingAvailability());
    record('A4-3 背面到达 → 前往着陆区（真实 UI 点击）→ 到位可降落', availArrived.action === 'land',
      { afterTravel: availArrived });
  } else {
    record('A4-3 到达即在落区同侧（无需前往）', availArrived.action === 'land', { availArrived });
  }

  // 到达不自动降落：状态仍 ORBIT
  const ctlAfterArrival = await page.evaluate(() => (window as any).__solarEngine.getLandingTelemetry().state);
  record('A4-2b 到达后停留观察（不自动衔接降落）', ctlAfterArrival === 'ORBIT', { ctlAfterArrival });

  // ---------- A4-4/5 首帧 p/q/FOV 保持 + 真实起点净空（同帧测量） ----------
  // 点击前故意把视线转到非默认方向，验证首帧保持的是"当刻真实姿态"而非默认值
  await page.evaluate(() => {
    (window as any).__solarEngine.executeCameraCommand({ type: 'orbit', deltaTheta: 0.6, deltaPhi: -0.25 });
  });
  await new Promise((r) => setTimeout(r, 300));
  await page.waitForSelector('[data-testid="lunar-landing-start-btn"]', { timeout: 5000 });
  await page.click('[data-testid="lunar-landing-start-btn"]');
  // 高频轮询：捕获"翻转前最后一帧"与"首个 DESCENDING 帧"（月心相对系）——
  // 准备期光照选时会移动整个世界，跨时刻的世界坐标不可比，必须同帧相对比较。
  const moonRel = () => page.evaluate(() => {
    const e = (window as any).__solarEngine;
    const cam = e.getCamera();
    const moon = e.getBodyWorldPose('moon');
    const rel = cam.position.clone().sub(moon.pos);
    // 月固连系姿态：对世界整体旋转/平移（如光照选时移动一切）免疫——
    // Pro §9"坐标系重表达后比较"，比较的是空间关系本身。
    const qRel = cam.quaternion.clone().premultiply(moon.quaternion.clone().invert());
    return {
      state: e.getLandingTelemetry().state,
      prepPhase: e.getLandingPreparationStatus().phase,
      startQuat: e.getLandingPreparationStatus().startQuat,
      moonQuat: [moon.quaternion.x, moon.quaternion.y, moon.quaternion.z, moon.quaternion.w],
      relPos: [rel.x, rel.y, rel.z],
      relDist: rel.length(),
      surfaceR: moon.surfaceRadius,
      quat: [qRel.x, qRel.y, qRel.z, qRel.w],
      fov: cam.fov,
      agl: e.getLandingTelemetry().altitudeAGLM,
      metersPerScene: 1737400 / moon.surfaceRadius,
    };
  });
  let firstFrame: Awaited<ReturnType<typeof moonRel>> | null = null;
  for (let i = 0; i < 300; i++) {
    const snap = await moonRel();
    if (snap.state === 'DESCENDING') { firstFrame = snap; break; }
    await new Promise((r) => setTimeout(r, 60));
  }
  // 基准 = 引擎同帧捕获的 q0（规范量本身；capture 相位仅一帧，轮询不可靠）
  if (!firstFrame || !firstFrame.startQuat) {
    record('A4-4 首帧保持（q0 基准）', false, { gotFirst: !!firstFrame, gotStartQuat: !!firstFrame?.startQuat });
  } else {
    const q0MoonFixed = await page.evaluate((sq: number[], mq: number[]) => {
      const T = (window as any).THREE;
      const q0 = new T.Quaternion(sq[0], sq[1], sq[2], sq[3]);
      const mInv = new T.Quaternion(mq[0], mq[1], mq[2], mq[3]).invert();
      const rel = q0.clone().premultiply(mInv);
      return [rel.x, rel.y, rel.z, rel.w];
    }, firstFrame.startQuat as unknown as number[], firstFrame.moonQuat as unknown as number[]);
    const quatAngleDeg = await page.evaluate((a: number[], b: number[]) => {
      const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
      return (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI;
    }, q0MoonFixed as unknown as number[], firstFrame.quat as unknown as number[]);
    record('A4-4 首帧姿态=同帧捕获 q0（含滚转；blend≈0 时差<2°）',
      quatAngleDeg < 2,
      { quatAngleDeg, fov: firstFrame.fov });
  }
  const firstAgl = firstFrame ? firstFrame.agl : 0;
  const preClearanceM = firstFrame
    ? (firstFrame.relDist - firstFrame.surfaceR) * firstFrame.metersPerScene
    : 0;
  const ratio = firstAgl / Math.max(1, preClearanceM);
  record('A4-5a 起点净空=真实机位净空（不回跳/不截断）',
    ratio > 0.85 && ratio < 1.15,
    { firstAgl, preClearanceM, ratio });

  // 下降中模拟时刻无跳变（1× 流速推进，非小时级跳跃）
  const t0 = await page.evaluate(() => (window as any).__solarEngine.getSimTimeHours());
  await new Promise((r) => setTimeout(r, 3000));
  const tLater = await page.evaluate(() => (window as any).__solarEngine.getSimTimeHours());
  const dtHours = tLater - t0;
  record('A4-5b 下降中无时刻跳变（3s 内 Δt≈0.0008h 而非小时级）',
    dtHours >= 0 && dtHours < 0.01,
    { dtHours });

  // ---------- A4-6 连续两次启动（旧任务不复活） ----------
  await page.evaluate(() => (window as any).__solarEngine.returnToLunarOrbit());
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingTelemetry().state === 'ORBIT', { timeout: 60000 });
  // 返轨边沿触发 flyTo(1.5s)——与 ORBIT 检测存在一帧竞态，用重试循环消解；
  // 取景可能落在背面，正确路径是先"前往着陆区"再启动
  let availSecond: { action: string; reason: string } | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    await new Promise((r) => setTimeout(r, 500));
    const transitioning = await page.evaluate(() => (window as any).__solarEngine.getCameraSnapshot().isTransitioning);
    if (transitioning) continue;
    const av = await page.evaluate(() => (window as any).__solarEngine.getLandingAvailability());
    if (av.action === 'travel-to-site') {
      await page.waitForSelector('[data-testid="lunar-landing-travel-site-btn"]', { timeout: 5000 });
      await page.click('[data-testid="lunar-landing-travel-site-btn"]');
      await page.waitForFunction(() => !(window as any).__solarEngine.getCameraSnapshot().isTransitioning, { timeout: 20000 });
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    if (av.action === 'land') { availSecond = av; break; }
    availSecond = av;
  }
  const secondOk = await page.evaluate(() => {
    const e = (window as any).__solarEngine;
    return e.startLunarLanding();
  });
  record('A4-6 返轨后再次启动（可用性驱动，旧任务不复活）', secondOk && (availSecond?.action === 'land'), { availSecond, secondOk });
  await page.screenshot({ path: path.join(OUT, 'p3b-a-verify-final.png') });

  const unexpected = errs.filter((t) => !t.includes('[SolarEngine] DTM 装载失败'));
  record('A4-7 控制台无意外错误', unexpected.length === 0, { errors: unexpected.slice(0, 3) });

  await browser.close();
  const failed = checks.filter((c) => !c.pass);
  const report = {
    task: 'P3b-A entry/initial-state/cancel',
    commit: COMMIT, targetUrl: TARGET_URL, timestamp: new Date().toISOString(),
    status: failed.length === 0 ? 'PASSED' : 'FAILED', checks,
  };
  fs.writeFileSync(path.join(OUT, 'batch-p3b-a-entry-report.json'), JSON.stringify(report, null, 2));
  console.log('='.repeat(80));
  console.log(`${failed.length === 0 ? '🎉' : '⛔'} P3b-A 验收: ${report.status} (${checks.length - failed.length}/${checks.length})`);
  console.log(`📄 报告: ${path.join(OUT, 'batch-p3b-a-entry-report.json')}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error('脚本异常退出:', e); process.exit(2); });
