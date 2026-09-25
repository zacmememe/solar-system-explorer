// R4（260925 基础体验恢复·第四批）：旅行事务抢占 + 拾取可见性回归探针。
// 断言：
//  1) DESCENDING 中 flyTo earth → 下降任务被撤销（ORBIT）、相机不再被
//     applyLandingFrame 拉回（改前两套任务轮流写相机）
//  2) 隐藏系统不抢点击：物理模式（earth 参考）下点击被隐藏天体的屏幕位置，
//     selectedBody 不变（Raycaster 祖先可见过滤）
import puppeteer from 'puppeteer-core';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:5199';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=d3d11', '--enable-webgl', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const consoleErrs: string[] = [];
  page.on('pageerror', (e) => consoleErrs.push(`[pageerror] ${String(e).slice(0, 160)}`));
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window as any).__solarEngine?.camera, { timeout: 30000 });

  const flyTo = (b: string) =>
    page.evaluate((body: string) => {
      (window as any).__solarEngine.executeCameraCommand({ type: 'flyTo', bodyId: body, durationSec: 1.0 });
    }, b);
  const settle = () =>
    page.waitForFunction(() => {
      const s = (window as any).__solarEngine.cameraController.getSnapshot();
      return !s.isTransitioning;
    }, { timeout: 60000, polling: 300 });

  // ---- 1) 下降中旅行抢占 ----
  await flyTo('moon');
  await settle();
  await page.evaluate(() => {
    const e = (window as any).__solarEngine;
    e.cameraController.executeCommand({ type: 'select', bodyId: 'moon' });
    e.cameraController.executeCommand({ type: 'flyTo', bodyId: 'moon', durationSec: 0.8 });
  });
  await new Promise((r) => setTimeout(r, 3000));
  let availReady = await page.evaluate(() => (window as any).__solarEngine.getLandingAvailability().action);
  if (availReady === 'travel-to-site') {
    // 落区在背面：前往着陆区上空（球外绕行）
    await page.evaluate(() => (window as any).__solarEngine.travelToLandingSite());
    await new Promise((r) => setTimeout(r, 4200));
    await page.waitForFunction(() => (window as any).__solarEngine.getLandingAvailability().action === 'land', {
      timeout: 45000, polling: 400,
    });
    availReady = 'land';
  }
  if (availReady !== 'land') throw new Error(`月球下降前置不满足: ${availReady}`);
  const started = await page.evaluate(() => (window as any).__solarEngine.startLunarLanding());
  if (!started) throw new Error('startLunarLanding rejected');
  // 等 DESCENDING（准备流水线完成后）
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingTelemetry().state === 'DESCENDING', {
    timeout: 120000, polling: 500,
  });
  console.log('[1] descending confirmed');
  // 下降中明确前往地球
  await flyTo('earth');
  await new Promise((r) => setTimeout(r, 500));
  const afterTravel = await page.evaluate(() => {
    const e = (window as any).__solarEngine;
    return {
      landingState: e.getLandingTelemetry().state,
      camTarget: e.cameraController.getSnapshot().targetBodyId,
    };
  });
  console.log('[2] flyTo during descent =', JSON.stringify(afterTravel));
  if (afterTravel.landingState !== 'ORBIT') throw new Error(`下降任务未被旅行撤销: ${afterTravel.landingState}`);
  if (afterTravel.camTarget !== 'earth') throw new Error(`相机目标未切地球: ${afterTravel.camTarget}`);
  // 飞行完成后 1.5s，相机不被拉回（仍在地球附近——距地球 < 12R）
  await settle();
  await new Promise((r) => setTimeout(r, 1500));
  const stable = await page.evaluate(() => {
    const e = (window as any).__solarEngine;
    const pose = e.getBodyWorldPose('earth');
    const d = e.camera.position.distanceTo(pose.pos) / pose.surfaceRadius;
    const moonPose = e.getBodyWorldPose('moon');
    const dm = e.camera.position.distanceTo(moonPose.pos) / moonPose.surfaceRadius;
    return { distOverEarthR: +d.toFixed(2), distOverMoonR: +dm.toFixed(2), landing: e.getLandingTelemetry().state };
  });
  console.log('[3] camera settled =', JSON.stringify(stable));
  if (stable.distOverEarthR > 12) throw new Error(`相机未稳定在地球附近: ${stable.distOverEarthR}R`);
  if (stable.landing !== 'ORBIT') throw new Error('下降任务复活');

  // ---- 2) 隐藏系统不抢点击 ----
  // 物理模式（earth 参考）：其他行星系统 systemGroup.visible=false。
  // 把火星投影到屏幕，点击其位置——不应选中火星（隐藏链过滤）
  await page.evaluate(() => {
    (window as any).__solarEngine.setPresentationPolicy('PHYSICAL_OBSERVATION', 0.4);
    (window as any).__solarEngine.cameraController.executeCommand({ type: 'select', bodyId: 'earth' });
  });
  await new Promise((r) => setTimeout(r, 2500));
  interface ClickInfo { hidden: boolean; ndc: number[]; selectedBefore: string }
  const clickInfo = (await page.evaluate(`(() => {
    const e = window.__solarEngine;
    const THREE = window.THREE;
    const node = e.bodyNodes.get('mars');
    const wp = new THREE.Vector3();
    node.systemGroup.getWorldPosition(wp);
    const ndc = wp.clone().project(e.camera);
    const hidden = !node.systemGroup.visible;
    return {
      hidden,
      ndc: [ +ndc.x.toFixed(3), +ndc.y.toFixed(3), +ndc.z.toFixed(3) ],
      selectedBefore: e.cameraController.getSnapshot().selectedBodyId,
    };
  })()`)) as unknown as ClickInfo;
  console.log('[4] mars projection =', JSON.stringify(clickInfo));
  if (!clickInfo.hidden) throw new Error('物理模式下火星未隐藏（前置不成立）');
  if (Math.abs(clickInfo.ndc[0]) > 0.95 || Math.abs(clickInfo.ndc[1]) > 0.95 || clickInfo.ndc[2] > 1) {
    console.log('[skip] 火星不在视锥内——跳过点击断言（可见性已由单测覆盖）');
  } else {
    const sx = Math.round(((clickInfo.ndc[0] + 1) / 2) * 1440);
    const sy = Math.round(((1 - clickInfo.ndc[1]) / 2) * 900);
    await page.mouse.click(sx, sy);
    await new Promise((r) => setTimeout(r, 400));
    const after = await page.evaluate(() => ({
      selected: (window as any).__solarEngine.cameraController.getSnapshot().selectedBodyId,
    }));
    console.log(`[5] click hidden mars @(${sx},${sy}) =`, JSON.stringify(after));
    if (after.selected === 'mars') throw new Error('隐藏的火星被点击选中（过滤失效）');
  }

  console.log('[errors]', consoleErrs.length ? consoleErrs.slice(0, 8).join(' | ') : '(none)');
  await browser.close();
  console.log('R4 PROBE DONE');
}

main().catch((e) => { console.error('R4 PROBE FAILED:', e); process.exit(1); });
