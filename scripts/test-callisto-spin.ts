import puppeteer from 'puppeteer-core';
import path from 'node:path';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
    args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=d3d11', '--no-sandbox'],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  await page.goto('http://localhost:4173');
  await page.waitForSelector('[data-testid="mission-hud"][data-ready="true"]');
  await page.click('[data-testid="planet-btn-jupiter"]');
  await new Promise((r) => setTimeout(r, 1200));
  await page.click('[data-testid="moon-btn-callisto"]');
  await new Promise((r) => setTimeout(r, 3200));

  for (const spin of [0, 1.57, 3.14, 4.71]) {
    await page.evaluate((s) => {
      const engine = (window as any).__SOLAR_ENGINE__;
      engine.setPlanetSpinOffset('callisto', s);
    }, spin);
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: path.resolve(`artifacts/pro-review/test-callisto-spin-${spin}.png`) });
    console.log(`Saved spin ${spin}`);
  }
  await browser.close();
}
main().catch(console.error);
