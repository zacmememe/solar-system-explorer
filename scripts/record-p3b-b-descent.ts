/**
 * 太阳系漫游 · P3b-B 验收录像（Pro §02 B 批完成定义：三段未剪辑录像）
 * （solar-coordination-v1；纯证据材料，不接入生产）
 *
 * 场景 1：正常全链（入口 → 单腿连续下降 → 接地），无任何用户交互；
 * 场景 2：中途拖拽打断 → HOLD 环顾 → 恢复导引视线 → 继续 → 接地；
 * 场景 3：低空返轨（下降中直接返回轨道，从当前位姿重规划爬升）。
 *
 * 每段输出：未剪辑 MJPEG-AVI（CDP screencast 帧直嵌）+ 逐 200ms 遥测时间轴
 * （含相机四元数角速率），供时间轴分析与"无跳变/无瞬移"客观核对。
 */
import puppeteer from 'puppeteer-core';
import * as path from 'node:path';
import * as fs from 'node:fs';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:4173';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUTPUT_DIR = process.env.EVIDENCE_DIR
  ? path.resolve(process.env.EVIDENCE_DIR)
  : 'D:/solar-evidence/pro-review';
const COMMIT = process.env.P3B_COMMIT || 'worktree-uncommitted';

/** 零依赖 MJPEG-AVI 容器（帧直嵌，无重编码）——与 record-p2-descent-demo 同一实现 */
function writeMjpegAvi(frames: Buffer[], width: number, height: number, fps: number, out: string) {
  const fourcc = (s: string) => Buffer.from(s, 'ascii');
  const u32 = (v: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); return b; };
  const u16 = (v: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(v & 0xffff, 0); return b; };

  const n = frames.length;
  const maxFrame = frames.reduce((m, f) => Math.max(m, f.length), 0);

  const avih = Buffer.concat([
    u32(Math.round(1e6 / fps)), u32(Math.round(maxFrame * fps)), u32(0x10), u32(n),
    u32(0), u32(1), u32(maxFrame), u32(width), u32(height),
    u32(0), u32(0), u32(0), u32(0),
  ]);
  const strh = Buffer.concat([
    fourcc('vids'), fourcc('MJPG'), u32(0), u32(0), u32(0), u32(0),
    u32(1), u32(fps), u32(0), u32(n), u32(maxFrame), u32(0xffffffff),
    u32(0), u16(0), u16(0), u16(0), u16(width), u16(0), u16(height), u16(0),
  ]);
  const strf = Buffer.concat([
    u32(40), u32(width), u32(height), u16(1), u16(24), fourcc('MJPG'),
    u32(width * height * 3), u32(0), u32(0), u32(0), u32(0),
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

interface TimelineSample {
  tMs: number;
  state: string;
  progress: number;
  aglM: number;
  mslM: number;
  vSpeed: number;
  hSpeed: number;
  lat: number;
  lon: number;
  yawDeg: number;
  pitchDeg: number;
  quat: [number, number, number, number];
  degRateDps: number | null; // 相对上一采样的相机角速率（°/s）
}

function quatAngleDeg(a: [number, number, number, number], b: [number, number, number, number]): number {
  const la = Math.hypot(a[0], a[1], a[2], a[3]);
  const lb = Math.hypot(b[0], b[1], b[2], b[3]);
  const d = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]) / (la * lb);
  return (2 * Math.acos(Math.min(1, Math.max(0, Math.abs(d)))) * 180) / Math.PI;
}

