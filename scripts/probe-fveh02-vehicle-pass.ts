// F-VEHICLE-FOREGROUND-01 验收探针：展示载具与世界深度隔离（正常 UI）。
// 流程：地球→机库登舰 ISS→伴飞（缩 25% 后）→拉近/拉远/拖动球缘连拍→月球/土星环
// →换 Hubble 再切回 ISS→随船→观星（载具必须完全隐藏且无展示 pass）。
// 全程正常 UI 入口；只读引擎诊断（lastFrameRenderInfo.vehicleDisplayPass 等）。
// 截图存 D:\solar-evidence\F-VEHICLE-FOREGROUND-01\。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:5199';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = 'D:/solar-evidence/F-VEHICLE-FOREGROUND-01';

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
  const clickText = async (scope: string, text: string) => {
    await page.waitForFunction((scopeSel: string, t: string) => {
      const root = document.querySelector(scopeSel);
      if (!root) return false;
      const btns = Array.from(root.querySelectorAll('button'));
      return btns.some((b) => (b.textContent || '').includes(t));
    }, { timeout: 15000 }, scope, text);
    await page.evaluate((scopeSel: string, t: string) => {
      const root = document.querySelector(scopeSel)!;
      const btn = Array.from(root.querySelectorAll('button')).find((b) => (b.textContent || '').includes(t))!;
      (btn as HTMLButtonElement).click();
    }, scope, text);
  };
  const waitBody = async (id: string) => {
    await page.waitForFunction((bid: string) => {
      const s = (window as any).__solarEngine.getCameraSnapshot();
      return s.targetBodyId === bid && !s.isTransitioning;
    }, { timeout: 60000, polling: 300 }, id);
    await new Promise((r) => setTimeout(r, 600));
  };
  const setMode = async (label: string) => {
    // 画布拖动/滚轮会关闭 popover——每次切模式前确保观察面板展开
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '观测选项') as HTMLButtonElement | undefined;
      if (btn && btn.getAttribute('aria-expanded') !== 'true') btn.click();
    });
    await new Promise((r) => setTimeout(r, 350));
    await clickText('#hud-observe-panel', label);
    await new Promise((r) => setTimeout(r, 500));
  };
  const diag = () => page.evaluate(`(() => {
    const e = window.__solarEngine;
    return {
      mode: e.getViewCameraMode ? e.getViewCameraMode() : e.viewCameraMode,
      vehicleId: e.getCurrentVehicle(),
      vgVisible: e.vehicleGroup ? e.vehicleGroup.visible : null,
      displayPass: e.lastFrameRenderInfo ? e.lastFrameRenderInfo.vehicleDisplayPass : null,
      layered: e.lastFrameRenderInfo ? e.lastFrameRenderInfo.layered : null,
    };
  })()`);
  const drag = async (dx: number, dy = 0) => {
    await page.mouse.move(700, 450);
    await page.mouse.down();
    await page.mouse.move(700 + dx, 450 + dy, { steps: Math.max(1, Math.ceil(Math.abs(dx) / 15)) });
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 250));
  };
  const zoom = async (deltaY: number, times: number) => {
    await page.mouse.move(700, 450);
    for (let i = 0; i < times; i++) {
      await page.mouse.wheel({ deltaY });
      await new Promise((r) => setTimeout(r, 120));
    }
  };
  const board = async (vehicleId: string | null) => {
    await clickId('toolbar-hangar-btn');
    await page.waitForSelector('[data-testid="hangar-board-btn"]', { timeout: 30000 });
    if (vehicleId) {
      await page.waitForSelector(`[data-testid="hangar-vehicle-item-${vehicleId}"]`, { timeout: 30000 });
      await page.click(`[data-testid="hangar-vehicle-item-${vehicleId}"]`);
      await new Promise((r) => setTimeout(r, 500));
    }
    await clickId('hangar-board-btn');
    await page.waitForFunction(() => !!(window as any).__solarEngine.getCurrentVehicle(), { timeout: 60000, polling: 500 });
    if (await page.$('[data-testid="hangar-close-btn"]')) await clickId('hangar-close-btn');
    await new Promise((r) => setTimeout(r, 800));
  };

  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window as any).__solarEngine?.camera, { timeout: 30000 });

  // 1) 地球 + ISS 伴飞：三种机位与动态
  await clickId('planet-btn-earth');
  await waitBody('earth');
  await board('iss');
  // 伴飞：拉近（放大画面）
  await setMode('伴飞');
  await new Promise((r) => setTimeout(r, 800));
  console.log('[earth formation]', JSON.stringify(await diag()));
  await shot('01-earth-formation');
  await zoom(-160, 6); // 拉近地球
  await new Promise((r) => setTimeout(r, 600));
  await shot('02-earth-formation-close');
  await drag(-260, 40); // 拖到球缘
  await new Promise((r) => setTimeout(r, 500));
  await shot('03-earth-formation-limb');
  console.log('[after close+limb]', JSON.stringify(await diag()));
  await zoom(200, 10); // 拉远
  await new Promise((r) => setTimeout(r, 600));
  await shot('04-earth-formation-far');
  // 随船
  await setMode('随船');
  await new Promise((r) => setTimeout(r, 600));
  console.log('[earth onboard]', JSON.stringify(await diag()));
  await shot('05-earth-onboard');
  // 观星：载具必须隐藏且无展示 pass
  await setMode('观星');
  await new Promise((r) => setTimeout(r, 600));
  console.log('[earth observe]', JSON.stringify(await diag()));
  await shot('06-earth-observe-hidden');

  // 2) 月球/土星伴飞（世界遮挡正常 + 载具前景完整）
  await clickId('moon-btn-moon');
  await waitBody('moon');
  await setMode('伴飞');
  await new Promise((r) => setTimeout(r, 700));
  await shot('07-moon-formation');
  console.log('[moon formation]', JSON.stringify(await diag()));
  await clickId('planet-btn-saturn').catch(async () => {
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('[data-testid^="planet-btn-"]')).find((b) => (b.textContent || '').includes('土星')) as HTMLButtonElement;
      btn?.click();
    });
  });
  await waitBody('saturn');
  await new Promise((r) => setTimeout(r, 700));
  await shot('08-saturn-formation-rings');
  console.log('[saturn formation]', JSON.stringify(await diag()));

  // 3) 换载具 Hubble → 切回 ISS（主场景装载互不干扰）
  await board('hubble');
  await new Promise((r) => setTimeout(r, 700));
  console.log('[after switch hubble]', JSON.stringify(await diag()));
  await shot('09-saturn-formation-hubble');
  await board('iss');
  await new Promise((r) => setTimeout(r, 700));
  console.log('[after switch back iss]', JSON.stringify(await diag()));
  await shot('10-saturn-formation-iss-back');

  console.log('[errors]', errs.length ? errs.slice(0, 5).join(' | ') : '(none)');
  await browser.close();
  console.log('VEHICLE PASS PROBE DONE');
}

main().catch((e) => { console.error('VEHICLE PASS PROBE FAILED:', e); process.exit(1); });
