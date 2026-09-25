// F-SURFACE-BLEND-01 前后对照取证探针（生产构建，真实 UI 路径）。
// 覆盖 review 交付门槛：293km 全景 / 中低空含边缘 / 球缘斜视 / 触地回望 /
// 返轨，连续下降帧序列与阈值前后帧，渐显门控时间线，帧耗与内存记录。
// 只读引擎状态；斜视机位用 setSphericalDirect（几何对准站点径向，两侧一致）。
// OUT 隔离：after=D:\solar-evidence\fsurface-blend\after，
//           before=D:\solar-evidence\fsurface-blend\before（worktree 旧构建）。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:4173';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = process.env.OUT_DIR || 'D:/solar-evidence/fsurface-blend/after';
const SITE = 'tranquility-base';

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
    const t0 = performance.now();
    const tick = () => {
      const t = performance.now();
      ds.push(t);
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
  await page.select('[data-testid="landing-site-select"]', SITE);
  await page.waitForFunction(() => {
    const st = (window as any).__solarEngine.moonSiteStacks.get('tranquility-base');
    return !!(st && st.built);
  }, { timeout: 60000, polling: 500 });
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingAvailability().action === 'land', {
    timeout: 60000, polling: 500,
  });
  await page.click('[data-testid="lunar-landing-start-btn"]');
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingTelemetry().state === 'DESCENDING', {
    timeout: 180000, polling: 500,
  });
  console.log('descent started');

  const gates = (): Promise<any> => page.evaluate<any>(`(() => {
    const e = window.__solarEngine;
    const st = e.moonSiteStacks.get('tranquility-base');
    const dtmMat = st.valleyMaterial;
    const l1Mat = st.lolaMaterials || [];
    const tel = e.getLandingTelemetry();
    const val = (m) => m ? +(m.uniforms && m.uniforms.uOpacity ? m.uniforms.uOpacity.value
      : (m.opacity != null ? m.opacity : -1)).toFixed(3) : null;
    return { tMs: 0, aglM: Math.round(tel.altitudeAGLM), state: tel.state,
      dtm: val(dtmMat), l1: val(l1Mat[0]),
      patchVisible: !!(st.patchMesh && st.patchMesh.visible),
      patchOpacity: st.patchMaterial && st.patchMaterial.uniforms && st.patchMaterial.uniforms.uOpacity
        ? +st.patchMaterial.uniforms.uOpacity.value.toFixed(3) : null };
  })()`);

  // A. 连续下降：时间线 + 阈值前后帧 + 伪视频帧序列
  const events = new Set<string>();
  const timeline: string[] = [];
  const t0 = Date.now();
  let prev: any = null;
  let seq = 0;
  let lastSeqAt = 0;
  const cross = (key: string, v: number | null, th: number, dir: 'up' | 'down') => {
    if (v == null || prev == null) return false;
    const a = prev[key] as number | null;
    if (a == null) return false;
    return dir === 'up' ? a < th && v >= th : a >= th && v < th;
  };
  while (Date.now() - t0 < 12 * 60 * 1000) {
    const s = await gates();
    (s as any).tMs = Date.now() - t0;
    timeline.push(JSON.stringify(s));
    const tag = (n: string) => { if (!events.has(n)) { events.add(n); return `${n}`; } return null; };
    const grab = async (n: string) => { await shot(n); };
    let ev: string | null;
    // 先判越阈再记事件（顺序反了会导致事件被占用而丢截图）
    if (cross('l1', s.l1, 0.05, 'up') && (ev = tag('th-l1-005-up-a'))) await grab(`01-${ev}`);
    if (cross('l1', s.l1, 0.95, 'up') && (ev = tag('th-l1-095-up-a'))) await grab(`01-${ev}`);
    if (cross('dtm', s.dtm, 0.05, 'up') && (ev = tag('th-dtm-005-up-a'))) await grab(`01-${ev}`);
    if (cross('dtm', s.dtm, 0.95, 'up') && (ev = tag('th-dtm-095-up-a'))) await grab(`01-${ev}`);
    if (prev && prev.patchVisible && !s.patchVisible && (ev = tag('th-patch-off-a'))) await grab(`01-${ev}`);
    if (prev && prev.aglM > 300000 && s.aglM <= 300000 && (ev = tag('agl-300km'))) await grab(`02-${ev}`);
    if (prev && prev.aglM > 293000 && s.aglM <= 293000 && (ev = tag('agl-293km'))) await grab(`02-${ev}`);
    if (prev && prev.aglM > 60000 && s.aglM <= 60000 && (ev = tag('agl-60km'))) await grab(`02-${ev}`);
    // 越阈后一帧（b 帧）
    for (const n of [...events]) {
      if (n.startsWith('th-') && n.endsWith('-a') && !events.has(n.slice(0, -2) + 'b')) {
        await grab(`01-${n.slice(0, -2)}b`);
        events.add(n.slice(0, -2) + 'b');
      }
    }
    // 伪视频帧序列：每 5s 一帧
    if (s.tMs - lastSeqAt > 5000) {
      lastSeqAt = s.tMs;
      seq += 1;
      await shot(`00-seq-${String(seq).padStart(2, '0')}`);
    }
    prev = s;
    if (s.state !== 'DESCENDING') break;
    await new Promise((r) => setTimeout(r, 400));
  }
  fs.writeFileSync(path.join(OUT, 'timeline-descent.jsonl'), timeline.join('\n'));
  console.log(`descent done events=${[...events].filter((e) => !e.endsWith('-b')).join(',')}`);
  const perfDescent = await perfSample('descent-tail');

  // SKIP_TOUCH：只采下降段证据（触地段在长会话下会触发 CDP 卡点，由
  // probe-fsurface-post 短会话路径单独采集）
  if (process.env.SKIP_TOUCH) {
    console.log('SKIP_TOUCH set: descent-phase evidence complete, exiting');
    await browser.close();
    return;
  }

  // B. 触地回望（SURFACE_LOOK 真实交互：拖拽环顾）
  try {
    await page.waitForFunction(() => (window as any).__solarEngine.getLandingTelemetry().state === 'SURFACE_LOOK', {
      timeout: 6 * 60 * 1000, polling: 2000,
    });
  } catch {
    console.log('first SURFACE_LOOK wait failed, retrying once');
    await page.waitForFunction(() => (window as any).__solarEngine.getLandingTelemetry().state === 'SURFACE_LOOK', {
      timeout: 6 * 60 * 1000, polling: 2000,
    });
  }
  await new Promise((r) => setTimeout(r, 1500));
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

  // D. 球缘斜视（几何对准站点径向的低角度机位，两侧实现一致）
  await page.evaluate(() => {
    const e = (window as any).__solarEngine;
    const moon = e.getMoonMesh();
    if (!moon.geometry.boundingSphere) moon.geometry.computeBoundingSphere();
    const meshR = moon.geometry.boundingSphere.radius * moon.scale.x;
    const lat = 0.6741 * Math.PI / 180, lon = 23.473 * Math.PI / 180;
    const phi = Math.PI / 2 - lat + 62 * Math.PI / 180; // 低角度斜视：站点在视野上部，球缘入画
    const theta = Math.PI / 2 + lon;
    e.getCameraController().setSphericalDirect(meshR * (1 + 1200 / 1737.4), phi, theta);
  });
  await new Promise((r) => setTimeout(r, 900));
  await shot('05-limb-oblique');
  const perfLimb = await perfSample('limb-oblique');

  const report = {
    url: TARGET_URL, site: SITE, out: OUT,
    events: [...events], perf: [perfDescent, perfSurface, perfOrbit, perfLimb],
    errors: errs.slice(0, 5),
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
  console.log('FSURFACE EVIDENCE DONE');
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
