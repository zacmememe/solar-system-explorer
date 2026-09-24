/** S4b 诊断2：岩石实例矩阵的真实世界尺寸（米）与网格 scale 链 */
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
    let report: any = { metersPerScene, marsSurfaceRadius: mars.surfaceRadius };
    e.scene.traverse((o: any) => {
      if (o.name === 'procedural-rockfield-mars' && !report.samples) {
        const m = new T.Matrix4();
        const scl = new T.Vector3();
        const pos = new T.Vector3();
        const quat = new T.Quaternion();
        const samples = [];
        for (const i of [0, 1, 2, 50, 100]) {
          o.getMatrixAt(i, m);
          m.decompose(pos, quat, scl);
          const worldScl = scl.clone().multiply(o.getWorldScale(new T.Vector3()));
          samples.push({
            localScale: [scl.x, scl.y, scl.z].map((v) => +v.toFixed(4)),
            worldRadiusM: worldScl.x * metersPerScene,
            distFromCamM: pos.clone().applyMatrix4(o.matrixWorld).distanceTo(e.camera.position) * metersPerScene,
          });
        }
        // mesh 世界 scale
        let parent = o.parent;
        const chain: any[] = [];
        while (parent) {
          chain.push({ name: parent.name || parent.type, worldScale: parent.getWorldScale(new T.Vector3()).x });
          parent = parent.parent;
        }
        report = { ...report, samples, parentChain: chain };
      }
    });
    return report;
  });
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
