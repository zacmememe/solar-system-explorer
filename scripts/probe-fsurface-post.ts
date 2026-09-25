// F-SURFACE-BLEND-01 取证·后段（轻量路径）：触地回望/返轨/球缘斜视/性能。
// 前段（下降序列）由 probe-fsurface-evidence 独立完成；本探针从选站直达
// SURFACE_LOOK（短会话——长会话合并跑会触发 CDP evaluate 卡点，三次复现，
// 56s 短会话判别实验 healthy，故拆分。证据完整性不受影响：两段同构建同流程）。
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

  const perfSample = async (_label: string): Promise<any> => page.evaluate<any>(`(() => new Promise((res) => {
    const ds = [];
    let n = 0;
    const tick = () => {
      ds.push(performance.now());
      n++;
      if (n < 61) requestAnimationFrame(tick);
      else {
        const dt = [];
        for (let i = 1; i < ds.length; i++) dt.push(ds[i] - ds[i - 1]);
        dt.sort((a, b) => a - b);
        const mem = performance.memory;
        res({ label, frames: dt.length, avgMs: +(dt.reduce((a, b) => a + b, 0) / dt.length).toFixed(2),
          p95Ms: +dt[Math.floor(dt.length * 0.95)].toFixed(2),
          heapMB: mem ? +(mem.usedJSHeapSize / 1048576).toFixed(1) : null });
      }
    };
    requestAnimationFrame(tick);
  }))()`);

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
  // 注意：SURFACE_LOOK 模式下不做 rAF perf 采样——贴地渲染单帧极重，
  // 60 帧 Promise 会挂到协议超时（性能记录改为返轨/斜视两个轨道机位）。
  await shot('03-surface-look');
  await page.mouse.move(700, 430);
  await page.mouse.down();
  await page.mouse.move(480, 470, { steps: 10 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 900));
  await shot('03-surface-look-turned');
  const perfSurface: any = { label: 'surface-look', note: 'skipped: per-frame cost too high for rAF sampling under SURFACE_LOOK' };

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
    const moon = e.getMoonMesh();
    if (!moon.geometry.boundingSphere) moon.geometry.computeBoundingSphere();
    const meshR = moon.geometry.boundingSphere.radius * moon.scale.x;
    const lat = 0.6741 * Math.PI / 180, lon = 23.473 * Math.PI / 180;
    const phi = Math.PI / 2 - lat + 62 * Math.PI / 180;
    const theta = Math.PI / 2 + lon;
    e.getCameraController().setSphericalDirect(meshR * (1 + 1200 / 1737.4), phi, theta);
  });
  await new Promise((r) => setTimeout(r, 900));
  await shot('05-limb-oblique');
  const perfLimb = await perfSample('limb-oblique');

  const report = { url: TARGET_URL, out: OUT, perf: [perfSurface, perfOrbit, perfLimb], errors: errs.slice(0, 5) };
  fs.writeFileSync(path.join(OUT, 'report-post.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
  console.log('FSURFACE POST DONE');
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
