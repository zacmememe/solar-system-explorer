/**
 * S2 探针（Pro 260924 减法验收）：主场景公转轨迹线移除验证。
 * 程序断言：场景图中 THREE.LineLoop 数量 = 0（真实星环为 Ring 网格，不受影响）；
 * 截图留档：太阳系总览 + 地月系特写（此前卫星同心轨道环最明显处）。
 */
import puppeteer from 'puppeteer-core';
import * as path from 'path';
import * as fs from 'fs';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:4173';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUTPUT_DIR = 'D:/solar-evidence/pro-review';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=d3d11', '--enable-webgl', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window as any).__solarEngine, { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));

  const countLineLoops = () =>
    page.evaluate(() => {
      const engine = (window as any).__solarEngine;
      let n = 0;
      engine.scene.traverse((o: any) => {
        if (o.type === 'LineLoop' || o.type === 'Line') n++;
      });
      return n;
    });

  // 太阳系总览
  await page.evaluate(() => (window as any).__solarEngine.executeCameraCommand({ type: 'overview' }));
  await new Promise((r) => setTimeout(r, 3500));
  const overviewLoops = await countLineLoops();
  await page.screenshot({ path: path.join(OUTPUT_DIR, '90-s2-overview-no-orbit-lines.png') });

  // 地月系特写（此前为卫星同心轨道环默认可见的场景）
  await page.evaluate(() => (window as any).__solarEngine.executeCameraCommand({ type: 'flyTo', bodyId: 'earth' }));
  await new Promise((r) => setTimeout(r, 3500));
  const earthLoops = await countLineLoops();
  await page.screenshot({ path: path.join(OUTPUT_DIR, '91-s2-earth-system-no-orbit-lines.png') });

  const consoleOk = true;
  await browser.close();

  console.log(`overview LineLoop/Line count = ${overviewLoops}, earth-system count = ${earthLoops}`);
  const pass = overviewLoops === 0 && earthLoops === 0 && consoleOk;
  console.log(pass ? '✅ S2 探针通过：主场景无任何公转轨迹线' : '❌ S2 探针失败');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
