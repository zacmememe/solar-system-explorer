// R6：地球遮挡语义 A/B 审计（用户实机复报：360° 拖动旋转时星球全在地球前方、
// 透视错乱）。方法：白昼面下，完整渲染 A vs 仅地球渲染 B——地球圆盘（屏幕中心）
// 像素应一致（地球挡住背后一切天体）；|A−B| 大 = 有天体画在地球前面。
// 拖动模拟：细粒度连续 orbit（双参，与 onPointerMove 同路径），全程断言相机有限。
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
  const consoleErrs: string[] = [];
  page.on('pageerror', (e) => consoleErrs.push(`[pageerror] ${String(e).slice(0, 160)}`));
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window as any).__solarEngine?.camera, { timeout: 30000 });

  await page.evaluate(() => {
    (window as any).__solarEngine.executeCameraCommand({ type: 'flyTo', bodyId: 'earth', durationSec: 1.0 });
  });
  await page.waitForFunction(() => {
    const s = (window as any).__solarEngine.cameraController.getSnapshot();
    return !s.isTransitioning;
  }, { timeout: 60000, polling: 300 });
  await new Promise((r) => setTimeout(r, 1500));

  // 白昼面：扫描 simTime 取中央最亮（夜面无法判遮挡——黑球也挡）
  let best = { t: 0, lum: -1 };
  for (const t of [0, 4, 8, 12, 16, 20]) {
    const lum = await page.evaluate(`((tt) => {
      const e = window.__solarEngine;
      e.simTimeHours = tt;
      e.updateEphemerisPoses(0);
      e.renderFrame();
      const r = e.renderer, gl = r.getContext();
      const buf = new Uint8Array(4);
      gl.readPixels(Math.floor(gl.drawingBufferWidth / 2), Math.floor(gl.drawingBufferHeight / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      return 0.299 * buf[0] + 0.587 * buf[1] + 0.114 * buf[2];
    })(${t})`);
    console.log(`[time-scan] t=${t} centerLum=${(lum as number).toFixed(1)}`);
    if ((lum as number) > best.lum) best = { t, lum: lum as number };
  }
  await page.evaluate((t: number) => {
    const e = (window as any).__solarEngine;
    e.simTimeHours = t;
    e.updateEphemerisPoses(0);
  }, best.t);
  console.log(`[time] chose t=${best.t} lum=${best.lum.toFixed(1)}`);
  if (best.lum < 20) throw new Error('未找到白昼面（中央过暗）——遮挡审计无法进行');

  // 连续细粒度拖动 360°（3×0.0873rad/步 = 15°/步），每步 A/B + 相机有限断言
  const audit = await page.evaluate(`(async () => {
    const e = window.__solarEngine;
    const r = e.renderer, gl = r.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const buf = new Uint8Array(W * H * 4);
    const centerAvg = () => {
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let ix = 0; ix < 5; ix++) for (let iy = 0; iy < 5; iy++) {
        const x = Math.floor(W * (0.4 + 0.2 * (ix + 0.5) / 5));
        const y = Math.floor(H * (0.4 + 0.2 * (iy + 0.5) / 5));
        const i = ((H - 1 - y) * W + x) * 4;
        sr += buf[i]; sg += buf[i + 1]; sb += buf[i + 2]; n++;
      }
      return [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)];
    };
    const others = [];
    for (const [id, node] of e.bodyNodes.entries()) {
      if (id !== 'earth') others.push(node);
    }
    const results = [];
    for (let step = 0; step < 24; step++) {
      // 细粒度拖动（onPointerMove 同款 0.005 系数量级）
      for (let k = 0; k < 3; k++) {
        e.cameraController.executeCommand({ type: 'orbit', deltaTheta: 0.0873, deltaPhi: (k % 2 ? 0.004 : -0.004) });
        await new Promise((res) => setTimeout(res, 40));
      }
      const camFinite = Number.isFinite(e.camera.position.x) && Number.isFinite(e.camera.matrixWorld.elements[0]);
      e.renderFrame();
      const a = centerAvg();
      const hidden = [];
      for (const node of others) {
        if (node.data.type === 'star') {
          if (node.systemGroup.visible) { node.systemGroup.visible = false; hidden.push(() => (node.systemGroup.visible = true)); }
        } else if (node.poleFrame.visible) {
          node.poleFrame.visible = false;
          hidden.push(() => (node.poleFrame.visible = true));
        }
      }
      e.renderFrame();
      const b = centerAvg();
      for (const restore of hidden) restore();
      const diff = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
      results.push({ step: (step + 1) * 15, camFinite, a, b, diff });
    }
    return results;
  })()`);

  let violations = 0;
  let nanFrames = 0;
  for (const s of audit as Array<{ step: number; camFinite: boolean; a: number[]; b: number[]; diff: number }>) {
    const flags: string[] = [];
    if (!s.camFinite) { nanFrames++; flags.push('CAMERA-NaN'); }
    if (s.diff > 40) { violations++; flags.push('OCCLUSION'); }
    if (flags.length) console.log(`[rot ${s.step}°] A=${s.a} B=${s.b} diff=${s.diff} <<< ${flags.join('+')}`);
  }
  console.log(`[summary] 拖动 360°：遮挡违规 ${violations}/24，相机NaN帧 ${nanFrames}/24，pageerror ${consoleErrs.length}`);
  await browser.close();
  if (violations > 0 || nanFrames > 0 || consoleErrs.length > 0) {
    console.log('OCCLUSION AUDIT: FAILED');
    process.exit(1);
  }
  console.log('OCCLUSION AUDIT: PASSED');
}

main().catch((e) => { console.error('AUDIT FAILED:', e); process.exit(1); });