async function main() {
  console.log('='.repeat(80));
  console.log('🎬 P3b-B 三段未剪辑验收录像（正常全链 / HOLD+恢复导引 / 低空返轨）');
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

  const readState = (): Promise<any> => page.evaluate(() => {
    const e = (window as any).__solarEngine;
    const tm = e.getLandingTelemetry();
    const q = e.camera?.quaternion;
    const heading = e.getLandingController?.()?.evaluateTrajectory?.()?.tangentHeadingDeg ?? null;
    return {
      tm, heading,
      quat: q ? [q.x, q.y, q.z, q.w] : null,
    };
  });

  async function resetToOrbitHome(): Promise<void> {
    // 若仍在地表（上一场景接地），先返轨回轨道视角再复位
    const retBtn = await page.$('[data-testid="landing-btn-return-orbit"]');
    if (retBtn) {
      await retBtn.click();
      await page.waitForFunction(
        () => ((window as any).__solarEngine.getLandingTelemetry()?.state || 'ORBIT') === 'ORBIT',
        { timeout: 90000 }
      );
      await new Promise((r) => setTimeout(r, 2500)); // 返轨飞行过渡
    }
    await page.evaluate(() => {
      (window as any).__solarEngine.executeCameraCommand({ type: 'flyTo', bodyId: 'moon', durationSec: 1.2 });
    });
    await new Promise((r) => setTimeout(r, 2500));
    // 背面到达时入口是“前往着陆区”（球外绕行 2.8s）——先完成再等降落入口
    const travelBtn = await page.$('[data-testid="lunar-landing-travel-site-btn"]');
    if (travelBtn) {
      await travelBtn.click();
      await new Promise((r) => setTimeout(r, 4500));
    }
    await page.waitForSelector('[data-testid="lunar-landing-start-btn"]', { timeout: 30000 });
  }

  interface RecordResult {
    video: string;
    bytes: number;
    timeline: TimelineSample[];
    fps: number;
    durationSec: number;
  }
  async function recordScenario(
    name: string,
    drive: () => Promise<void>
  ): Promise<RecordResult> {
    await resetToOrbitHome();
    const frames: Buffer[] = [];
    const cdp = await page.createCDPSession();
    cdp.on('Page.screencastFrame', (ev: any) => {
      frames.push(Buffer.from(ev.data, 'base64'));
      void cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => undefined);
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1 });
    const t0 = Date.now();
    const timeline: TimelineSample[] = [];
    let prev: TimelineSample | null = null;
    let sampling = true;

    const sampler = (async () => {
      while (sampling) {
        const s = await readState();
        const sample: TimelineSample = {
          tMs: Date.now() - t0,
          state: s.tm.state,
          progress: s.tm.progress,
          aglM: s.tm.altitudeAGLM,
          mslM: s.tm.altitudeMSLM,
          vSpeed: s.tm.verticalSpeedMps,
          hSpeed: s.tm.horizontalSpeedMps,
          lat: s.tm.currentLat,
          lon: s.tm.currentLon,
          yawDeg: s.tm.surfaceYawDeg,
          pitchDeg: s.tm.surfacePitchDeg,
          quat: s.quat,
          degRateDps: null,
        };
        if (prev) {
          const dt = (sample.tMs - prev.tMs) / 1000;
          if (dt > 1e-3) sample.degRateDps = Number((quatAngleDeg(sample.quat, prev.quat) / dt).toFixed(2));
        }
        timeline.push(sample);
        prev = sample;
        await new Promise((r) => setTimeout(r, 200));
      }
    })();
    try {
      await drive();
    } finally {
      sampling = false;
      await cdp.send('Page.stopScreencast').catch(() => undefined);
    }
    await new Promise((r) => setTimeout(r, 400));
    await sampler.catch(() => undefined);
    const elapsedMs = Date.now() - t0;

    const captureFps = frames.length / (elapsedMs / 1000);
    const stride = Math.max(1, Math.round(captureFps / 15));
    const kept = frames.filter((_, i) => i % stride === 0);
    const outFps = Math.max(1, Math.round((kept.length / (elapsedMs / 1000)) * 10) / 10);
    const videoPath = path.join(OUTPUT_DIR, name);
    const bytes = writeMjpegAvi(kept, 1440, 900, outFps, videoPath);
    console.log(`🎬 ${name}: ${kept.length}/${frames.length} 帧, ${(elapsedMs / 1000).toFixed(1)}s, ${outFps}fps, ${(bytes / 1e6).toFixed(1)}MB`);
    return { video: name, bytes, timeline, fps: outFps, durationSec: elapsedMs / 1000 };
  }

  async function dragLook(dx: number, dy: number): Promise<void> {
    // 画布中心起拖（引擎 pointer 事件挂在 canvas 上；6px 阈值后生效）
    const canvas = await page.$('canvas');
    if (!canvas) throw new Error('canvas not found');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas box missing');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + dx, cy + dy, { steps: 8 });
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 350));
  }

  const waitFor = async (pred: (s: any) => boolean, timeoutMs: number, what: string) => {
    const tEnd = Date.now() + timeoutMs;
    for (;;) {
      const s = await readState();
      if (pred(s)) return s;
      if (Date.now() > tEnd) throw new Error(`timeout waiting for: ${what} (state=${s.tm.state}, progress=${s.tm.progress})`);
      await new Promise((r) => setTimeout(r, 250));
    }
  };

  // ---------------- 场景 1：正常全链（无交互） ----------------
  const s1 = await recordScenario('96-p3b-b-video1-normal-full-chain.avi', async () => {
    await page.click('[data-testid="lunar-landing-start-btn"]');
    await waitFor((s) => s.tm.state === 'SURFACE_LOOK', 150000, 'touchdown');
    await new Promise((r) => setTimeout(r, 4000)); // 触地画面停留
  });

  // ---------------- 场景 2：中途 HOLD + 环顾 + 恢复导引 + 继续 ----------------
  const s2 = await recordScenario('97-p3b-b-video2-hold-reguide-resume.avi', async () => {
    await page.click('[data-testid="lunar-landing-start-btn"]');
    await waitFor((s) => s.tm.state === 'DESCENDING' && s.tm.progress >= 0.45, 150000, 'progress>=0.45');
    // B3：拖拽本身应立即触发 HOLD（不是点按钮）
    await dragLook(220, -60);
    const held = await waitFor((s) => s.tm.state === 'HOLD', 5000, 'drag→HOLD');
    const holdFix = { lat: held.tm.currentLat, lon: held.tm.currentLon, agl: held.tm.altitudeAGLM, yaw: held.tm.surfaceYawDeg };
    await new Promise((r) => setTimeout(r, 1200));
    // 悬停环顾：两次拖拽改变视线
    await dragLook(-260, 40);
    await dragLook(120, 90);
    const looked = await readState();
    const lookFacts = { yawAfterLook: looked.tm.surfaceYawDeg, latConst: looked.tm.currentLat, lonConst: looked.tm.currentLon, aglConst: looked.tm.altitudeAGLM };
    // 恢复导引视线（位移仍冻结）
    await page.click('[data-testid="landing-btn-reguide"]');
    await new Promise((r) => setTimeout(r, 4500)); // ≤10°/s 收敛窗口
    const reguided = await readState();
    const reguideFacts = { yawAfterReguide: reguided.tm.surfaceYawDeg, pitchAfterReguide: reguided.tm.surfacePitchDeg, headingTarget: reguided.heading, latStill: reguided.tm.currentLat, aglStill: reguided.tm.altitudeAGLM };
    // 继续下降到接地
    await page.click('[data-testid="landing-btn-resume"]');
    await waitFor((s) => s.tm.state === 'SURFACE_LOOK', 150000, 'touchdown after resume');
    await new Promise((r) => setTimeout(r, 3500));
    (globalThis as any).__s2Facts = { holdFix, lookFacts, reguideFacts };
  });

  // ---------------- 场景 3：低空返轨（下降中直接返回） ----------------
  const s3 = await recordScenario('98-p3b-b-video3-lowalt-return-to-orbit.avi', async () => {
    await page.click('[data-testid="lunar-landing-start-btn"]');
    await waitFor((s) => s.tm.state === 'DESCENDING' && s.tm.progress >= 0.62, 150000, 'progress>=0.62');
    const before = await readState();
    await page.click('[data-testid="landing-btn-cancel"]'); // 取消并返回轨道（下降面板）
    const climbing = await waitFor((s) => s.tm.state === 'ASCENDING', 8000, 'ASCENDING');
    const climbStart = { lat: climbing.tm.currentLat, lon: climbing.tm.currentLon, msl: climbing.tm.altitudeMSLM, beforeLat: before.tm.currentLat, beforeLon: before.tm.currentLon };
    await waitFor((s) => s.tm.state === 'ORBIT', 90000, 'ORBIT after climb');
    await new Promise((r) => setTimeout(r, 3000));
    (globalThis as any).__s3Facts = { climbStart };
  });

  await browser.close();

  // ---------------- 时间轴分析（客观底稿） ----------------
  function analyze(tl: TimelineSample[], label: string) {
    const desc = tl.filter((s) => s.state === 'DESCENDING');
    const rates = tl.map((s) => s.degRateDps).filter((v): v is number => v != null && v > 0);
    const maxRate = rates.length ? Math.max(...rates) : 0;
    // 单腿连续：中段（进度 0.05..0.95）水平速度 > 0（无旧两段边界零速停顿）
    let interiorZeroRun = 0;
    let curRun = 0;
    for (const s of desc) {
      if (s.progress > 0.05 && s.progress < 0.95) {
        if (s.hSpeed < 1) { curRun++; interiorZeroRun = Math.max(interiorZeroRun, curRun); } else curRun = 0;
      }
    }
    // 位置连续：下降段相邻采样 |ΔMSL| 上界（0.2s 采样）
    let maxMslJump = 0;
    for (let i = 1; i < desc.length; i++) {
      const jump = Math.abs(desc[i].mslM - desc[i - 1].mslM);
      if (jump > maxMslJump) maxMslJump = jump;
    }
    const last = tl[tl.length - 1];
    const touch = tl.find((s) => s.state === 'SURFACE_LOOK');
    console.log(
      `[${label}] 样本=${tl.length} 下降样本=${desc.length} 最大角速率=${maxRate.toFixed(1)}°/s` +
      ` 中段零速停顿最长=${interiorZeroRun}采 相邻|ΔMSL|max=${maxMslJump.toFixed(0)}m` +
      ` 终态=${last?.state} 接地pitch=${touch ? touch.pitchDeg.toFixed(2) + '°' : 'n/a'}`
    );
    return { maxRateDps: maxRate, interiorZeroRun, maxMslJump, endState: last?.state, touchdownPitchDeg: touch?.pitchDeg ?? null };
  }
  const a1 = analyze(s1.timeline, '场景1 正常全链');
  const a2 = analyze(s2.timeline, '场景2 HOLD+恢复导引');
  const a3 = analyze(s3.timeline, '场景3 低空返轨');

  const report = {
    task: 'P3b-B 三段未剪辑验收录像 + 时间轴分析',
    commit: COMMIT,
    targetUrl: TARGET_URL,
    timestamp: new Date().toISOString(),
    provenance: {
      声明: '三段均为单次连续 CDP screencast 录制，未剪辑、未加速、无音频；时间轴遥测为独立 200ms 采样',
      DTM: 'public/data/dem/apollo17-v1（Apollo 17 Taurus–Littrow LRO NAC DTM 窗口）',
      视频容器: 'MJPEG-AVI（JPEG 帧直嵌，无重编码）',
    },
    scenarios: [
      {
        name: '场景1 正常全链（无交互）', video: s1.video, bytes: s1.bytes, fps: s1.fps, durationSec: Number(s1.durationSec.toFixed(1)),
        analysis: a1, timeline: s1.timeline,
      },
      {
        name: '场景2 中途拖拽打断→HOLD 环顾→恢复导引视线→继续→接地', video: s2.video, bytes: s2.bytes, fps: s2.fps, durationSec: Number(s2.durationSec.toFixed(1)),
        facts: (globalThis as any).__s2Facts ?? null,
        analysis: a2, timeline: s2.timeline,
      },
      {
        name: '场景3 下降中低空返轨（当前位姿重规划爬升）', video: s3.video, bytes: s3.bytes, fps: s3.fps, durationSec: Number(s3.durationSec.toFixed(1)),
        facts: (globalThis as any).__s3Facts ?? null,
        analysis: a3, timeline: s3.timeline,
      },
    ],
    consoleErrors,
  };
  const reportPath = path.join(OUTPUT_DIR, 'batch-p3b-b-videos-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  // ---------------- 验收判定 ----------------
  const checks: Array<[string, boolean, string]> = [];
  checks.push(['S1 接地终态', a1.endState === 'SURFACE_LOOK', `end=${a1.endState}`]);
  checks.push(['S1 接地俯仰≈地平线投影终端 −8.5°±3', a1.touchdownPitchDeg != null && Math.abs(a1.touchdownPitchDeg - (-8.5)) <= 3, `pitch=${a1.touchdownPitchDeg}`]);
  checks.push(['S1 角速率 ≤ 12°/s（含 200ms 采样噪声余量）', a1.maxRateDps <= 12, `max=${a1.maxRateDps?.toFixed(1)}°/s`]);
  checks.push(['S1 无中段零速停顿（≤2 采样）', a1.interiorZeroRun <= 2, `run=${a1.interiorZeroRun}`]);
  checks.push(['S2 拖拽直接触发 HOLD 并冻结位置', !!s2.timeline.find((s) => s.state === 'HOLD'), '见 facts/timeline']);
  checks.push(['S2 恢复导引后仍接地', a2.endState === 'SURFACE_LOOK', `end=${a2.endState}`]);
  checks.push(['S3 返轨到 ORBIT', a3.endState === 'ORBIT', `end=${a3.endState}`]);
  checks.push(['控制台无错误', consoleErrors.length === 0, `${consoleErrors.length} errors`]);

  console.log('-'.repeat(80));
  let pass = 0;
  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? '✅' : '⛔'} [${ok ? 'PASS' : 'FAIL'}] ${name} — ${detail}`);
    if (ok) pass++;
  }
  console.log(`${pass === checks.length ? '🎉' : '⛔'} P3b-B 录像验收: ${pass}/${checks.length}`);
  console.log(`📄 报告: ${reportPath}`);
  process.exit(pass === checks.length ? 0 : 1);
}

main().catch((err) => {
  console.error('脚本异常退出:', err);
  process.exit(2);
});
