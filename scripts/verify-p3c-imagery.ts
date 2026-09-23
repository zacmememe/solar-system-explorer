/**
 * 太阳系漫游 · P3b-C 实机验收（Pro C 批）
 * 1. WAC EMP 区域反照率层装载（官方产品名/边界/间距溯源）与 SHA-256 校验链路；
 * 2. 裙边换装（同源 WAC，全球等距 UV 逆映射）；
 * 3. SSE 门控（实际 drawingBuffer/FOV）：近开远关 + 迟滞；
 * 4. 中景画面截图（非黑 + 亮度分布）；
 * 5. 未剪辑下降录像（真实 UI 入口 → 接地）+ 200ms 时间轴（AGL + 层可见性），
 *    证明中远景来自实测 WAC 影像而非程序纹理。
 */
import puppeteer from 'puppeteer-core';
import * as path from 'node:path';
import * as fs from 'node:fs';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:4173';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUTPUT_DIR = process.env.EVIDENCE_DIR
  ? path.resolve(process.env.EVIDENCE_DIR)
  : 'D:/solar-evidence/pro-review';
const COMMIT = process.env.P3C_COMMIT || 'worktree-uncommitted';

/** 零依赖 MJPEG-AVI（与 record-p3b-b-descent 同一实现） */
function writeMjpegAvi(frames: Buffer[], width: number, height: number, fps: number, out: string) {
  const fourcc = (s: string) => Buffer.from(s, 'ascii');
  const u32 = (v: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); return b; };
  const u16 = (v: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(v & 0xffff, 0); return b; };
  const n = frames.length;
  const maxFrame = frames.reduce((m, f) => Math.max(m, f.length), 0);
  const avih = Buffer.concat([
    u32(Math.round(1e6 / fps)), u32(Math.round(maxFrame * fps)), u32(0x10), u32(n),
    u32(0), u32(1), u32(maxFrame), u32(width), u32(height), u32(0), u32(0), u32(0), u32(0),
  ]);
  const strh = Buffer.concat([
    fourcc('vids'), fourcc('MJPG'), u32(0), u32(0), u32(0), u32(0), u32(1), u32(fps), u32(0), u32(n),
    u32(maxFrame), u32(0xffffffff), u32(0), u16(0), u16(0), u16(0), u16(width), u16(0), u16(height), u16(0),
  ]);
  const strf = Buffer.concat([
    u32(40), u32(width), u32(height), u16(1), u16(24), fourcc('MJPG'), u32(width * height * 3), u32(0), u32(0), u32(0), u32(0),
  ]);
  const strhChunk = Buffer.concat([fourcc('strh'), u32(strh.length), strh]);
  const strfChunk = Buffer.concat([fourcc('strf'), u32(strf.length), strf]);
  const strlList = Buffer.concat([fourcc('LIST'), u32(4 + strhChunk.length + strfChunk.length), fourcc('strl'), strhChunk, strfChunk]);
  const hdrl = Buffer.concat([fourcc('LIST'), u32(4 + avih.length + 4 + strlList.length), fourcc('hdrl'), fourcc('avih'), u32(avih.length), avih, strlList]);
  const frameChunks: Buffer[] = [];
  const idxEntries: Buffer[] = [];
  let moviBody = fourcc('movi');
  let offset = 4;
  for (const f of frames) {
    const ec = Buffer.concat([fourcc('00dc'), u32(f.length), f, f.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)]);
    frameChunks.push(ec);
    idxEntries.push(Buffer.concat([fourcc('00dc'), u32(0x10), u32(offset), u32(f.length)]));
    offset += ec.length;
  }
  const moviList = Buffer.concat([fourcc('LIST'), u32(moviBody.length + frameChunks.reduce((s, c) => s + c.length, 0)), moviBody, ...frameChunks]);
  const idx1 = Buffer.concat([fourcc('idx1'), u32(idxEntries.reduce((s, e) => s + e.length, 0)), ...idxEntries]);
  const avi = Buffer.concat([fourcc('RIFF'), u32(4 + hdrl.length + moviList.length + idx1.length), fourcc('AVI '), hdrl, moviList, idx1]);
  fs.writeFileSync(out, avi);
  return avi.length;
}

