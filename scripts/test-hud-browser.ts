/** Integration checks for the user's REAL local app (not the supplied offline preview).
 * Copy to project/scripts; run: npx tsx scripts/test-hud-browser.ts
 * Optional TEST_URL (default http://localhost:4173), CHROME_PATH, HEADLESS=false.
 * This does not assert planetary visual realism based on DOM labels.
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const candidates = [process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/google-chrome'];
const executablePath = candidates.find((p): p is string => !!p && fs.existsSync(p));
if (!executablePath) throw new Error('Set CHROME_PATH to your installed Chromium-based browser.');
const browser = await puppeteer.launch({ executablePath, headless: process.env.HEADLESS !== 'false', defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
const failures: string[] = [];
page.on('pageerror', e => failures.push(String(e)));
page.on('console', m => { if (m.type() === 'error') failures.push(m.text()); });
page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) failures.push(`${r.status()} ${r.url()}`); });
const out = path.resolve('artifacts/hud-integration'); fs.mkdirSync(out, { recursive: true });
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const checks: { name: string; pass: boolean }[] = [];
const check = (name: string, result: boolean) => { checks.push({ name, pass: result }); if (!result) throw new Error(name); };
async function userClick(selector: string) {
  await page.waitForSelector(selector, { visible: true });
  const usable = await page.$eval(selector, e => {
    const r = e.getBoundingClientRect();
    if (r.width < 40 || r.height < 44) return false;
    for (let p: Element | null = e; p; p = p.parentElement) {
      const css = getComputedStyle(p);
      if (Number(css.opacity) === 0 || css.visibility === 'hidden' || css.display === 'none' || p.getAttribute('aria-hidden') === 'true') return false;
    }
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return top === e || (top !== null && e.contains(top));
  });
  check(`Operable visible control: ${selector}`, usable);
  await page.click(selector);
}
try {
  await page.goto(process.env.TEST_URL || 'http://localhost:4173', { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="mission-hud"][data-ready="true"]', { timeout: 30000 });
  check('Existing application canvas has WebGL2', await page.evaluate(() => !!document.querySelector('canvas')?.getContext('webgl2')));
  // This is capability, not evidence of hardware acceleration or good frame rate.
  await userClick('[aria-label="暂停模拟"]');
  await page.waitForSelector('[data-is-paused="true"]');
  const t1 = await page.$eval('[data-sim-hours]', e => e.getAttribute('data-sim-hours'));
  await pause(400);
  const t2 = await page.$eval('[data-sim-hours]', e => e.getAttribute('data-sim-hours'));
  check('Pause really freezes engine simulation time', t1 === t2);
  await userClick('[aria-label="调整时间流速"]');
  await userClick('[data-speed="86400"]');
  await page.waitForSelector('[data-time-scale="86400"]');
  await page.keyboard.press('Escape');
  check('Escape closes popover', (await page.$('[role="dialog"]')) === null);
  await userClick('[aria-label="继续模拟"]');
  await pause(300);
  const t3 = await page.$eval('[data-sim-hours]', e => Number(e.getAttribute('data-sim-hours')));
  check('Resume advances the shared engine clock', t3 > Number(t2));
  await userClick('[aria-label="暂停模拟"]');
  for (const [width, height] of [[1920,1080],[1440,900],[1024,768],[768,1024],[390,844]]) {
    await page.setViewport({ width, height }); await pause(250);
    const fits = await page.$$eval('.hud-flight,.hud-context,.hud-target', elements => {
      const boxes = elements.map(e => e.getBoundingClientRect());
      if (boxes.some(r => r.x < 0 || r.y < 0 || r.right > innerWidth + .5 || r.bottom > innerHeight + .5)) return false;
      return boxes.every((a, i) => boxes.slice(i + 1).every(b => Math.min(a.right, b.right) <= Math.max(a.left, b.left) + .5 || Math.min(a.bottom, b.bottom) <= Math.max(a.top, b.top) + .5));
    });
    check(`Real app HUD layout ${width}x${height}`, fits);
    await page.screenshot({ path: path.join(out, `${width}x${height}.png`) });
  }
  check('No captured JavaScript or resource errors', failures.length === 0);
} catch (e) {
  failures.push(String(e)); process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ checks, failures,
    limitations: 'No shader/texture authenticity judgement, no complete 32-body visual regression, no production deployment validation.' }, null, 2));
  await browser.close();
}
