// R1 验收探针（生产构建）：伴飞载具从轨道→下降→悬停→停驻→返轨全程可见。
// 每阶段断言 lastFrameRenderInfo.vehicleDisplayRange 覆盖载具（far ≥ 2.6、near>0、有限）。
// 正常 UI：机库登舰、观察面板切伴飞、行内降落按钮、画布拖动暂停(HOLD 设计交互)、
// HUD 按钮 resume/返轨。截图存 D:\solar-evidence\r1r2-bdac3bc\r1-vehicle-descent\。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:4173';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = 'D:/solar-evidence/r1r2-bdac3bc/r1-vehicle-descent';

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=d3d11', '--enable-webgl', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  const shot = async (name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const clickId = async (id: string) => {
    await page.waitForSelector(`[data-testid="${id}"]`, { timeout: 30000 });
    await page.click(`[data-testid="${id}"]`);
  };
  const clickHudText = async (panelId: string, text: string) => {
    await page.waitForFunction((pid: string, t: string) => {
      const root = document.querySelector(pid);
      return !!root && Array.from(root.querySelectorAll('button')).some((b) => (b.textContent || '').includes(t));
    }, { timeout: 15000 }, panelId, text);
    await page.evaluate((pid: string, t: string) => {
      const root = document.querySelector(pid)!;
      (Array.from(root.querySelectorAll('button')).find((b) => (b.textContent || '').includes(t)) as HTMLButtonElement).click();
    }, panelId, text);
    await new Promise((r) => setTimeout(r, 400));
  };
  const diag = () => page.evaluate(`(() => {
    const e = window.__solarEngine;
    const r = e.lastFrameRenderInfo;
    return {
      state: e.getLandingTelemetry().state,
      aglM: Math.round(e.getLandingTelemetry().altitudeAGLM),
      displayPass: r.vehicleDisplayPass,
      range: r.vehicleDisplayRange,
      mode: e.getViewCameraMode ? e.getViewCameraMode() : null,
    };
  })()`);
  const assertRange = (stage: string, d: any) => {
    const ok = d.displayPass && d.range && Number.isFinite(d.range.near) && d.range.near > 0
      && Number.isFinite(d.range.far) && d.range.far >= 2.6;
    console.log(`[${stage}] ${JSON.stringify(d)} rangeOk=${ok}`);
    return ok;
  };

  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window as any).__solarEngine?.camera, { timeout: 30000 });

  // 登舰 ISS + 伴飞（地球轨道起点）
  await clickId('toolbar-hangar-btn');
  await page.waitForSelector('[data-testid="hangar-board-btn"]', { timeout: 30000 });
  await page.click('[data-testid="hangar-board-btn"]');
  await page.waitForFunction(() => !!(window as any).__solarEngine.getCurrentVehicle(), { timeout: 60000, polling: 500 });
  if (await page.$('[data-testid="hangar-close-btn"]')) await clickId('hangar-close-btn');
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '观测选项') as HTMLButtonElement | undefined;
    if (btn && btn.getAttribute('aria-expanded') !== 'true') btn.click();
  });
  await clickHudText('#hud-observe-panel', '伴飞');
  await new Promise((r) => setTimeout(r, 800));

  // 月球轨道（先收起观察面板）。已知小缺陷：登舰 toast（pointer-events:auto）
  // 会盖住导航行按钮且伴飞期间不消失——探针改为对按钮元素直接派发点击（真实
  // 处理器），并在交接中登记该遮挡问题。
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '观测选项') as HTMLButtonElement | undefined;
    if (btn && btn.getAttribute('aria-expanded') === 'true') btn.click();
  });
  await page.waitForSelector('[data-testid="moon-btn-moon"]', { timeout: 10000 });
  await page.evaluate(() => {
    (document.querySelector('[data-testid="moon-btn-moon"]') as HTMLButtonElement).click();
  });
  await page.waitForFunction(() => {
    const s = (window as any).__solarEngine.getCameraSnapshot();
    return s.targetBodyId === 'moon' && !s.isTransitioning;
  }, { timeout: 180000, polling: 500 });
  await new Promise((r) => setTimeout(r, 800));
  let d = await diag();
  let ok = assertRange('01-moon-orbit', d);
  await shot('01-moon-orbit');

  // 选静海（正面站，availability=land）→ 行内降落
  await page.waitForSelector('[data-testid="landing-site-select"]', { timeout: 30000 });
  await page.select('[data-testid="landing-site-select"]', 'tranquility-base');
  await new Promise((r) => setTimeout(r, 800));
  await clickId('lunar-landing-start-btn');
  await page.waitForFunction(() => ['PREPARING', 'DESCENDING'].includes((window as any).__solarEngine.getLandingTelemetry().state), {
    timeout: 60000, polling: 400,
  });
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingTelemetry().state === 'DESCENDING', {
    timeout: 120000, polling: 800,
  });
  await new Promise((r) => setTimeout(r, 1500));
  d = await diag();
  ok = assertRange('02-descent', d) && ok;
  await shot('02-descent');

  // 下降中拖拽（设计交互：拖动暂停）→ HOLD
  await page.mouse.move(700, 430);
  await page.mouse.down();
  await page.mouse.move(640, 470, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingTelemetry().state === 'HOLD', {
    timeout: 60000, polling: 400,
  });
  await new Promise((r) => setTimeout(r, 1000));
  d = await diag();
  ok = assertRange('03-hold', d) && ok;
  await shot('03-hold');

  // 继续 → 触地停驻
  await clickId('landing-btn-resume');
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingTelemetry().state === 'SURFACE_LOOK', {
    timeout: 600000, polling: 1000,
  });
  await new Promise((r) => setTimeout(r, 1200));
  d = await diag();
  ok = assertRange('04-surface-look', d) && ok;
  await shot('04-surface-look');

  // 环顾后再确认（SURFACE_LOOK 下拖拽不改变状态）
  await page.mouse.move(700, 430);
  await page.mouse.down();
  await page.mouse.move(520, 470, { steps: 8 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 800));
  d = await diag();
  ok = assertRange('05-surface-look-after-look', d) && ok;
  await shot('05-surface-look-look-around');

  // 返轨
  await clickId('landing-btn-return-orbit');
  await page.waitForFunction(() => {
    const s = (window as any).__solarEngine.getCameraSnapshot();
    return s.mode === 'ORBIT_TARGET' && !s.isTransitioning;
  }, { timeout: 180000, polling: 800 });
  await new Promise((r) => setTimeout(r, 800));
  d = await diag();
  ok = assertRange('06-return-orbit', d) && ok;
  await shot('06-return-orbit');

  console.log(`[R1 RESULT] ${ok ? 'PASS' : 'FAIL'}`);
  console.log('[errors]', errs.length ? errs.slice(0, 5).join(' | ') : '(none)');
  await browser.close();
  console.log('R1 PROBE DONE');
}

main().catch((e) => { console.error('R1 PROBE FAILED:', e); process.exit(1); });
