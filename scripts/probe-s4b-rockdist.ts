/** S4b 诊断3：碎石实例距离直方图（近景为何无石） */
import puppeteer from 'puppeteer-core';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:5199';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=d3d11', '--enable-webgl', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  page.on('console', (m) => console.log('[browser]', m.type(), m.text().slice(0, 200)));
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window as any).__solarEngine?.getMarsTerrainMesh?.()?.visible, { timeout: 60000 });
  await page.evaluate(() => {
    (window as any).__solarEngine.executeCameraCommand({ type: 'flyTo', bodyId: 'mars', durationSec: 0.6 });
  });
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingAvailability().action === 'observe', {
    timeout: 30000, polling: 300,
  });
  await page.evaluate(() => (window as any).__solarEngine.startJezeroSurfaceObserve());
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingAvailability().action === 'exit-observe', {
    timeout: 30000, polling: 200,
  });
  await new Promise((r) => setTimeout(r, 2000));

  const out = await page.evaluate(() => {
    const e = (window as any).__solarEngine;
    const T = (window as any).THREE;
    const mars = e.getBodyWorldPose('mars');
    const metersPerScene = 3394839.8133163 / mars.surfaceRadius;
    const buckets = { '5-15m': 0, '15-30m': 0, '30-60m': 0, '60-120m': 0, '120-300m': 0, '300m+': 0 };
    let total = 0;
    let sizeSamples: number[] = [];
    e.scene.traverse((o: any) => {
      if (o.name === 'procedural-rockfield-mars') {
        const m = new T.Matrix4();
        const scl = new T.Vector3();
        const pos = new T.Vector3();
        const quat = new T.Quaternion();
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, m);
          m.decompose(pos, quat, scl);
          const d = pos.clone().applyMatrix4(o.matrixWorld).distanceTo(e.camera.position) * metersPerScene;
          total++;
          if (d < 15) buckets['5-15m']++;
          else if (d < 30) buckets['15-30m']++;
          else if (d < 60) buckets['30-60m']++;
          else if (d < 120) buckets['60-120m']++;
          else if (d < 300) buckets['120-300m']++;
          else buckets['300m+']++;
          if (sizeSamples.length < 5) sizeSamples.push(+(scl.x * metersPerScene).toFixed(3));
        }
      }
    });
    return { total, buckets, sizeSamplesM: sizeSamples };
  });
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
