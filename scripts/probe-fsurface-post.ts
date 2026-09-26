// 地表后段正常 UI 取证；性能用有界 RAF 采样。最后的人工摆位单独标注。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { sampleBrowserPerformance } from './lib/browser-performance';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:4173';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = process.env.OUT_DIR || 'D:/solar-evidence/fsurface-blend/after';

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    protocolTimeout: 60000,
    userDataDir: path.join(OUT, 'profile-' + process.pid),
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=d3d11', '--enable-webgl', '--window-size=1440,900'],
  });
  try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  const shot = (name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

  const perfSample = (label: string) => sampleBrowserPerformance(page, label);

  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window as any).__solarEngine?.camera, { timeout: 30000 });
  await page.click('[data-testid="moon-btn-moon"]');
  await page.waitForFunction(() => {
    const s = (window as any).__solarEngine.getCameraSnapshot();
    return s.targetBodyId === 'moon' && !s.isTransitioning;
  }, { timeout: 120000, polling: 400 });
  await new Promise((r) => setTimeout(r, 800));
  await page.waitForSelector('[data-testid="landing-site-select"]', { timeout: 30000 });
  await page.select('[data-testid="landing-site-select"]', 'tranquility-base');
  await page.waitForFunction(() => {
    const st = (window as any).__solarEngine.moonSiteStacks.get('tranquility-base');
    return !!(st && st.built);
  }, { timeout: 60000, polling: 500 });
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingAvailability().action === 'land', {
    timeout: 60000, polling: 500,
  });
  await page.click('[data-testid="lunar-landing-start-btn"]');
  console.log('descent started');
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingTelemetry().state === 'SURFACE_LOOK', {
    timeout: 6 * 60 * 1000, polling: 2000,
  });
  console.log('SURFACE_LOOK reached');
  await new Promise((r) => setTimeout(r, 1500));

  // B. 触地回望：真实拖拽环顾。
  await shot('03-surface-look');
  await page.mouse.move(700, 430);
  await page.mouse.down();
  await page.mouse.move(480, 470, { steps: 10 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 900));
  await shot('03-surface-look-turned');
  const perfSurface = await perfSample('surface-look');

  // C. 返轨（真实 HUD 路径）
  await page.click('[data-testid="landing-btn-return-orbit"]');
  await page.waitForFunction(() => {
    const s = (window as any).__solarEngine.getCameraSnapshot();
    return s.mode === 'ORBIT_TARGET' && !s.isTransitioning;
  }, { timeout: 240000, polling: 800 });
  await new Promise((r) => setTimeout(r, 900));
  await shot('04-return-orbit');
  const perfOrbit = await perfSample('return-orbit');

  // D. 球缘斜视（几何对准站点径向的低角度机位；两侧实现一致）
  await page.evaluate(() => {
    const e = (window as any).__solarEngine;
    const pose = e.getBodyWorldPose('moon');
    const meshR = pose.surfaceRadius;
    const lat = 0.6741 * Math.PI / 180, lon = 23.473 * Math.PI / 180;
    const direction = e.camera.position.clone().set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)).applyQuaternion(pose.quaternion).normalize();
    const phi = Math.min(Math.PI - .01, Math.max(.01, Math.acos(direction.y) + 62 * Math.PI / 180));
    const theta = Math.atan2(direction.x, direction.z);
    e.getCameraController().setSphericalDirect(meshR * (1 + 1200 / 1737.4), phi, theta);
  });
  await new Promise((r) => setTimeout(r, 900));
  await shot('05-limb-oblique');
  const perfLimb = await perfSample('limb-oblique');

  const report = { url: TARGET_URL, out: OUT, perf: [perfSurface, perfOrbit, perfLimb], errors: errs.slice(0, 5) };
  fs.writeFileSync(path.join(OUT, 'report-post.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
  console.log('FSURFACE POST DONE');
  } finally { await browser.close(); }
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
