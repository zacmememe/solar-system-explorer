// R1（260925 基础体验恢复）：渲染统一与遮挡回归探针。
// 全程走 renderFrame()（与实时主循环同一入口）截图；断言：
//  1) 普通轨道浏览恒单 pass（layered=false——审计前按目标名称分层+深度混合，
//     普通浏览出现黑片/穿插的根因）
//  2) 冷启动地球多角度画面非黑、有纹理（24×14 网格非黑占比+亮度方差）
//  3) 太阳（NAV 前往）可见；土星环同框正常
//  4) SURFACE_LOOK 近表面才走双 pass（layered=true，远 pass 近面>0.01）
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:5199';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = 'D:/solar-evidence/pro-review';

interface FrameDiag {
  b64?: string;
  info: { layered: boolean; anchorBodyId: string | null; anchorDistOverRadius: number; farNearPlane: number | null };
  stats: { nonBlackRatio: number; meanLum: number; lumStd: number; pxCenter: number[]; pxUpper: number[]; pxLower: number[] };
}

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

  // 与实时主循环同一入口取证（renderFrame 不推进模拟，只重画当前帧状态）
  const shot = (save?: string) =>
    page.evaluate(`(() => {
      const e = window.__solarEngine;
      e.renderFrame();
      const renderer = e.renderer;
      const gl = renderer.getContext();
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      const buf = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      const lum = (i) => 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2];
      let nonBlack = 0, sum = 0, sumSq = 0, n = 0;
      for (let ix = 0; ix < 24; ix++) for (let iy = 0; iy < 14; iy++) {
        const x = Math.floor((ix + 0.5) * W / 24), y = Math.floor((iy + 0.5) * H / 14);
        const i = (y * W + x) * 4;
        const l = lum(i);
        if (l > 8) nonBlack++;
        sum += l; sumSq += l * l; n++;
      }
      const mean = sum / n, std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
      const px = (x, y) => { const i = ((H - 1 - y) * W + x) * 4; return [buf[i], buf[i + 1], buf[i + 2]]; };
      let b64 = null;
      if (${save ? 1 : 0}) {
        const c2d = document.createElement('canvas');
        c2d.width = W; c2d.height = H;
        const ctx = c2d.getContext('2d');
        const img = ctx.createImageData(W, H);
        for (let y = 0; y < H; y++) {
          const src = (H - 1 - y) * W * 4;
          img.data.set(buf.subarray(src, src + W * 4), y * W * 4);
        }
        ctx.putImageData(img, 0, 0);
        b64 = c2d.toDataURL('image/png').split(',')[1];
      }
      return {
        b64,
        info: e.lastFrameRenderInfo,
        stats: { nonBlackRatio: +(nonBlack / n).toFixed(3), meanLum: +mean.toFixed(1), lumStd: +std.toFixed(1),
                 pxCenter: px(Math.floor(W / 2), Math.floor(H / 2)), pxUpper: px(Math.floor(W / 2), Math.floor(H * 0.15)), pxLower: px(Math.floor(W / 2), Math.floor(H * 0.85)) },
      };
    })()`).then((r: unknown) => {
      const d = r as FrameDiag;
      if (d.b64 && save) fs.writeFileSync(`${OUT}/${save}`, Buffer.from(d.b64, 'base64'));
      return d;
    });

  const flyTo = (bodyId: string) =>
    page.evaluate((b: string) => {
      (window as any).__solarEngine.executeCameraCommand({ type: 'flyTo', bodyId: b, durationSec: 1.2 });
    }, bodyId);
  const settle = () =>
    page.waitForFunction(() => {
      const s = (window as any).__solarEngine.cameraController.getSnapshot();
      return !s.isTransitioning;
    }, { timeout: 45000, polling: 300 });

  // 1) 冷启动地球（默认取景 dist≈4.6R：地球居中小盘+黑太空为正常构图）
  await new Promise((r) => setTimeout(r, 6000));
  const earth1 = await shot('r1-earth-cold.png');
  const log = (tag: string, d: FrameDiag) => console.log(tag, JSON.stringify({ info: d.info, stats: d.stats }));
  log('[1] earth cold  ', earth1);
  if (earth1.info.layered) throw new Error('普通浏览地球被判定为分层（应为单 pass）');
  if (earth1.stats.nonBlackRatio < 0.05) throw new Error(`地球画面黑屏占比异常: ${earth1.stats.nonBlackRatio}`);
  const cLum = 0.299 * earth1.stats.pxCenter[0] + 0.587 * earth1.stats.pxCenter[1] + 0.114 * earth1.stats.pxCenter[2];
  if (cLum < 10) throw new Error(`画面中心（地球）过暗: ${earth1.stats.pxCenter}`);

  // 2) 相机绕转（模拟用户拖动旋转）——普通浏览全程单 pass + 画面稳定
  for (const yaw of [40, 130, 250]) {
    await page.evaluate(`((y) => {
      const e = window.__solarEngine;
      const THREE = window.THREE;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), y * Math.PI / 180);
      e.camera.quaternion.premultiply(q);
    })(${yaw})`);
    await new Promise((r) => setTimeout(r, 700));
    const s = await shot(yaw === 130 ? 'r1-earth-rot130.png' : undefined);
    log(`[2] rot ${yaw}    `, s);
    if (s.info.layered) throw new Error(`旋转中被判定为分层 @${yaw}`);
    if (s.stats.nonBlackRatio < 0.05) throw new Error(`旋转后黑屏占比异常 @${yaw}`);
  }

  // 3) 前往太阳（NAV 语义下太阳必须可见——物理模式隐藏属 R3 修复项，此处验证现状基线）
  await flyTo('sun');
  await settle();
  await new Promise((r) => setTimeout(r, 800));
  const sun = await shot('r1-sun.png');
  log('[3] sun         ', sun);
  if (sun.info.layered) throw new Error('太阳观察被判定为分层');
  if (sun.stats.meanLum < 12) throw new Error(`太阳画面过暗: meanLum=${sun.stats.meanLum}`);

  // 4) 土星与星环（远 pass 天体完整性：环+本体同框）
  await flyTo('saturn');
  await settle();
  await new Promise((r) => setTimeout(r, 800));
  const saturn = await shot('r1-saturn.png');
  log('[4] saturn      ', saturn);
  if (saturn.info.layered) throw new Error('土星观察被判定为分层');
  if (saturn.stats.nonBlackRatio < 0.05) throw new Error(`土星画面异常: ${saturn.stats.nonBlackRatio}`);

  // 5) 回地球 → 月球（普通浏览切换稳定性）
  await flyTo('earth');
  await settle();
  const back = await shot();
  log('[5] earth back  ', back);
  await flyTo('moon');
  await settle();
  await new Promise((r) => setTimeout(r, 800));
  const moonOrbit = await shot('r1-moon-orbit.png');
  log('[6] moon orbit  ', moonOrbit);
  if (moonOrbit.info.layered) throw new Error('月球轨道取景被判定为分层（2.9R 应单 pass）');

  // 6) 月面 SURFACE_LOOK：应走双 pass（贴近表面），画面正常
  await page.evaluate(() => {
    const e = (window as any).__solarEngine;
    e.cameraController.executeCommand({
      type: 'enterSurfaceLook', bodyId: 'moon', lat: 20.2108, lon: 30.7997, eyeHeightM: 30,
    });
  });
  await page.waitForFunction(() => {
    const s = (window as any).__solarEngine.cameraController.getSnapshot();
    return s.mode === 'SURFACE_LOOK' && !s.isTransitioning;
  }, { timeout: 30000, polling: 300 });
  await new Promise((r) => setTimeout(r, 1200));
  const surface = await shot('r1-moon-surface.png');
  log('[7] moon surface', surface);
  if (!surface.info.layered) throw new Error('SURFACE_LOOK 未走双 pass（贴近表面应分层）');
  if ((surface.info.farNearPlane ?? 0) <= 0.01) throw new Error(`远 pass 近面异常: ${surface.info.farNearPlane}`);
  if (surface.stats.nonBlackRatio < 0.2) throw new Error(`月面画面黑屏占比异常: ${surface.stats.nonBlackRatio}`);

  // 7) 退出地表回轨道（flyTo）→ 回到单 pass
  await flyTo('moon');
  await settle();
  await new Promise((r) => setTimeout(r, 800));
  const orbitBack = await shot();
  log('[8] orbit back  ', orbitBack);
  if (orbitBack.info.layered) throw new Error('返轨后仍被判定为分层');

  console.log('[errors]', consoleErrs.length ? consoleErrs.slice(0, 10).join(' | ') : '(none)');
  await browser.close();
  console.log('R1 PROBE DONE');
}

main().catch((e) => { console.error('R1 PROBE FAILED:', e); process.exit(1); });
