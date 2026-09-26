// F-SURFACE-BLEND-01 取证·人工轨道机位；触地正常 UI 验证见 verify-system-polish。
// 三个人工摆位机位（几何对准站点径向，两侧实现一致，如实登记为人工机位）：
//   limb-oblique 293km 全景（用户报告机位）/ 60km 中低空 / 低角度球缘斜视。
// 每机位截图 + 有时限的 2 秒 rAF 帧间隔采样（不是 GPU 耗时）。
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

  // RAF 回调原来的未定义 label 已修；使用有界采样，不把 render pass 数冒充帧数。
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
  // 人工激活（如实登记）：等价于降落序列的站点激活——切 group 可见 + 挖孔几何。
  await page.evaluate(`(() => { window.__solarEngine.activateMoonSite('tranquility-base'); })()`);
  await new Promise((r) => setTimeout(r, 800));

  const poseCamera = async (altKm: number, tiltDeg: number) => {
    await page.evaluate((cfg: { altKm: number; tiltDeg: number }) => {
      const e = (window as any).__solarEngine;
      const pose = e.getBodyWorldPose('moon');

      const meshR = pose.surfaceRadius;
      const lat = 0.6741 * Math.PI / 180, lon = 23.473 * Math.PI / 180;
      const radius = meshR * (1 + cfg.altKm / 1737.4);
      const direction = e.camera.position.clone().set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)).applyQuaternion(pose.quaternion).normalize();
      const phi = Math.min(Math.PI - .01, Math.max(.01, Math.acos(direction.y) + cfg.tiltDeg * Math.PI / 180));
      const theta = Math.atan2(direction.x, direction.z);
      e.getCameraController().setSphericalDirect(radius, phi, theta);
    }, { altKm, tiltDeg });
    await new Promise((r) => setTimeout(r, 900));
  };

  const poses: Array<[string, number, number]> = [
    ['05-orbit-293km', 293, 0],
    ['06-lowtrack-60km', 60, 0],
    ['07-limb-oblique', 1200, 62],
  ];
  const perf: any[] = [];
  for (const [name, alt, tilt] of poses) {
    await poseCamera(alt, tilt);
    await shot(name);
    perf.push(await perfSample(name));
    console.log(`posed+shot: ${name}`);
  }
  const report = { url: TARGET_URL, out: OUT, perf, errors: errs.slice(0, 5) };
  fs.writeFileSync(path.join(OUT, 'report-orbit.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
  console.log('FSURFACE ORBIT DONE');
  } finally { await browser.close(); }
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
