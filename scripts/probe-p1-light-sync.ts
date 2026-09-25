// P1 证据探针：挖孔补片克隆材质与本体光照同步（review-8deebfc 步骤）。
// 固定远景机位（补片 α≈1 可见、球缘入画），经真实路径驱动变化：
//   1) setSimTimeHours 推进模拟时间 → 引擎逐帧 copy sunDirection
//   2) setTeachingLight 切换补光
// 断言补片与本体的 sunDirection/teachingLight uniform 对象 identity 共享且值同步，
// 本体 uOpacity 恒 1 不被补片门控改写；并留存球缘回归截图。
// 证据存 D:\solar-evidence\p1-light-sync\。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:5199';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = 'D:/solar-evidence/p1-light-sync';

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=d3d11', '--enable-webgl', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 160)));
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window as any).__solarEngine?.camera, { timeout: 30000 });
  await page.waitForSelector('[data-testid="moon-btn-moon"]', { timeout: 15000 });
  await page.click('[data-testid="moon-btn-moon"]');
  await page.waitForFunction(() => {
    const s = (window as any).__solarEngine.getCameraSnapshot();
    return s.targetBodyId === 'moon' && !s.isTransitioning;
  }, { timeout: 120000, polling: 400 });
  await page.waitForSelector('[data-testid="landing-site-select"]', { timeout: 30000 });
  await page.select('[data-testid="landing-site-select"]', 'tranquility-base');
  await page.waitForFunction(() => {
    const st = (window as any).__solarEngine.moonSiteStacks.get('tranquility-base');
    return !!(st && st.built);
  }, { timeout: 60000, polling: 500 });
  await new Promise((r) => setTimeout(r, 800));

  // 远景机位：静海径向外月心距 6R（表面距约 5R），lookAt 月心。
  // 该距离下细层门控关闭 → 补片 α≈1 可见，月球视直径约 19°，球缘入画。
  await page.evaluate(() => {
    const e = (window as any).__solarEngine;
    const THREE = (window as any).THREE;
    const pose = e.getBodyWorldPose('moon');
    const lat = 0.6741 * Math.PI / 180, lon = 23.473 * Math.PI / 180;
    const dir = new THREE.Vector3(
      Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
    e.camera.position.copy(pose.pos).addScaledVector(dir, pose.surfaceRadius * 6);
    e.camera.lookAt(pose.pos);
    e.camera.updateMatrixWorld(true);
  });
  await new Promise((r) => setTimeout(r, 900));

  const report: any = { url: TARGET_URL, checks: [] };
  const snap = async (): Promise<any> => page.evaluate<any>(`(() => {
    const e = window.__solarEngine;
    const st = e.moonSiteStacks.get('tranquility-base');
    const body = e.moonMaterial.uniforms;
    const patch = st.patchMaterial.uniforms;
    const v = (u) => [ +u.value.x.toFixed(6), +u.value.y.toFixed(6), +u.value.z.toFixed(6) ];
    return {
      sunIdentity: body.sunDirection === patch.sunDirection,
      teachIdentity: body.teachingLight === patch.teachingLight,
      opacityIndependent: body.uOpacity !== patch.uOpacity,
      bodySun: v(body.sunDirection), patchSun: v(patch.sunDirection),
      bodyTeach: +body.teachingLight.value.toFixed(4), patchTeach: +patch.teachingLight.value.toFixed(4),
      bodyOpacity: +body.uOpacity.value.toFixed(4),
      patchOpacityU: +patch.uOpacity.value.toFixed(4),
      patchVisible: st.patchMesh.visible,
    };
  })()`);

  // 基线
  const base = await snap();
  report.checks.push({ step: 'baseline', ...base });
  await page.screenshot({ path: path.join(OUT, 'limb-far-baseline.png') });

  // 时间推进 +6h：本体与补片 sunDirection 应同步变化且保持同值
  await page.evaluate(() => { (window as any).__solarEngine.setSimTimeHours(120); });
  await new Promise((r) => setTimeout(r, 800));
  const t0 = await snap();
  await page.screenshot({ path: path.join(OUT, 'limb-far-t120.png') });
  await page.evaluate(() => { (window as any).__solarEngine.setSimTimeHours(126); });
  await new Promise((r) => setTimeout(r, 800));
  const t6 = await snap();
  await page.screenshot({ path: path.join(OUT, 'limb-far-t126.png') });

  const moved = (() => {
    const a = t0.bodySun, b = t6.bodySun;
    const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    return +d.toFixed(6);
  })();
  report.checks.push({ step: 't120', ...t0 }, { step: 't126', ...t6 }, { sunMovedOver6h: moved });
  report.pass_timeSync =
    t0.sunIdentity && t6.sunIdentity &&
    t0.bodySun.join() === t0.patchSun.join() &&
    t6.bodySun.join() === t6.patchSun.join() &&
    moved > 0.001;
  report.note_sunMoved = moved > 0.001
    ? 'sun direction确实随模拟时间变化（非恒定向量，同步断言有效）'
    : '警告：6h 推进内 sunDirection 几乎未动，同步断言区分度不足';

  // 补光开关：本体与补片 teachingLight 应同为 1
  await page.evaluate(() => { (window as any).__solarEngine.setTeachingLight(true); });
  await new Promise((r) => setTimeout(r, 800));
  const teach = await snap();
  report.checks.push({ step: 'teaching-on', ...teach });
  report.pass_teachSync = teach.sunIdentity && teach.teachIdentity &&
    teach.bodyTeach === 1 && teach.patchTeach === 1;
  await page.screenshot({ path: path.join(OUT, 'limb-far-teaching-on.png') });
  await page.evaluate(() => { (window as any).__solarEngine.setTeachingLight(false); });
  await new Promise((r) => setTimeout(r, 400));

  report.pass_opacityContract = base.opacityIndependent &&
    base.bodyOpacity === 1 && base.patchOpacityU >= 0 && base.patchOpacityU <= 1;

  report.PASS = report.pass_timeSync && report.pass_teachSync && report.pass_opacityContract;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
  console.log(report.PASS ? 'P1 PROBE PASS' : 'P1 PROBE FAIL');
  if (!report.PASS) process.exit(2);
}

main().catch((e) => { console.error('PROBE FAILED:', e); process.exit(1); });
