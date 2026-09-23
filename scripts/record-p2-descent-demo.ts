/**
 * 太阳系漫游 · D-P2-EVIDENCE 缺口 3【代表录像 + 运行时状态指纹】
 * （solar-coordination-v1；纯证据材料，不接入生产）
 *
 * 真实 UI 路径录制完整下降闭环：启动 → 25% 暂停环顾 → 恢复 → 50% 暂停 → 恢复
 * → 75% 暂停 → 恢复 → 触地 → 返轨。帧来自 CDP screencast（JPEG），容器为零依赖
 * MJPEG-AVI（帧不重编码，VLC/常见播放器可放；无音频）。
 * 同时输出运行时状态指纹 JSON（模拟时刻/准入/网格统计/帧率/里程碑遥测）。
 */
import puppeteer from 'puppeteer-core';
import * as path from 'node:path';
import * as fs from 'node:fs';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:4173';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUTPUT_DIR = (process.env.EVIDENCE_DIR ? path.resolve(process.env.EVIDENCE_DIR) : 'D:/solar-evidence/pro-review');
const COMMIT = process.env.P2_COMMIT || 'worktree-uncommitted';
const AVI_PATH = path.join(OUTPUT_DIR, '86-p2-descent-demo-mjpeg.avi');
const FINGERPRINT_PATH = path.join(OUTPUT_DIR, 'batch-p2-descent-demo-fingerprint.json');

/** 零依赖 MJPEG-AVI 容器（帧直嵌，无重编码） */
function writeMjpegAvi(frames: Buffer[], width: number, height: number, fps: number, out: string) {
  const fourcc = (s: string) => Buffer.from(s, 'ascii');
  const u32 = (v: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); return b; };
  const u16 = (v: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(v & 0xffff, 0); return b; };
  const chunk = (id: string, data: Buffer) => Buffer.concat([fourcc(id), u32(data.length), data, data.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)]);

  const n = frames.length;
  const maxFrame = frames.reduce((m, f) => Math.max(m, f.length), 0);

  // avih (MainAVIHeader, 56B after cc+size)
  const avih = Buffer.concat([
    u32(Math.round(1e6 / fps)), u32(Math.round((maxFrame * fps) / 1)), u32(0x10), u32(n),
    u32(0), u32(1), u32(maxFrame), u32(width), u32(height),
    u32(0), u32(0), u32(0), u32(0),
  ]);
  // strh (AVIStreamHeader, 56B)
  const strh = Buffer.concat([
    fourcc('vids'), fourcc('MJPG'), u32(0), u32(0), u32(0), u32(0),
    u32(1), u32(fps), u32(0), u32(n), u32(maxFrame), u32(0xffffffff),
    u32(0), u16(0), u16(0), u16(0), u16(width), u16(0), u16(height), u16(0),
  ]);
  // strf (BITMAPINFOHEADER, 40B)
  const strf = Buffer.concat([
    u32(40), u32(width), u32(height), u16(1), u16(24), fourcc('MJPG'),
    u32(width * height * 3), u32(0), u32(0), u32(0), u32(0),
  ]);
  const strhChunk = Buffer.concat([fourcc('strh'), u32(strh.length), strh]);
  const strfChunk = Buffer.concat([fourcc('strf'), u32(strf.length), strf]);
  const strlList = Buffer.concat([
    fourcc('LIST'), u32(4 + strhChunk.length + strfChunk.length), fourcc('strl'), strhChunk, strfChunk,
  ]);
  const hdrl = Buffer.concat([
    fourcc('LIST'), u32(4 + avih.length + 4 + strlList.length), fourcc('hdrl'),
    fourcc('avih'), u32(avih.length), avih, strlList,
  ]);

  const frameChunks: Buffer[] = [];
  const idxEntries: Buffer[] = [];
  let moviBody = fourcc('movi');
  let offset = 4; // 相对 'movi' fourcc 起点
  for (const f of frames) {
    const ec = Buffer.concat([fourcc('00dc'), u32(f.length), f, f.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)]);
    frameChunks.push(ec);
    idxEntries.push(Buffer.concat([fourcc('00dc'), u32(0x10), u32(offset), u32(f.length)]));
    offset += ec.length;
  }
  const moviList = Buffer.concat([
    fourcc('LIST'), u32(moviBody.length + frameChunks.reduce((s, c) => s + c.length, 0)),
    moviBody, ...frameChunks,
  ]);
  const idx1 = Buffer.concat([fourcc('idx1'), u32(idxEntries.reduce((s, e) => s + e.length, 0)), ...idxEntries]);

  const avi = Buffer.concat([fourcc('RIFF'), u32(4 + hdrl.length + moviList.length + idx1.length), fourcc('AVI '), hdrl, moviList, idx1]);
  fs.writeFileSync(out, avi);
  return avi.length;
}

