/**
 * S4b 探针：火星耶泽罗地表观察（v1）
 * 1) 飞抵火星 → availability='observe' → startJezeroSurfaceObserve 进入 1.7m 地表观察；
 * 2) 触地四向 + 仰望截图（视觉核验：真实 HiRISE 地形/正射/碎石/光照）；
 * 3) exitJezeroSurfaceObserve 退出：验证起飞连续性（首帧位置不跳变）与回到 observe 态；
 * 4) 采集 AGL/MSL/高程采样遥测（provider 火星路由数值核对）。
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

  // Jezero 数据装载 + 网格就绪
  await page.waitForFunction(
    () => !!(window as any).__solarEngine?.getMarsTerrainMesh?.()?.visible,
    { timeout: 60000 }
  );
  console.log('[1] jezero terrain mesh visible');

  // 飞抵火星（快速飞行，绕过常规 2.5s 缓动以免超时）
  await page.evaluate(() => {
    (window as any).__solarEngine.executeCameraCommand({ type: 'flyTo', bodyId: 'mars', durationSec: 0.6 });
  });
  await page.waitForFunction(() => {
    const e = (window as any).__solarEngine;
    return e.getLandingAvailability().action === 'observe';
  }, { timeout: 30000, polling: 300 });
  const avail = await page.evaluate(() => (window as any).__solarEngine.getLandingAvailability());
  console.log('[2] at mars, availability =', JSON.stringify(avail));
  await new Promise((r) => setTimeout(r, 1500));

  // 进入地表观察
  const entered = await page.evaluate(() => (window as any).__solarEngine.startJezeroSurfaceObserve());
  console.log('[3] startJezeroSurfaceObserve ->', entered);
  await page.waitForFunction(() => {
    const e = (window as any).__solarEngine;
    return e.getLandingAvailability().action === 'exit-observe';
  }, { timeout: 30000, polling: 200 });
  await new Promise((r) => setTimeout(r, 1200));

  // 遥测：AGL/MSL/站点高程（provider 火星路由）
  const tele = await page.evaluate(() => {
    const e = (window as any).__solarEngine;
    const mars = e.getBodyWorldPose('mars');
    const cam = e.camera.position;
    // 火星 v1 无下降遥测——由 pose 反推 MSL（与 CameraController 同式）
    const distScene = Math.sqrt(
      (cam.x - mars.pos.x) ** 2 + (cam.y - mars.pos.y) ** 2 + (cam.z - mars.pos.z) ** 2
    );
    const mslM = (distScene - mars.surfaceRadius) * (3394839.8133163 / mars.surfaceRadius);
    return { distScene, surfaceRadius: mars.surfaceRadius, mslM };
  });
  console.log('[4] camera pose telemetry =', JSON.stringify(tele));

  // 截图：初始（东南朝向毅力号）+ 四向 + 仰望
  const shot = async (name: string) => {
    await new Promise((r) => setTimeout(r, 700));
    await page.screenshot({ path: `${OUT}/s4b-jezero-${name}.png` });
    console.log(`[5] shot ${name}`);
  };
  await shot('initial');
  const looks: Array<[string, number, number]> = [
    ['north', 0, 2],
    ['east', 90, 2],
    ['south', 180, 2],
    ['west', 270, 2],
    ['up', 115, 80],
    ['down', 115, -50], // 俯视：核对影像-地形锁定（掠射拉丝 vs UV 错位）
  ];
  for (const [name, yaw, pitch] of looks) {
    await page.evaluate((y, p) => {
      (window as any).__solarEngine.executeCameraCommand({
        type: 'setSurfaceLook', yawDeg: y, pitchDeg: p,
      });
    }, yaw, pitch);
    await shot(name);
  }

  // 退出：位置连续性（起飞首帧不跳变）+ 回到 observe 态
  const continuity = (await page.evaluate(() => {
    const e = (window as any).__solarEngine;
    const cam = e.camera.position;
    const before = { x: cam.x, y: cam.y, z: cam.z };
    e.exitJezeroSurfaceObserve();
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const c = e.camera.position;
          resolve({
            before,
            after: { x: c.x, y: c.y, z: c.z },
            jump: Math.sqrt((c.x - before.x) ** 2 + (c.y - before.y) ** 2 + (c.z - before.z) ** 2),
          });
        });
      });
    });
  })) as { jump: number };
  console.log('[6] exit continuity jump (scene units, mars r≈0.53) =', continuity.jump.toFixed(5));
  await page.waitForFunction(() => {
    const e = (window as any).__solarEngine;
    return e.getLandingAvailability().action === 'observe';
  }, { timeout: 30000, polling: 300 });
  const avail2 = await page.evaluate(() => (window as any).__solarEngine.getLandingAvailability());
  console.log('[7] back at mars orbit, availability =', JSON.stringify(avail2));
  await shot('orbit-return');

  await browser.close();
  console.log('PROBE DONE');
}

main().catch((e) => {
  console.error('PROBE FAILED:', e);
  process.exit(1);
});
