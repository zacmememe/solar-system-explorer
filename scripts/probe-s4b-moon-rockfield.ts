/**
 * S4b 回归探针：月面碎石 metricScale 修复后的触地可见性（轻量——不走完整下降流，
 * 直接 enterSurfaceLook 站点 + 反射调 ensureLandingLighting 保证白昼）
 */
import puppeteer from 'puppeteer-core';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:5199';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = 'D:/solar-evidence/pro-review';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=d3d11', '--enable-webgl', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window as any).__solarEngine?.getLunarValleyMesh?.()?.visible, { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1000));

  // 碎石实例尺寸硬核对（修复后应为 0.15–2.5m 级）
  const rockInfo = await page.evaluate(() => {
    const e = (window as any).__solarEngine;
    const T = (window as any).THREE;
    const moonPose = e.getBodyWorldPose('moon');
    const metersPerScene = 1737400 / moonPose.surfaceRadius;
    let sizes: number[] = [];
    let dists: number[] = [];
    e.scene.traverse((o: any) => {
      if (o.name === 'procedural-rockfield' && sizes.length === 0) {
        const m = new T.Matrix4();
        const scl = new T.Vector3();
        const pos = new T.Vector3();
        const quat = new T.Quaternion();
        for (const i of [0, 5, 10, 20, 40]) {
          o.getMatrixAt(i, m);
          m.decompose(pos, quat, scl);
          sizes.push(+(scl.x * metersPerScene).toFixed(3));
          dists.push(+pos.clone().applyMatrix4(o.matrixWorld).distanceTo(e.camera.position).toFixed(3));
        }
      }
    });
    return { metersPerScene, sizes, distsScene: dists };
  });
  console.log('[moon rocks] sizes(m)=', JSON.stringify(rockInfo.sizes));

  // 白昼 + 触地观察（yaw 225 谷景，同月面 SURFACE_LOOK 默认构图）
  await page.evaluate(() => {
    const e = (window as any).__solarEngine;
    e.executeCameraCommand({ type: 'select', bodyId: 'moon' });
    (e as any).ensureLandingLighting();
    e.executeCameraCommand({
      type: 'enterSurfaceLook', bodyId: 'moon', lat: 20.2108, lon: 30.7997,
      eyeHeightM: 1.7, initialYawDeg: 225, initialPitchDeg: 6,
    });
  });
  await new Promise((r) => setTimeout(r, 2500));
  for (const [name, yaw] of [['n', 225], ['e2', 315], ['s2', 45]] as Array<[string, number]>) {
    await page.evaluate((y) => {
      (window as any).__solarEngine.executeCameraCommand({ type: 'setSurfaceLook', yawDeg: y, pitchDeg: 4 });
    }, yaw);
    await new Promise((r) => setTimeout(r, 600));
    await page.screenshot({ path: `${OUT}/s4b-moon-rockfield-${name}.png` });
    console.log('[shot]', name);
  }
  await browser.close();
  console.log('MOON PROBE DONE');
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
