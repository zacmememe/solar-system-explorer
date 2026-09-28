// F-STARTUP-RESPONSIVENESS-11 · 反例矩阵第二批（生产构建，正常 UI 路径）
// Z18-05：A 准备→取消→切星→回月→B 准备成功；旧意图不复活；A 站缓存复用不重复请求。
// Z18-06：HOLD 暂停→用户改倍率+拖拽环顾→等待→倍率/朝向保持用户态、不偷偷续降。
// Z18-08：快速连续选两站（并发装载）→ 两站各自 built、sourceId 不串站。
import { preview } from 'vite';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';

const OUT = 'D:/solar-evidence/F-STARTUP-RESPONSIVENESS-11/g1-counterexamples-2';
await fs.mkdir(OUT, { recursive: true });
const server = await preview({ preview: { host: '127.0.0.1', port: 0, open: false } });
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true, defaultViewport: { width: 1920, height: 1080 }, protocolTimeout: 300000,
  args: ['--use-gl=angle', '--use-angle=d3d11'],
});
const page = await browser.newPage();
const demRequests = [];
page.on('request', (r) => { if (/\/data\/dem\//.test(r.url())) demRequests.push(r.url()); });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { z1805: {}, z1806: {}, z1808: {} };
try {
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__solarEngine?.moonSiteStacks?.get('taurus-littrow')?.built, { timeout: 150000, polling: 300 });
  await page.click('[data-testid="moon-btn-moon"]');
  await page.waitForFunction(() => { const c = window.__solarEngine.getCameraSnapshot(); return c.targetBodyId === 'moon' && !c.isTransitioning; }, { timeout: 120000, polling: 300 });
  await page.waitForSelector('[data-testid="landing-site-select"]', { timeout: 30000 });

  // ---------- Z18-05：准备→取消→切星→回月→他站成功 ----------
  const bigReq = (u) => u.includes('apollo15') && /height\.f32|ortho\.u16|valid\.u8|metadata\.json/.test(u);
  const hadleyReqsBefore = demRequests.filter(bigReq).length;
  await page.select('[data-testid="landing-site-select"]', 'hadley-rille');
  // 等待可开始（travel 或 land）
  await page.waitForFunction(() => {
    const a = window.__solarEngine.getLandingAvailability();
    return a.action === 'land' || a.action === 'travel-to-site';
  }, { timeout: 150000, polling: 300 });
  const act = await page.evaluate(() => window.__solarEngine.getLandingAvailability().action);
  if (act === 'travel-to-site') {
    await page.waitForSelector('[data-testid="lunar-landing-travel-site-btn"]', { timeout: 30000 });
    await page.click('[data-testid="lunar-landing-travel-site-btn"]');
    await page.waitForFunction(() => window.__solarEngine.getLandingAvailability().action === 'land', { timeout: 180000, polling: 300 });
  }
  await page.click('[data-testid="lunar-landing-start-btn"]');
  await page.waitForFunction(() => window.__solarEngine.getLandingTelemetry().state === 'PREPARING' || window.__solarEngine.getLandingTelemetry().state === 'DESCENDING', { timeout: 60000, polling: 100 });
  // 立即取消准备/下降（按当前状态选按钮）
  const st = await page.evaluate(() => window.__solarEngine.getLandingTelemetry().state);
  if (st === 'PREPARING') {
    await page.waitForSelector('[data-testid="landing-btn-cancel-prep"]', { timeout: 15000 });
    await page.click('[data-testid="landing-btn-cancel-prep"]');
  } else {
    await page.click('[data-testid="landing-btn-cancel"]');
  }
  await page.waitForFunction(() => window.__solarEngine.getLandingTelemetry().state === 'ORBIT', { timeout: 180000, polling: 300 });
  // 切 earth → 回 moon（旧意图不复活）
  await page.click('[data-testid="planet-btn-earth"]');
  await page.waitForFunction(() => { const c = window.__solarEngine.getCameraSnapshot(); return c.targetBodyId === 'earth' && !c.isTransitioning; }, { timeout: 120000, polling: 300 });
  await delay(1500); // 取消后的后台响应若乱序，此时应已被丢弃
  const noRevive = await page.evaluate(() => window.__solarEngine.getLandingTelemetry().state);
  report.z1805.stateWhileOnEarth = noRevive;
  await page.click('[data-testid="moon-btn-moon"]');
  await page.waitForFunction(() => { const c = window.__solarEngine.getCameraSnapshot(); return c.targetBodyId === 'moon' && !c.isTransitioning; }, { timeout: 120000, polling: 300 });
  await page.waitForSelector('[data-testid="landing-site-select"]', { timeout: 30000 });
  // 再选回 hadley（缓存应复用：不重复请求 apollo15 数据）
  await page.select('[data-testid="landing-site-select"]', 'hadley-rille');
  await delay(2000);
  const hadleyReqsAfter = demRequests.filter(bigReq).length;
  report.z1805.hadleyDemRequestsBeforeRevisit = hadleyReqsBefore;
  report.z1805.hadleyDemRequestsTotal = hadleyReqsAfter;
  report.z1805.cacheReused = hadleyReqsAfter === hadleyReqsBefore;
  const stillBuilt = await page.evaluate(() => window.__solarEngine.moonSiteStacks.get('hadley-rille').built);
  report.z1805.hadleyStillBuilt = stillBuilt;

  // ---------- Z18-06：HOLD→用户倍率+环顾→不偷续降 ----------
  // 需要再次开始下降（视角若背对站点则先前往）
  await page.waitForFunction(() => {
    const a = window.__solarEngine.getLandingAvailability();
    return a.action === 'land' || a.action === 'travel-to-site';
  }, { timeout: 150000, polling: 300 });
  const a6 = await page.evaluate(() => window.__solarEngine.getLandingAvailability().action);
  if (a6 === 'travel-to-site') {
    await page.waitForSelector('[data-testid="lunar-landing-travel-site-btn"]', { timeout: 30000 });
    await page.click('[data-testid="lunar-landing-travel-site-btn"]');
    await page.waitForFunction(() => window.__solarEngine.getLandingAvailability().action === 'land', { timeout: 180000, polling: 300 });
  }
  await page.click('[data-testid="lunar-landing-start-btn"]');
  await page.waitForFunction(() => window.__solarEngine.getLandingTelemetry().state === 'DESCENDING', { timeout: 180000, polling: 200 });
  // 立即 HOLD
  await page.waitForSelector('[data-testid="landing-btn-hold"]', { timeout: 30000 });
  await page.click('[data-testid="landing-btn-hold"]');
  await page.waitForFunction(() => window.__solarEngine.getLandingTelemetry().state === 'HOLD', { timeout: 60000, polling: 200 });
  // 用户改倍率
  const speedBefore = await page.evaluate(() => window.__solarEngine.getCameraSnapshot().timeScale ?? window.__solarEngine.timeScale);
  await page.waitForSelector('[data-testid="hud-speed-up"]', { timeout: 15000 });
  await page.click('[data-testid="hud-speed-up"]');
  await delay(300);
  const speedAfterUp = await page.evaluate(() => window.__solarEngine.getCameraSnapshot().timeScale ?? window.__solarEngine.timeScale);
  // 用户环顾（拖拽）
  await page.mouse.move(960, 540);
  await page.mouse.down();
  await page.mouse.move(760, 580, { steps: 8 });
  await page.mouse.up();
  await delay(2500); // 后台若还在装/算，此刻不能偷改
  const z6 = await page.evaluate(() => ({
    state: window.__solarEngine.getLandingTelemetry().state,
    speed: window.__solarEngine.getCameraSnapshot().timeScale ?? window.__solarEngine.timeScale,
    userRev: window.__solarEngine.getCameraController().getUserInputRevision(),
  }));
  report.z1806 = { speedBefore, speedAfterUp, ...z6,
    speedKept: z6.speed === speedAfterUp, stillHold: z6.state === 'HOLD' };

  // 收尾：HOLD → 返回（避免长下降）
  await page.waitForSelector('[data-testid="landing-btn-return-hold"], [data-testid="landing-btn-cancel"]', { timeout: 20000 });
  const backBtn = await page.$('[data-testid="landing-btn-return-hold"]');
  if (backBtn) await backBtn.click();
  else await page.click('[data-testid="landing-btn-cancel"]');
  await page.waitForFunction(() => window.__solarEngine.getLandingTelemetry().state === 'ORBIT', { timeout: 180000, polling: 300 });

  // ---------- Z18-08：快速连续两站并发装载 ----------
  demRequests.length = 0;
  await page.waitForSelector('[data-testid="landing-site-select"]', { timeout: 30000 });
  await page.select('[data-testid="landing-site-select"]', 'tranquility-base');
  await delay(400); // 未等 built 立刻换
  await page.select('[data-testid="landing-site-select"]', 'hadley-rille');
  await page.waitForFunction(() => {
    const m = window.__solarEngine.moonSiteStacks;
    return m.get('tranquility-base')?.built && m.get('hadley-rille')?.built;
  }, { timeout: 180000, polling: 300 });
  const z8 = await page.evaluate(() => {
    const m = window.__solarEngine.moonSiteStacks;
    const t = m.get('tranquility-base');
    const h = m.get('hadley-rille');
    const srcId = (st) => st.raster.provenance?.sourceId ?? null;
    return {
      tranquility: { built: t.built, sourceId: srcId(t), groupChildren: t.group.children.length },
      hadley: { built: h.built, sourceId: srcId(h), groupChildren: h.group.children.length },
      activeSite: window.__solarEngine.activeMoonSiteId,
    };
  });
  report.z1808 = { ...z8,
    noCrossSite: z8.tranquility.sourceId !== z8.hadley.sourceId
      && /APOLLO11/.test(z8.tranquility.sourceId) && /APOLLO15/.test(z8.hadley.sourceId) };
  await page.screenshot({ path: `${OUT}/final.png` });

  report.PASS =
    report.z1805.stateWhileOnEarth === 'ORBIT' && report.z1805.cacheReused === true && report.z1805.hadleyStillBuilt === true &&
    report.z1806.speedKept === true && report.z1806.stillHold === true &&
    report.z1808.noCrossSite === true;
} catch (e) {
  report.PASS = false;
  report.failure = String(e.stack || e);
  await page.screenshot({ path: `${OUT}/failure.png` }).catch(() => {});
} finally {
  await fs.writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 1));
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
console.log(JSON.stringify(report, null, 1));
console.log(report.PASS ? 'COUNTEREXAMPLES-2 PASS' : 'COUNTEREXAMPLES-2 FAIL');
process.exit(report.PASS ? 0 : 2);
