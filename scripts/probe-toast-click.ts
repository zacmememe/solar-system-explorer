// Task 2 验收探针：登舰 toast 不拦截顶部导航点击（生产构建）。
// 场景重现 R1 反例：登舰 toast 显示在 top:70 覆盖顶部导航行，且伴飞期间存在。
// 验收（真实鼠标事件，不用 DOM .click() 绕过）：
//   1) toast 存在期间，导航按钮矩形与 toast 矩形相交（确认遮挡场景成立）
//   2) elementFromPoint 在被覆盖点返回按钮本体（pointer-events:none 生效）
//   3) page.mouse.click 点在"按钮∩toast"交集内 → 导航切换必须生效
//   4) 3.5s 生命周期：toast 自动消失
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:4173';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = 'D:/solar-evidence/p1-toast-click';

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

  // 打开机库 → 选载具 → 登船（触发 toast）
  await page.waitForSelector('[data-testid="toolbar-hangar-btn"]', { timeout: 15000 });
  await page.click('[data-testid="toolbar-hangar-btn"]');
  await page.waitForSelector('[data-testid="hangar-tab-all"]', { timeout: 15000 });
  await page.click('[data-testid="hangar-tab-all"]');
  await page.waitForSelector('[data-testid="hangar-vehicle-item-apollo-lm"]', { timeout: 15000 });
  await page.click('[data-testid="hangar-vehicle-item-apollo-lm"]');
  await page.waitForSelector('[data-testid="hangar-board-btn"]', { timeout: 15000 });
  await page.click('[data-testid="hangar-board-btn"]');
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="moon-btn-moon"]');
    if (!el) return false;
    let n: HTMLElement | null = el as HTMLElement;
    while (n) { if (n.textContent && n.textContent.includes('已登船')) return true; n = n.parentElement; }
    return !!Array.from(document.querySelectorAll('div')).find((d) => (d.textContent || '').includes('已登船'));
  }, { timeout: 15000, polling: 100 });

  // toast 矩形与导航按钮矩形
  const rects: any = await page.evaluate(`(() => {
    const btn = document.querySelector('[data-testid="moon-btn-moon"]');
    const divs = Array.from(document.querySelectorAll('div'));
    // 真正的 toast 气泡：短文本 + 小高度（排除把整页文本都算进来的祖先容器）
    const toast = divs.find((d) => (d.textContent || '').includes('已登船')
      && (d.textContent || '').length < 60 && d.getBoundingClientRect().height < 100);
    const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
    return { btn: btn ? r(btn) : null, toast: toast ? r(toast) : null,
      toastText: toast ? toast.textContent.slice(0, 40) : null };
  })()`);
  console.log('rects:', JSON.stringify(rects));

  const inter = (() => {
    if (!rects.btn || !rects.toast) return null;
    const x1 = Math.max(rects.btn.x, rects.toast.x);
    const y1 = Math.max(rects.btn.y, rects.toast.y);
    const x2 = Math.min(rects.btn.x + rects.btn.w, rects.toast.x + rects.toast.w);
    const y2 = Math.min(rects.btn.y + rects.btn.h, rects.toast.y + rects.toast.h);
    return x2 > x1 && y2 > y1 ? { x: (x1 + x2) / 2, y: (y1 + y2) / 2, w: x2 - x1, h: y2 - y1 } : null;
  })();
  const report: any = { rects, intersection: inter };
  if (!inter) {
    report.PASS = false;
    report.error = 'toast 与 moon-btn-moon 矩形不相交，遮挡场景未重现（viewport 或布局变化？）';
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
    console.log(JSON.stringify(report, null, 1));
    await browser.close();
    process.exit(2);
  }

  // 1) elementFromPoint 在交集点应命中按钮（或其子/父链上的按钮）
  const hit: any = await page.evaluate(`(() => {
    const el = document.elementFromPoint(${inter.x}, ${inter.y});
    const chain = [];
    let n = el;
    while (n && chain.length < 6) { chain.push(n.tagName + (n.dataset && n.dataset.testid ? '#' + n.dataset.testid : '')); n = n.parentElement; }
    const btn = document.querySelector('[data-testid="moon-btn-moon"]');
    return { topEl: chain[0] || null, chain, isBtnRelated: !!el && (el === btn || btn.contains(el) || el.contains(btn)),
      pointerEventsOfTop: el ? getComputedStyle(el).pointerEvents : null };
  })()`);
  report.hitTest = hit;
  await page.screenshot({ path: path.join(OUT, 'toast-visible-before-click.png') });

  // 2) 真实鼠标点击交集点 → 导航必须切换到月球
  const before: any = await page.evaluate(`(() => (window.__solarEngine.getCameraSnapshot().targetBodyId))()`);
  await page.mouse.click(inter.x, inter.y);
  await new Promise((r) => setTimeout(r, 400));
  const after: any = await page.evaluate(`(() => (window.__solarEngine.getCameraSnapshot().targetBodyId))()`);
  report.clickTest = { clickedAt: [inter.x, inter.y], targetBodyBefore: before, targetBodyAfter: after };
  report.pass_realClick = hit.isBtnRelated && before !== 'moon' && after === 'moon';
  await page.screenshot({ path: path.join(OUT, 'after-real-click.png') });

  // 3) 3.5s 生命周期：toast 自动消失
  await new Promise((r) => setTimeout(r, 3800));
  const toastGone = await page.evaluate(`(() => {
    return !Array.from(document.querySelectorAll('div')).some((d) =>
      (d.textContent || '').includes('已登船')
      && (d.textContent || '').length < 60 && d.getBoundingClientRect().height < 100);
  })()`);
  report.pass_toastAutoDismiss = toastGone;

  report.PASS = report.pass_realClick && report.pass_toastAutoDismiss;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
  console.log(report.PASS ? 'TOAST PROBE PASS' : 'TOAST PROBE FAIL');
  if (!report.PASS) process.exit(2);
}

main().catch((e) => { console.error('PROBE FAILED:', e); process.exit(1); });