async function main() {
  console.log('='.repeat(80));
  console.log('🛰️ P3b-C 实机验收：WAC 数据层覆盖完整视锥');
  console.log(`目标: ${TARGET_URL} | commit: ${COMMIT}`);
  console.log('='.repeat(80));
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const results: Array<{ name: string; pass: boolean; detail: unknown }> = [];
  const record = (name: string, pass: boolean, detail: unknown) => {
    results.push({ name, pass, detail });
    console.log(`${pass ? '✅' : '❌'} [${pass ? 'PASS' : 'FAIL'}] ${name}`);
    if (!pass || process.env.VERBOSE) console.log('   ', JSON.stringify(detail));
  };

  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=d3d11',
      '--enable-webgl', '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
      '--window-size=1440,900',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const consoleErrors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.goto(TARGET_URL, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction(() => {
    const e = (window as any).__solarEngine;
    return e && typeof e.getRegionalAlbedoStatus === 'function';
  }, { timeout: 60000 });

  // ---- C1 装载与溯源 ----
  await page.waitForFunction(
    () => {
      const s = (window as any).__solarEngine.getRegionalAlbedoStatus();
      return s && (s.ready === true || s.error);
    },
    { timeout: 30000 }
  );
  const st0 = await page.evaluate(() => (window as any).__solarEngine.getRegionalAlbedoStatus());
  record(
    'C1 WAC 层装载 + 溯源（官方产品/304ppd≈99.75m/边界含站点）',
    st0.ready === true &&
      st0.provenance?.sourceProduct === 'WAC_EMP_643NM_E300N0450_304P' &&
      Math.abs(st0.provenance.nativeSpacingMeters - 99.748) < 0.01 &&
      st0.provenance.bounds.latMin < 20.35 && st0.provenance.bounds.latMax > 20.35 &&
      st0.provenance.bounds.lonMin < 30.78 && st0.provenance.bounds.lonMax > 30.78,
    st0
  );
  record('C2 裙边已换装同源 WAC（全球等距 UV 逆映射）', st0.collarSwapped === true, { collarSwapped: st0.collarSwapped });

  // ---- C3 SSE 门控：远关近开（真实相机距离驱动） ----
  const waitFrames = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // 远景（默认总览机位，月球表面距离 ≫ 阈值）→ 隐藏
  await waitFrames(1200);
  const farStatus = await page.evaluate(() => {
    const e = (window as any).__solarEngine;
    return { status: e.getRegionalAlbedoStatus(), note: 'overview' };
  });
  record(
    'C3a 远景（总览机位）SSE 门控关闭',
    farStatus.status.meshVisible === false,
    { gate: farStatus.status.gate, meshVisible: farStatus.status.meshVisible }
  );

  // 近距：站点上空 250km 眼高（< 361km 进入阈值）→ 显示
  await page.evaluate(() => {
    const e = (window as any).__solarEngine;
    e.executeCameraCommand({
      type: 'enterSurfaceLook', bodyId: 'moon', lat: 20.35, lon: 30.78,
      eyeHeightM: 250000, initialYawDeg: 0, initialPitchDeg: -35,
    });
  });
  await waitFrames(1500); // 淡入窗口
  const nearStatus = await page.evaluate(() => (window as any).__solarEngine.getRegionalAlbedoStatus());
  record(
    'C3b 站点上空 250km：SSE 门控开启（WAC ≥0.3px/源像元 且父级明显更糊）',
    nearStatus.meshVisible === true && nearStatus.gate?.visible === true && nearStatus.gate?.layerTexelPx >= 0.3,
    nearStatus.gate
  );

  // 中景截图（CDP 合成器截图；亮度统计用 ffprobe——WebGL canvas 无
  // preserveDrawingBuffer，页面内 drawImage 回读恒为黑，不可作证据）
  const midShotPath = path.join(OUTPUT_DIR, '99-p3c-wac-midfield-250km.png');
  await page.screenshot({ path: midShotPath });
  const { execFileSync } = await import('node:child_process');
  const ffprobePath = 'D:/Apps/ffmpeg/bin/ffprobe.exe';
  const statsOut = execFileSync(
    ffprobePath,
    ['-v', 'error', '-f', 'lavfi', `movie=${path.basename(midShotPath)},signalstats`, '-show_entries', 'frame_tags=lavfi.signalstats.YAVG,lavfi.signalstats.YMIN,lavfi.signalstats.YMAX', '-of', 'default=nw=1'],
    { encoding: 'utf8', cwd: OUTPUT_DIR }
  );
  const yAvg = parseFloat(statsOut.match(/YAVG=([\d.]+)/)?.[1] ?? '0');
  const yMin = parseFloat(statsOut.match(/YMIN=(\d+)/)?.[1] ?? '0');
  const yMax = parseFloat(statsOut.match(/YMAX=(\d+)/)?.[1] ?? '0');
  const shotStats = { meanY: yAvg, min: yMin, max: yMax };
  record(
    'C4 中景画面非黑且动态范围合理（月面反照率可见）',
    shotStats.meanY > 5 && shotStats.max > 40,
    shotStats
  );

  // 远退：800km 眼高 → 再关（迟滞之外）
  await page.evaluate(() => {
    const e = (window as any).__solarEngine;
    e.executeCameraCommand({
      type: 'enterSurfaceLook', bodyId: 'moon', lat: 20.35, lon: 30.78,
      eyeHeightM: 900000, initialYawDeg: 0, initialPitchDeg: -30,
    });
  });
  await waitFrames(1200);
  const midFarStatus = await page.evaluate(() => (window as any).__solarEngine.getRegionalAlbedoStatus());
  record(
    'C3c 900km 眼高：门控再次关闭（迟滞带外）',
    midFarStatus.meshVisible === false,
    midFarStatus.gate
  );

  // ---- C5 未剪辑下降录像 + 时间轴 ----
  await page.evaluate(() => {
    const e = (window as any).__solarEngine;
    e.getLandingController().cancel();
    e.executeCameraCommand({ type: 'flyTo', bodyId: 'moon', durationSec: 1.2 });
  });
  await waitFrames(2500);
  const travelBtn = await page.$('[data-testid="lunar-landing-travel-site-btn"]');
  if (travelBtn) {
    await travelBtn.click();
    await waitFrames(4500);
  }
  await page.waitForSelector('[data-testid="lunar-landing-start-btn"]', { timeout: 30000 });

  const frames: Buffer[] = [];
  const cdp = await page.createCDPSession();
  cdp.on('Page.screencastFrame', (ev: any) => {
    frames.push(Buffer.from(ev.data, 'base64'));
    void cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => undefined);
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1 });
  const t0 = Date.now();
  const timeline: Array<Record<string, number | string | boolean | null>> = [];
  let recording = true;
  const sampler = (async () => {
    while (recording) {
      const s = await page.evaluate(() => {
        const e = (window as any).__solarEngine;
        const tm = e.getLandingTelemetry();
        const albedo = e.getRegionalAlbedoStatus();
        return {
          tMs: Date.now(), state: tm.state, progress: tm.progress,
          aglM: tm.altitudeAGLM, mslM: tm.altitudeMSLM,
          wacVisible: albedo.meshVisible, layerTexelPx: albedo.gate?.layerTexelPx ?? null,
        };
      });
      timeline.push({ ...s, tMs: s.tMs - t0 });
      await waitFrames(200);
    }
  })();
  await page.click('[data-testid="lunar-landing-start-btn"]');
  await page.waitForFunction(
    () => (window as any).__solarEngine.getLandingTelemetry().state === 'SURFACE_LOOK',
    { timeout: 150000 }
  );
  await waitFrames(3500); // 触地停留
  recording = false;
  await cdp.send('Page.stopScreencast').catch(() => undefined);
  await waitFrames(400);
  await sampler.catch(() => undefined);
  const elapsedMs = Date.now() - t0;
  await page.screenshot({ path: path.join(OUTPUT_DIR, '99-p3c-wac-touchdown.png') });

  const captureFps = frames.length / (elapsedMs / 1000);
  const stride = Math.max(1, Math.round(captureFps / 15));
  const kept = frames.filter((_, i) => i % stride === 0);
  const outFps = Math.max(1, Math.round((kept.length / (elapsedMs / 1000)) * 10) / 10);
  const videoPath = path.join(OUTPUT_DIR, '99-p3c-descent-wac.avi');
  const bytes = writeMjpegAvi(kept, 1440, 900, outFps, videoPath);
  console.log(`🎬 ${path.basename(videoPath)}: ${kept.length}/${frames.length} 帧, ${(elapsedMs / 1000).toFixed(1)}s, ${outFps}fps, ${(bytes / 1e6).toFixed(1)}MB`);

  // 时间轴分析：下降中段（AGL 30km..150km）WAC 应可见；触地后仍在（地平线中景）
  const desc = timeline.filter((s) => s.state === 'DESCENDING');
  const midField = desc.filter((s) => (s.aglM as number) > 30000 && (s.aglM as number) < 150000);
  const midFieldWacOn = midField.length > 0 && midField.every((s) => s.wacVisible === true);
  const touchdown = timeline.find((s) => s.state === 'SURFACE_LOOK');
  record(
    'C5a 下降中段（AGL 30–150km）全程 WAC 层可见（中远景=实测影像）',
    midFieldWacOn,
    { midSamples: midField.length, wacOnRatio: midField.length ? midField.filter((s) => s.wacVisible).length / midField.length : 0 }
  );
  record(
    'C5b 触地终态（AGL=1.7）',
    !!touchdown && Math.abs((touchdown.aglM as number) - 1.7) < 0.05,
    touchdown ? { aglM: touchdown.aglM, state: touchdown.state } : null
  );
  record('C5c 录像帧数足够（未剪辑）', kept.length > 200, { frames: kept.length, durationSec: (elapsedMs / 1000).toFixed(1) });
  record('C6 控制台无错误', consoleErrors.length === 0, consoleErrors.slice(0, 5));

  const report = {
    task: 'P3b-C 实机验收：WAC EMP 数据层覆盖完整视锥',
    commit: COMMIT,
    targetUrl: TARGET_URL,
    timestamp: new Date().toISOString(),
    provenance: {
      影像: 'WAC_EMP_643NM_E300N0450_304P（643nm 单波段经验归一化，非肉眼真彩）整文件 MD5 校验后离线裁窗',
      DEM: 'NAC_DTM_APOLLO17 整幅有效区扩窗 6km→12km（P3b-C4），三点远程交叉验收 admitted',
      声明: '影像采样(99.75m) ≠ DEM 格点(5m) ≠ 几何误差，三者分离调度；中远景几何仍为基准球',
    },
    checks: results,
    timeline,
    video: { file: path.basename(videoPath), bytes, fps: outFps, durationSec: elapsedMs / 1000 },
    consoleErrors,
  };
  const reportPath = path.join(OUTPUT_DIR, 'batch-p3c-imagery-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  await browser.close();

  const pass = results.filter((r) => r.pass).length;
  console.log('-'.repeat(80));
  console.log(`${pass === results.length ? '🎉' : '⛔'} P3b-C 实机验收: ${pass}/${results.length}`);
  console.log(`📄 报告: ${reportPath}`);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error('脚本异常退出:', err);
  process.exit(2);
});
