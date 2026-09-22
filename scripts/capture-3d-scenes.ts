import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const executablePath = candidates.find((p): p is string => !!p && fs.existsSync(p));
if (!executablePath) throw new Error('No Chromium executable found.');

const outDir = path.resolve('artifacts/scene-review');
fs.mkdirSync(outDir, { recursive: true });

const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  defaultViewport: { width: 1440, height: 900 },
});

try {
  const page = await browser.newPage();
  await page.goto(process.env.TEST_URL || 'http://localhost:4173', { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="mission-hud"][data-ready="true"]', { timeout: 30000 });

  // 1. 地球系统场景截图（初始默认构图，无全局轨道切割，地月系统）
  await pause(1500);
  await page.screenshot({ path: path.join(outDir, '01-earth-framed.png') });
  console.log('📸 01-earth-framed.png 已捕获');

  // 2. 飞往土星（检验土星环双面受光、环投影阴影、卫星同心轨道、局部系统无全局杂线）
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const saturnBtn = buttons.find(b => b.innerText.includes('土星'));
    saturnBtn?.click();
  });
  // 等待飞行转场完成与环材质着色器渲染
  await pause(3500);
  await page.screenshot({ path: path.join(outDir, '02-saturn-rings-sunlit.png') });
  console.log('📸 02-saturn-rings-sunlit.png 已捕获');

  // 3. 飞往月球（检验月球近景地貌、绕地球轨道半长轴标注、无自身文字标签遮挡）
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const earthBtn = buttons.find(b => b.innerText.includes('地球'));
    earthBtn?.click();
  });
  await pause(1000);
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const moonBtn = buttons.find(b => b.innerText.includes('月球'));
    moonBtn?.click();
  });
  await pause(3500);
  await page.screenshot({ path: path.join(outDir, '03-moon-closeup.png') });
  console.log('📸 03-moon-closeup.png 已捕获');

} finally {
  await browser.close();
}