async function main() {
  console.log('='.repeat(80));
  console.log('🎬 D-P2-EVIDENCE 缺口 3 · 代表录像（真实 UI 下降闭环）+ 运行时状态指纹');
  console.log(`目标: ${TARGET_URL} | commit: ${COMMIT}`);
  console.log('='.repeat(80));
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

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
    return e && typeof e.getLandingTelemetry === 'function' && e.getLunarValleyMesh?.()?.visible === true;
  }, { timeout: 60000 });
  await page.evaluate(() => {
    (window as any).__solarEngine.executeCameraCommand({ type: 'flyTo', bodyId: 'moon', durationSec: 1.2 });
  });
  await page.waitForSelector('[data-testid="lunar-landing-start-btn"]', { timeout: 30000 });

  const readTelemetry = (): Promise<any> => page.evaluate(() => (window as any).__solarEngine.getLandingTelemetry());

  // ---- 录制开始（CDP Page.startScreencast，进程内收帧，不依赖 ffmpeg） ----
  const frames: Buffer[] = [];
  const cdp = await page.createCDPSession();
  let frameSeq = 0;
  cdp.on('Page.screencastFrame', (ev: any) => {
    frames.push(Buffer.from(ev.data, 'base64'));
    frameSeq = ev.metadata?.timestamp ?? frameSeq;
    void cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => undefined);
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg', quality: 80, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1,
  });
  const t0 = Date.now();

  await page.click('[data-testid="lunar-landing-start-btn"]');
  const milestones: Array<Record<string, unknown>> = [];
  const phases = [0.25, 0.5, 0.75];
  let phaseIdx = 0;
  let touchdown: any = null;
  while (Date.now() - t0 < 180000) {
    const tm = await readTelemetry();
    if (tm.state === 'DESCENDING' && phaseIdx < phases.length && tm.progress >= phases[phaseIdx]) {
      await page.click('[data-testid="landing-btn-hold"]');
      await new Promise((r) => setTimeout(r, 2400)); // 悬停环顾窗口（录像可看）
      const held = await readTelemetry();
      milestones.push({ event: `hold@${phases[phaseIdx]}`, progress: held.progress, aglM: held.altitudeAGLM, mslM: held.altitudeMSLM });
      await page.click('[data-testid="landing-btn-resume"]');
      phaseIdx++;
    }
    if (tm.state === 'SURFACE_LOOK') { touchdown = tm; milestones.push({ event: 'touchdown', aglM: tm.altitudeAGLM, mslM: tm.altitudeMSLM, terrain: tm.terrain }); break; }
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 3000)); // 触地画面停留
  const returnBtn = await page.$('[data-testid="landing-btn-return-orbit"]');
  if (returnBtn) {
    await returnBtn.click();
    await page.waitForFunction(
      () => ((window as any).__solarEngine.getLandingTelemetry()?.state || 'ORBIT') === 'ORBIT',
      { timeout: 90000 }
    );
    milestones.push({ event: 'returned-to-orbit' });
  }
  const elapsedMs = Date.now() - t0;
  await cdp.send('Page.stopScreencast').catch(() => undefined);
  await new Promise((r) => setTimeout(r, 500));

  // CDP 以显示帧率推帧（~97fps）——按目标 15fps 等距抽帧，避免数百 MB 的无用体积
  const captureFps = frames.length / (elapsedMs / 1000);
  const stride = Math.max(1, Math.round(captureFps / 15));
  const kept = frames.filter((_, i) => i % stride === 0);
  const outFps = Math.max(1, Math.round((kept.length / (elapsedMs / 1000)) * 10) / 10);

  // ---- 运行时状态指纹 ----
  const fingerprintPage = await page.evaluate(() => {
    const e = (window as any).__solarEngine;
    const mesh = e.getLunarValleyMesh?.();
    const frames = e.getRenderFrameCount?.();
    return {
      cameraMode: e.getCameraSnapshot?.()?.mode,
      landingState: e.getLandingTelemetry?.()?.state,
      mesh: mesh ? { visible: mesh.visible, vertices: mesh.geometry.getAttribute('position')?.count ?? 0 } : null,
      renderFrameCount: typeof frames === 'number' ? frames : null,
    };
  });
  await browser.close();

  const size = writeMjpegAvi(kept, 1440, 900, outFps, AVI_PATH);
  const fingerprint = {
    task: 'D-P2-EVIDENCE gap3 demo recording',
    commit: COMMIT,
    targetUrl: TARGET_URL,
    timestamp: new Date().toISOString(),
    milestones,
    touchdownState: touchdown ? { state: touchdown.state, aglM: touchdown.altitudeAGLM, mslM: touchdown.altitudeMSLM, terrain: touchdown.terrain } : null,
    runtime: fingerprintPage,
    recording: {
      file: path.basename(AVI_PATH), container: 'MJPEG-AVI (无重编码, 无音频)',
      capturedFrames: frames.length, keptFrames: kept.length, stride,
      captureFps: Number(captureFps.toFixed(1)), outputFps: outFps,
      durationSec: Number((elapsedMs / 1000).toFixed(1)), bytes: size,
    },
    consoleErrors,
  };
  fs.writeFileSync(FINGERPRINT_PATH, JSON.stringify(fingerprint, null, 2));
  console.log(`🎬 录像: ${AVI_PATH} (${kept.length}/${frames.length} 帧, ${(elapsedMs / 1000).toFixed(1)}s, ${outFps}fps, ${(size / 1e6).toFixed(1)}MB)`);
  console.log(`📄 指纹: ${FINGERPRINT_PATH}`);
  console.log(`里程碑: ${JSON.stringify(milestones)}`);
  console.log(`控制台错误: ${consoleErrors.length}`);
  const ok = kept.length > 50 && milestones.some((m) => m.event === 'touchdown') && consoleErrors.length === 0;
  console.log(`${ok ? '🎉' : '⛔'} 缺口 3 录像结果: ${ok ? 'OK' : 'FAILED'}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('脚本异常退出:', err);
  process.exit(2);
});
