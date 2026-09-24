/** S4b 诊断：火星地表材质/碎石/光照/透明度运行时状态 */
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
  page.on('console', (m) => console.log('[browser]', m.type(), m.text().slice(0, 300)));
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
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
  await new Promise((r) => setTimeout(r, 2500));

  const diag = await page.evaluate(() => {
    const e = (window as any).__solarEngine;
    const T = (window as any).THREE;
    const terrain = e.getMarsTerrainMesh();
    const mat = terrain?.material;
    const scene = e.scene;
    // 灯光清单
    const lights: any[] = [];
    scene.traverse((o: any) => {
      if (o.isLight) {
        lights.push({
          type: o.type, intensity: o.intensity,
          pos: o.position ? [o.position.x.toFixed?(o.position.x.toFixed(3)):o.position.x].concat([]) : null,
          target: o.target ? { x: o.target.position?.x, y: o.target.position?.y, z: o.target.position?.z } : null,
          color: o.color ? o.color.getHexString() : null,
        });
      }
    });
    // 碎石实例
    const rocks: any[] = [];
    scene.traverse((o: any) => {
      if (o.name === 'procedural-rockfield-mars') {
        const wp = new T.Vector3();
        o.getWorldPosition(wp);
        rocks.push({ count: o.count, visible: o.visible, worldPos: [wp.x.toFixed(4), wp.y.toFixed(4), wp.z.toFixed(4)], matOpacity: o.material?.opacity });
      }
    });
    // cap/collar
    let capInfo = null, collarInfo = null;
    scene.traverse((o: any) => {
      if (o.name === 'mars-hole-cap') capInfo = { visible: o.visible };
      if (o.name === 'jezero-collar') collarInfo = { visible: o.visible, opacity: o.material?.opacity, hasMap: !!o.material?.map };
    });
    // 相机到岩石最近距离（用第一个实例矩阵）
    let nearestRock: number | null = null;
    if (rocks.length) {
      scene.traverse((o: any) => {
        if (o.name === 'procedural-rockfield-mars' && nearestRock === null) {
          const m = new T.Matrix4();
          // 逐实例找最近
          const camPos = e.camera.position;
          let best = Infinity;
          for (let i = 0; i < o.count; i++) {
            o.getMatrixAt(i, m);
            const p = new T.Vector3().setFromMatrixPosition(m).applyMatrix4(o.matrixWorld);
            const d = p.distanceTo(camPos);
            if (d < best) best = d;
          }
          nearestRock = best;
        }
      });
    }
    const tex = mat?.map;
    return {
      terrainMat: {
        hasMap: !!tex,
        mapImage: tex?.image ? { w: tex.image.width, h: tex.image.height } : null,
        color: mat?.color?.getHexString?.(),
        opacity: mat?.opacity,
        roughness: mat?.roughness,
      },
      lights,
      rocks,
      nearestRockM: nearestRock,
      capInfo,
      collarInfo,
      camPos: [e.camera.position.x, e.camera.position.y, e.camera.position.z].map((v) => v.toFixed(4)),
    };
  });
  console.log(JSON.stringify(diag, null, 2));
  await browser.close();
}

main().catch((e) => { console.error('DIAG FAILED:', e); process.exit(1); });
