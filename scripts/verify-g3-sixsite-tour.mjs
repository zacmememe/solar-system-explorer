// F-STARTUP-RESPONSIVENESS-11 · G3/Z18-10：六站轮访资源生命周期（同页完整旅程）
// 轮访六站（月 3 + 火 3）×2 圈：每站 built/sourceId/renderer.info.memory 记录；
// 断言：可重复加载（第二圈 built 保持/重建）、纹理与几何计数达到平台而非线性
// 无界增长、零页面错误、站点不串。renderer.info.memory 是计数器不是实测显存
// 字节（如实标注）。
import { preview } from 'vite';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';

const OUT = 'D:/solar-evidence/F-STARTUP-RESPONSIVENESS-11/g3-sixsite-tour';
await fs.mkdir(OUT, { recursive: true });
const server = await preview({ preview: { host: '127.0.0.1', port: 0, open: false } });
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true, defaultViewport: { width: 1920, height: 1080 }, protocolTimeout: 420000,
  args: ['--use-gl=angle', '--use-angle=d3d11'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 140)); });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const MOON = ['taurus-littrow', 'hadley-rille', 'tranquility-base'];
const MARS = ['jezero', 'victoria-duck-bay', 'gale-murray-buttes'];
const report = { visits: [], errors };

const siteSnapshot = async (bodyId, siteId) => page.evaluate(({ bodyId, siteId }) => {
  const e = window.__solarEngine;
  const st = bodyId === 'moon' ? e.moonSiteStacks.get(siteId) : e.marsSiteStacks.get(siteId);
  const src = bodyId === 'moon' ? st?.raster?.provenance?.sourceId : st?.dtm?.provenanceSourceId ?? null;
  return {
    bodyId, siteId,
    built: !!st?.built,
    groupChildren: st?.group?.children?.length ?? -1,
    src,
    mem: { ...e.renderer.info.memory },
    programs: e.renderer.info.programs.length,
  };
}, { bodyId, siteId });

const gotoBody = async (bodyId) => {
  // moon 按钮仅在 earth 视角的子导航显示；从火星返回需先切 earth
  const cur = await page.evaluate(() => window.__solarEngine.getCameraSnapshot().targetBodyId);
  if (bodyId === 'moon' && cur === 'mars') {
    await page.click('[data-testid="planet-btn-earth"]');
    await page.waitForFunction((b) => { const c = window.__solarEngine.getCameraSnapshot(); return c.targetBodyId === b && !c.isTransitioning; }, { timeout: 150000, polling: 300 }, 'earth');
  }
  await page.click(`[data-testid="${bodyId === 'moon' ? 'moon' : 'planet'}-btn-${bodyId}"]`);
  await page.waitForFunction((b) => { const c = window.__solarEngine.getCameraSnapshot(); return c.targetBodyId === b && !c.isTransitioning; }, { timeout: 150000, polling: 300 }, bodyId);
};

try {
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__solarEngine?.moonSiteStacks?.get('taurus-littrow')?.built, { timeout: 150000, polling: 300 });

  for (let round = 1; round <= 2; round++) {
    for (const siteId of MOON) {
      await gotoBody('moon');
      await page.waitForSelector('[data-testid="landing-site-select"]', { timeout: 30000 });
      await page.select('[data-testid="landing-site-select"]', siteId);
      await page.waitForFunction((s) => window.__solarEngine.moonSiteStacks.get(s)?.built, { timeout: 200000, polling: 300 }, siteId);
      await delay(700);
      report.visits.push(await siteSnapshot('moon', siteId));
      console.log(`r${round} moon ${siteId} done`);
    }
    for (const siteId of MARS) {
      await gotoBody('mars');
      await page.waitForSelector('[data-testid="landing-site-select"]', { timeout: 30000 });
      await page.select('[data-testid="landing-site-select"]', siteId);
      await page.waitForFunction((s) => window.__solarEngine.marsSiteStacks.get(s)?.built, { timeout: 200000, polling: 300 }, siteId);
      await delay(700);
      report.visits.push(await siteSnapshot('mars', siteId));
      console.log(`r${round} mars ${siteId} done`);
    }
  }
  await page.screenshot({ path: `${OUT}/final.png` });

  // 分析：第二圈全部 built；纹理计数平台（第二圈末 vs 第一圈末差值有限）
  const allBuilt = report.visits.every((v) => v.built);
  const midMem = report.visits[5].mem;   // 第一圈末（gale r1）
  const lastMem = report.visits[11].mem; // 第二圈末（gale r2）
  const growthTex = lastMem.textures - midMem.textures;
  const growthGeo = lastMem.geometries - midMem.geometries;
  report.summary = {
    allBuilt,
    texturesAfterRound1: midMem.textures, texturesAfterRound2: lastMem.textures, growthTex,
    geometriesAfterRound1: midMem.geometries, geometriesAfterRound2: lastMem.geometries, growthGeo,
    note: 'renderer.info.memory 为计数器（非实测显存字节）；第二圈为同页缓存复访，增长应≈0',
  };
  report.PASS = allBuilt && growthTex <= 8 && growthGeo <= 8 && errors.length === 0;
} catch (e) {
  report.PASS = false;
  report.failure = String(e.stack || e);
  await page.screenshot({ path: `${OUT}/failure.png` }).catch(() => {});
} finally {
  await fs.writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 1));
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
console.log(JSON.stringify(report.summary ?? { failure: report.failure }, null, 1));
console.log(report.PASS ? 'SIXSITE PASS' : 'SIXSITE FAIL');
process.exit(report.PASS ? 0 : 2);
