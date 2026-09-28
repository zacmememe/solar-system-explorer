// F-STARTUP-RESPONSIVENESS-11 · G1 反例矩阵浏览器探针（生产构建）
// Z18-01：默认站(taurus/apollo17)数据 404，哈德利正常 → 哈德利不被连坐，
//         availability→land、准备 capture 门用本站数据（默认站失败仅影响本站）。
// Z18-04：哈德利(apollo15)先 404 → 选站报失败态；同页解除故障 → 用户"再次选择"
//         （换站再回来）实际产生新请求并 built——无刷新依赖。
import { preview } from 'vite';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';

const OUT = 'D:/solar-evidence/F-STARTUP-RESPONSIVENESS-11/g1-counterexamples';
await fs.mkdir(OUT, { recursive: true });
const server = await preview({ preview: { host: '127.0.0.1', port: 0, open: false } });
const url = server.resolvedUrls.local[0];
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true, defaultViewport: { width: 1920, height: 1080 }, protocolTimeout: 300000,
  args: ['--use-gl=angle', '--use-angle=d3d11'],
});
const page = await browser.newPage();
await page.setRequestInterception(true);
const blocked = new Set(); // 拦截中的 URL 前缀
let requestLog = [];
page.on('request', (req) => {
  const u = req.url();
  for (const b of blocked) {
    if (u.includes(b)) {
      requestLog.push({ url: u.slice(-60), verdict: 'BLOCKED' });
      req.abort('failed').catch(() => {});
      return;
    }
  }
  if (/dem|ortho/.test(u)) requestLog.push({ url: u.slice(-60), verdict: 'ok' });
  req.continue().catch(() => {});
});
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { z1801: {}, z1804: {} };
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });

  // ---------- Z18-01：默认站失败不连坐 ----------
  blocked.add('/data/dem/apollo17-v1'); // 默认站 taurus 数据（注意：默认站预载在启动时已发起——
  // 拦截在 goto 前设置，启动预载的请求同样被拦；engineCreated 后默认站 raster=failed）
  await page.waitForFunction(() => window.__solarEngine, { timeout: 120000, polling: 200 });
  await page.waitForFunction(() => {
    const st = window.__solarEngine.moonSiteStacks.get('taurus-littrow');
    return st && st.raster.state === 'failed';
  }, { timeout: 120000, polling: 300 });
  const taurusState = await page.evaluate(() => {
    const st = window.__solarEngine.moonSiteStacks.get('taurus-littrow');
    return { raster: st.raster.state, built: st.built, loadStarted: st.loadStarted };
  });
  report.z1801.taurus = taurusState;

  // 切月 → 选哈德利（数据正常）
  await page.click('[data-testid="moon-btn-moon"]');
  await page.waitForFunction(() => {
    const c = window.__solarEngine.getCameraSnapshot();
    return c.targetBodyId === 'moon' && !c.isTransitioning;
  }, { timeout: 120000, polling: 300 });
  await page.waitForSelector('[data-testid="landing-site-select"]', { timeout: 30000 });
  await page.select('[data-testid="landing-site-select"]', 'hadley-rille');
  await page.waitForFunction(() => window.__solarEngine.getLandingAvailability().action !== 'wait', {
    timeout: 120000, polling: 300,
  });
  // 哈德利 availability 应能到达 travel/land（数据就绪）——旧代码此门读默认站 isReady=false 永远 wait
  const hadAvail = await page.evaluate(() => {
    const e = window.__solarEngine;
    const st = e.moonSiteStacks.get('hadley-rille');
    return { action: e.getLandingAvailability().action, hadleyRaster: st.raster.state, hadleyBuilt: st.built };
  });
  report.z1801.hadleyAfterSelect = hadAvail;
  if (hadAvail.action === 'travel-to-site') {
    await page.waitForSelector('[data-testid="lunar-landing-travel-site-btn"]', { timeout: 30000 });
    await page.click('[data-testid="lunar-landing-travel-site-btn"]');
    await page.waitForFunction(() => window.__solarEngine.getLandingAvailability().action === 'land', {
      timeout: 180000, polling: 300,
    });
  }
  // 点开始 → PREPARING（capture 门）→DESCENDING 证明按站数据放行
  await page.click('[data-testid="lunar-landing-start-btn"]');
  await page.waitForFunction(() => window.__solarEngine.getLandingTelemetry().state === 'DESCENDING', {
    timeout: 120000, polling: 200,
  });
  report.z1801.descendReached = true;
  // 取消返回，恢复现场
  await page.click('[data-testid="landing-btn-cancel"]');
  await page.waitForFunction(() => {
    const c = window.__solarEngine.getCameraSnapshot();
    return c.mode === 'ORBIT_TARGET' && !c.isTransitioning;
  }, { timeout: 180000, polling: 300 });
  console.log('Z18-01:', JSON.stringify(report.z1801));

  // ---------- Z18-04：失败→解除→同页重试（对象=静海，此前未装载过） ----------
  blocked.delete('/data/dem/apollo17-v1'); // 解除默认站（后面不用它）
  blocked.add('/data/dem/apollo11-v1'); // 静海 DTM 404
  requestLog = [];
  await page.select('[data-testid="landing-site-select"]', 'tranquility-base');
  await page.waitForFunction(() => {
    const st = window.__solarEngine.moonSiteStacks.get('tranquility-base');
    return st.raster.state === 'failed';
  }, { timeout: 120000, polling: 300 });
  const failState = await page.evaluate(() => {
    const e = window.__solarEngine;
    const st = e.moonSiteStacks.get('tranquility-base');
    return { raster: st.raster.state, built: st.built, loadStarted: st.loadStarted,
      avail: e.getLandingAvailability().action };
  });
  report.z1804.failedFirst = failState;
  const blockedCount = requestLog.filter((r) => r.verdict === 'BLOCKED').length;
  report.z1804.blockedRequestsFirstRound = blockedCount;

  // 用户"再次选择"：换站再回来（不刷新页面）
  blocked.delete('/data/dem/apollo11-v1');
  requestLog = [];
  await page.select('[data-testid="landing-site-select"]', 'taurus-littrow');
  await delay(300);
  await page.select('[data-testid="landing-site-select"]', 'tranquility-base');
  await page.waitForFunction(() => window.__solarEngine.moonSiteStacks.get('tranquility-base')?.built, {
    timeout: 180000, polling: 300,
  });
  const recovered = await page.evaluate(() => {
    const e = window.__solarEngine;
    const st = e.moonSiteStacks.get('tranquility-base');
    return { raster: st.raster.state, built: st.built, error: st.raster.error };
  });
  report.z1804.recovered = recovered;
  report.z1804.newRequestsSecondRound = requestLog.filter((r) => /apollo11/.test(r.url) && r.verdict === 'ok').length;
  console.log('Z18-04:', JSON.stringify(report.z1804));

  await page.screenshot({ path: `${OUT}/final.png` });
  report.PASS =
    report.z1801.taurus.raster === 'failed' &&
    report.z1801.descendReached === true &&
    report.z1804.failedFirst.raster === 'failed' && report.z1804.failedFirst.built === false &&
    report.z1804.recovered.raster === 'ready' && report.z1804.recovered.built === true &&
    report.z1804.newRequestsSecondRound >= 3; // metadata/height/valid/ortho 至少 3 件
} catch (e) {
  report.PASS = false;
  report.failure = String(e.stack || e);
  await page.screenshot({ path: `${OUT}/failure.png` }).catch(() => {});
} finally {
  await fs.writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 1));
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
console.log(JSON.stringify({ PASS: report.PASS, failure: report.failure }));
process.exit(report.PASS ? 0 : 2);
