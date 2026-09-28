// 归因 profile：dev 构建（未压缩、函数名可读）。只用于热点调用链归因，不作为性能对照。
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';

const OUT = 'D:/solar-evidence/F-STARTUP-RESPONSIVENESS-11/attr-devprofile';
await fs.mkdir(OUT, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0];
console.log('dev url:', url);
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true, defaultViewport: { width: 1920, height: 1080 }, protocolTimeout: 300000,
  args: ['--use-gl=angle', '--use-angle=d3d11'],
});
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 140)); });
const cdp = await page.createCDPSession();
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
await cdp.send('Profiler.start');
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => window.__solarEngine, { timeout: 240000, polling: 100 });
const engineT = await page.evaluate(() => performance.now());
await page.waitForFunction(() => window.__solarEngine.moonSiteStacks?.get('taurus-littrow')?.built, { timeout: 240000, polling: 200 });
await new Promise((r) => setTimeout(r, 2000));
const builtT = await page.evaluate(() => performance.now());
const { profile } = await cdp.send('Profiler.stop');
await fs.writeFile(`${OUT}/dev.cpuprofile`, JSON.stringify(profile));
console.log(JSON.stringify({ engineT, builtT }));
await browser.close();
await new Promise((r) => server.httpServer?.close(r));
console.log('DEV PROFILE DONE');
