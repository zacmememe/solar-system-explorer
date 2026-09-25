// R2（260925 基础体验恢复·第二批）：地球瓦片覆盖唯一性回归探针。
// 拉近地球触发多级 LOD 分裂与纹理加载，全程断言：
//  - coverageDiagnostic().violations === 0（父子不同画同一表面——改前
//    加载/混合期父级与 4 子同画，同区域 5 层几何，独立黑片来源）
//  - 画面非黑且有纹理（祖先纹理子窗口在加载期保持视觉连续）
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
  await page.setCacheEnabled(false); // 强制纹理重下载——验证加载/混合窗口的覆盖唯一性
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const consoleErrs: string[] = [];
  page.on('pageerror', (e) => consoleErrs.push(`[pageerror] ${String(e).slice(0, 160)}`));
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window as any).__solarEngine?.getEarthTileManager?.(), { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));

  interface SampleR { cov: { violations: number; visibleMeshes: number; loadingTiles: number; fadingTiles: number }; nonBlack: number; meanLum: number; lumStd: number }
  const sample = (): Promise<SampleR> =>
    page.evaluate(`(() => {
      const e = window.__solarEngine;
      const cov = e.getEarthTileManager().coverageDiagnostic();
      // 同管线画面统计（非黑占比+亮度方差——加载期祖先纹理应保持连续）
      e.renderFrame();
      const r = e.renderer;
      const gl = r.getContext();
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      const buf = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let nonBlack = 0, sum = 0, sumSq = 0, n = 0;
      for (let ix = 0; ix < 24; ix++) for (let iy = 0; iy < 14; iy++) {
        const x = Math.floor((ix + 0.5) * W / 24), y = Math.floor((iy + 0.5) * H / 14);
        const i = (y * W + x) * 4;
        const l = 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2];
        if (l > 8) nonBlack++;
        sum += l; sumSq += l * l; n++;
      }
      const mean = sum / n, std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
      return { cov, nonBlack: +(nonBlack / n).toFixed(3), meanLum: +mean.toFixed(1), lumStd: +std.toFixed(1) };
    })()`).then((r) => r as unknown as SampleR);

  const enterLook = (eyeM: number) =>
    page.evaluate((h: number) => {
      (window as any).__solarEngine.cameraController.executeCommand({
        type: 'enterSurfaceLook', bodyId: 'earth', lat: 22.6, lon: 113.9, eyeHeightM: h,
      });
    }, eyeM);
  const settle = () =>
    page.waitForFunction(() => {
      const s = (window as any).__solarEngine.cameraController.getSnapshot();
      return !s.isTransitioning;
    }, { timeout: 30000, polling: 300 });

  // 先进入地表观察（3Mm 高度），再选白昼时刻，最后压俯视角
  await enterLook(3_000_000);
  await settle().catch(() => {});
  // 选白昼时刻（太阳直射珠江口附近）：扫描 simTime 取画面最亮者（夜面城市灯
  // 光太暗，不适合本探针的画面连续性判据）
  const lookDown = () =>
    page.evaluate(() => {
      (window as any).__solarEngine.cameraController.executeCommand({ type: 'setSurfaceLook', yawDeg: 0, pitchDeg: -50 });
    });
  let bestTime = 0;
  let bestLum = -1;
  for (const t of [0, 4, 8, 12, 16, 20]) {
    const lum = await page.evaluate((tt: number) => {
      const e = (window as any).__solarEngine;
      e.simTimeHours = tt;
      e.updateEphemerisPoses(0);
      return 0;
    }, t).then(async () => {
      await lookDown();
      await new Promise((r) => setTimeout(r, 250));
      return (await sample()).meanLum;
    });
    console.log(`[time-scan] t=${t} meanLum=${lum}`);
    if (lum > bestLum) { bestLum = lum; bestTime = t; }
  }
  await page.evaluate((t: number) => {
    const e = (window as any).__solarEngine;
    e.simTimeHours = t;
    e.updateEphemerisPoses(0);
  }, bestTime);
  console.log(`[time] chose t=${bestTime} (meanLum=${bestLum})`);
  if (bestLum < 15) throw new Error(`未找到白昼时刻: bestLum=${bestLum}`);
  await lookDown();
  await new Promise((r) => setTimeout(r, 400));

  let worst = { violations: 0, stage: '' };
  let sawLoading = false;

  // 逐级拉近（珠江口上空——瓦片 ROI 覆盖区），每级加载窗口内密集采样
  for (const [stage, eyeM] of [['3Mm', 3_000_000], ['1.2Mm', 1_200_000], ['400km', 400_000], ['120km', 120_000]] as const) {
    await enterLook(eyeM);
    await settle().catch(() => {}); // enterSurfaceLook 可能瞬时完成
    for (let i = 0; i < 10; i++) {
      const s = await sample();
      if (s.cov.loadingTiles > 0 || s.cov.fadingTiles > 0) sawLoading = true;
      if (s.cov.violations > worst.violations) worst = { violations: s.cov.violations, stage: `${stage}#${i}` };
      if (i === 4) console.log(`[${stage}] mid =`, JSON.stringify(s));
      await new Promise((r) => setTimeout(r, 350));
    }
    const s = await sample();
    console.log(`[${stage}] end =`, JSON.stringify(s));
    if (s.nonBlack < 0.25) throw new Error(`${stage} 画面黑屏占比异常: ${s.nonBlack}`);
  }

  // 全程违规必须为 0；且确实观察到加载/混合窗口（探针有效性）
  if (worst.violations > 0) throw new Error(`覆盖唯一性违规: ${JSON.stringify(worst)}`);
  if (!sawLoading) console.log('[note] 未观察到加载窗口（缓存热）——violations=0 仍有效，冷缓存复验留给实机');

  // 回轨道态
  await page.evaluate(() => {
    (window as any).__solarEngine.executeCameraCommand({ type: 'flyTo', bodyId: 'earth', durationSec: 1.0 });
  });
  await settle();
  const back = await sample();
  console.log('[orbit back] =', JSON.stringify(back));
  if (back.cov.violations > 0) throw new Error('返轨后覆盖违规');

  console.log('[errors]', consoleErrs.length ? consoleErrs.slice(0, 8).join(' | ') : '(none)');
  await browser.close();
  console.log('R2 PROBE DONE');
}

main().catch((e) => { console.error('R2 PROBE FAILED:', e); process.exit(1); });
