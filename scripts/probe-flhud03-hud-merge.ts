// F-LANDING-HUD-03 验收探针：着陆选择+前往/降落单行融入底部 HUD 当前天体区。
// 桌面 1440×900 与手机 390×844 双视口；正常 UI：选站→前往(背面站)→降落→
// 下降遥测面板语义；中央拖动确认不再被悬浮面板遮挡。
// 截图存 D:\solar-evidence\F-LANDING-HUD-01\。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:5199';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = 'D:/solar-evidence/F-LANDING-HUD-01';

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=d3d11', '--enable-webgl', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  const shot = async (name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const clickId = async (id: string) => {
    await page.waitForSelector(`[data-testid="${id}"]`, { timeout: 30000 });
    await page.click(`[data-testid="${id}"]`);
  };
  const waitBody = async (id: string) => {
    await page.waitForFunction((bid: string) => {
      const s = (window as any).__solarEngine.getCameraSnapshot();
      return s.targetBodyId === bid && !s.isTransitioning;
    }, { timeout: 60000, polling: 300 }, id);
    await new Promise((r) => setTimeout(r, 600));
  };
  const drag = async (dx: number, dy = 0) => {
    await page.mouse.move(700, 430);
    await page.mouse.down();
    await page.mouse.move(700 + dx, 430 + dy, { steps: Math.max(1, Math.ceil(Math.abs(dx) / 15)) });
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 250));
  };
  const rowInfo = () => page.evaluate(`(() => {
    const row = document.querySelector('[data-testid="hud-landing-row"]');
    if (!row) return { present: false };
    const sel = row.querySelector('select');
    const btn = row.querySelector('[data-testid="lunar-landing-start-btn"], [data-testid="lunar-landing-travel-site-btn"], [data-testid="mars-observe-exit-btn"]');
    const wait = row.querySelector('[data-testid="lunar-landing-wait"]');
    const r = row.getBoundingClientRect();
    return {
      present: true,
      inHudTarget: !!row.closest('.hud-target'),
      selectValue: sel ? sel.value : null,
      actionLabel: btn ? (btn.textContent || '').trim() : null,
      waitText: wait ? (wait.textContent || '').trim() : null,
      rowRect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      viewport: { w: window.innerWidth, h: window.innerHeight },
    };
  })()`);

  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window as any).__solarEngine?.camera, { timeout: 30000 });

  // ---- 桌面：月球 ORBIT，着陆行在底部 HUD 当前天体区 ----
  await clickId('moon-btn-moon');
  await waitBody('moon');
  await page.waitForSelector('[data-testid="hud-landing-row"]', { timeout: 30000 });
  await page.waitForFunction(() => !!document.querySelector('[data-testid="hud-landing-row"] select'), { timeout: 30000, polling: 300 });
  await new Promise((r) => setTimeout(r, 500));
  console.log('[desktop land-row]', JSON.stringify(await rowInfo()));
  await shot('01-desktop-landing-row');

  // 选另一个站（tranquility），行内 select 生效
  await page.select('[data-testid="landing-site-select"]', 'tranquility-base');
  await new Promise((r) => setTimeout(r, 800));
  console.log('[desktop after select]', JSON.stringify(await rowInfo()));
  await shot('02-desktop-row-tranquility');

  // 选背面站 hadley（大概率 travel-to-site）验证前往态
  await page.select('[data-testid="landing-site-select"]', 'hadley-rille');
  await new Promise((r) => setTimeout(r, 1000));
  console.log('[desktop hadley]', JSON.stringify(await rowInfo()));
  await shot('03-desktop-row-hadley');

  // 回到 tranquility（正面），中央拖动观察不再被悬浮面板拦截
  await page.select('[data-testid="landing-site-select"]', 'tranquility-base');
  await new Promise((r) => setTimeout(r, 800));
  await drag(-180, 30);
  await new Promise((r) => setTimeout(r, 400));
  await shot('04-desktop-center-drag-free');

  // 降落 → 任务遥测面板（既有语义）
  await clickId('lunar-landing-start-btn');
  await page.waitForFunction(() => ['DESCENDING', 'HOLD', 'PREPARING'].includes((window as any).__solarEngine.getLandingTelemetry().state), {
    timeout: 60000, polling: 500,
  });
  await new Promise((r) => setTimeout(r, 1500));
  const telemetryPanel = await page.evaluate(() => !!document.querySelector('[data-testid="lunar-landing-telemetry-hud"]'));
  console.log('[desktop landing started] telemetryPanel=', telemetryPanel);
  await shot('05-desktop-descent-telemetry');

  // ---- 手机 390×844（重载回 ORBIT 态）----
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window as any).__solarEngine?.camera, { timeout: 30000 });
  await clickId('moon-btn-moon');
  await waitBody('moon');
  await new Promise((r) => setTimeout(r, 1200));
  // 重新触发 resize 下的布局；等待行重新可用
  await page.waitForFunction(() => {
    const row = document.querySelector('[data-testid="hud-landing-row"]');
    if (!row) return false;
    const r = row.getBoundingClientRect();
    return r.width > 0 && r.bottom <= window.innerHeight;
  }, { timeout: 20000, polling: 300 });
  await new Promise((r) => setTimeout(r, 600));
  console.log('[mobile row]', JSON.stringify(await rowInfo()));
  await shot('06-mobile-landing-row');

  console.log('[errors]', errs.length ? errs.slice(0, 5).join(' | ') : '(none)');
  await browser.close();
  console.log('LANDING HUD PROBE DONE');
}

main().catch((e) => { console.error('LANDING HUD PROBE FAILED:', e); process.exit(1); });
