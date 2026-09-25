// F-SURFACE-BLEND-01 取证·轨道机位（轻量、零触地——贴地渲染下截图/采样会
// 长时间阻塞，触地回望由 probe-fsurface-post 另行采集）。
// 三个人工摆位机位（几何对准站点径向，两侧实现一致，如实登记为人工机位）：
//   limb-oblique 293km 全景（用户报告机位）/ 60km 中低空 / 低角度球缘斜视。
// 每机位截图 + 60 帧 rAF 性能采样。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:4173';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = process.env.OUT_DIR || 'D:/solar-evidence/fsurface-blend/after';

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    protocolTimeout: 600000,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=d3d11', '--enable-webgl', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  const shot = (name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

  // headless 下 rAF 按需驱动（截图触发 BeginFrame 才渲染），rAF 采样 Promise
  // 会永久挂起——帧耗改用"截图驱动 + renderer.info 帧数差"测量：绝对值含截图
  // 开销偏高，但 before/after 同法对比有效。
  const perfSample = async (label: string): Promise<any> => {
    const f0: any = await page.evaluate(`(() => window.__solarEngine.renderer.info.render.frame)()`);
    const t0 = Date.now();
    for (let i = 0; i < 12; i++) await page.screenshot({ type: 'jpeg', quality: 60 });
    const wall = Date.now() - t0;
    const f1: any = await page.evaluate(`(() => window.__solarEngine.renderer.info.render.frame)()`);
    const frames = Math.max(1, f1 - f0);
    return { label, framesRendered: frames, wallMs: wall,
      avgMsPerFrame: +(wall / frames).toFixed(1), mode: 'screenshot-driven-headless' };
  };

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
      const moon = e.getMoonMesh();
      if (!moon.geometry.boundingSphere) moon.geometry.computeBoundingSphere();
      const meshR = moon.geometry.boundingSphere.radius * moon.scale.x;
      const lat = 0.6741 * Math.PI / 180, lon = 23.473 * Math.PI / 180;
      const radius = meshR * (1 + cfg.altKm / 1737.4);
      const phi = Math.PI / 2 - lat + cfg.tiltDeg * Math.PI / 180;
      const theta = Math.PI / 2 + lon;
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
  await browser.close();
  console.log('FSURFACE ORBIT DONE');
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
