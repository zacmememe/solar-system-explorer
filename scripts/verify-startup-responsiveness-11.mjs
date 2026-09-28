// F-STARTUP-RESPONSIVENESS-11 · G0 基线测量（第18轮）
// 冷启动/首次切星/首次准备/取消/热复访时序 + 主线程 longtask + CPU 采样 profile。
// 采样自应用代码之前开始（evaluateOnNewDocument）；输入→命令生效→下一帧分解。
// 口径：每轮全新 browser 进程+独立 profile = 冷 HTTP（OS/驱动/GPU 缓存未清，如实）。
// 视觉结论不产出（工程数值与原图 only）。
// EVIDENCE_DIR 默认 D:/solar-evidence/F-STARTUP-RESPONSIVENESS-11/<run-id>
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { preview } from 'vite';
import puppeteer from 'puppeteer-core';

const OUT = process.env.EVIDENCE_DIR
  || `D:/solar-evidence/F-STARTUP-RESPONSIVENESS-11/baseline-${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 17)}`;
const ROUNDS = Number(process.env.ROUNDS || 3);
const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const report = {
  out: OUT,
  rounds: ROUNDS,
  note: '每轮=全新浏览器进程+独立 userDataDir（冷HTTP）。OS/驱动/GPU缓存未清。rAF间隔含GPU/调度；longtask=主线程证据；CPU profile为采样口径。',
  indexSha256: null,
  machine: null,
  cases: [],
  errors: [],
};

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  report.indexSha256 = sha(await fs.readFile('dist/index.html'));

  const server = await preview({ preview: { host: '127.0.0.1', port: 0, open: false } });
  const url = server.resolvedUrls.local[0];
  report.previewUrl = url;
  let browser = null;

  try {
    for (let round = 1; round <= ROUNDS; round++) {
      browser = await puppeteer.launch({
        executablePath: EDGE,
        headless: true,
        userDataDir: path.join(OUT, `profile-r${round}`),
        defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
        args: ['--use-gl=angle', '--use-angle=d3d11'],
        protocolTimeout: 240000,
      });
      if (!report.machine) {
        report.browser = await browser.version();
        report.machine = await browser.evaluateOnNewDocument ? null : null;
      }
      const page = await browser.newPage();
      page.on('pageerror', (e) => report.errors.push(`r${round}: ${String(e).slice(0, 160)}`));
      page.on('console', (m) => { if (m.type() === 'error') report.errors.push(`r${round} console: ${m.text().slice(0, 160)}`); });

      await page.evaluateOnNewDocument(() => {
        const log = (window.__z11 = {
          rafs: [], longtasks: [], resources: [], events: [], marks: {}, stateChanges: [],
        });
        const tick = (t) => { log.rafs.push(t); requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        try {
          new PerformanceObserver((l) => { for (const e of l.getEntries()) log.longtasks.push({ start: e.startTime, duration: e.duration, name: e.name, container: e.attribution?.[0]?.containerName ?? null }); })
            .observe({ type: 'longtask', buffered: true });
          new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (e.name === 'first-paint' || e.name === 'first-contentful-paint') log.marks[e.name] = e.startTime; } })
            .observe({ type: 'paint', buffered: true });
          new PerformanceObserver((l) => { for (const e of l.getEntries()) log.resources.push({ name: e.name, start: e.startTime, end: e.responseEnd, bytes: e.transferSize }); })
            .observe({ type: 'resource', buffered: true });
        } catch { /* longtask 不支持时保留其余 */ }
        for (const type of ['click', 'change']) {
          document.addEventListener(type, (e) => {
            log.events.push({
              type, start: performance.now(),
              id: e.target?.closest?.('[data-testid]')?.dataset?.testid ?? null,
              value: e.target?.value ?? undefined,
            });
          }, true);
        }
        // 引擎实例创建时刻（属性赋值拦截）
        let engineSeen = false;
        Object.defineProperty(window, '__solarEngine', {
          configurable: true,
          get() { return engineSeen ? window.__z11engine : undefined; },
          set(v) { window.__z11engine = v; if (!engineSeen) { engineSeen = true; log.marks.engineCreated = performance.now(); } },
        });
        // HUD 可操作 / 默认站 built / 状态变化（100ms 轮询 + DOM 观察）
        const seen = {};
        setInterval(() => {
          const e = window.__z11engine;
          if (!e) return;
          if (!seen.hud && document.querySelector('[data-testid="toolbar-hangar-btn"]')) {
            seen.hud = 1; log.marks.hudInteractive = performance.now();
          }
          try {
            const st = e.moonSiteStacks?.get('taurus-littrow');
            if (!seen.built && st?.built) { seen.built = 1; log.marks.defaultSiteBuilt = performance.now(); }
          } catch { /* 栈未初始化 */ }
          try {
            const tag = document.querySelector('[data-testid="landing-state-tag"]');
            const s = tag?.dataset?.state;
            if (s && s !== seen.state) { seen.state = s; log.stateChanges.push({ state: s, t: performance.now() }); }
          } catch { /* HUD 未挂 */ }
        }, 100);
      });

      // CPU 采样（应用启动全程：goto 前开，startup 段结束后停）
      const cdp = await page.createCDPSession();
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 1000 }); // 1ms 采样
      await cdp.send('Profiler.start');

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await page.waitForFunction(() => window.__z11engine?.moonSiteStacks?.get('taurus-littrow')?.built, { timeout: 120000, polling: 200 });
      await delay(3000);

      const startup = await collect(page, 0, performance.now());
      startup.round = round;
      startup.name = 'startup-cold';
      report.cases.push(startup);
      console.log(`r${round} startup: firstPaint=${startup.firstPaint?.toFixed(0)}ms firstRAF=${startup.firstRAF?.toFixed(0)}ms engine=${startup.marks?.engineCreated?.toFixed(0)}ms hud=${startup.marks?.hudInteractive?.toFixed(0)}ms built=${startup.marks?.defaultSiteBuilt?.toFixed(0)}ms maxGap=${startup.maxRafGap?.toFixed(0)}ms longestTask=${startup.longestTaskMs?.toFixed(0)}ms`);

      const { profile } = await cdp.send('Profiler.stop');
      await fs.writeFile(path.join(OUT, `cpu-r${round}.cpuprofile`), JSON.stringify(profile));

      // 首次切星 earth（当前默认是 moon？默认启动=地球视角；点 moon 前先确认当前 target）
      const target0 = await page.evaluate(() => window.__z11engine.getCameraSnapshot().targetBodyId);
      const switchTarget = target0 === 'moon' ? 'earth' : 'moon';
      await delay(1000);
      await timedAction(page, `first-switch-${switchTarget}`, async () => {
        await page.click(`[data-testid="${switchTarget === 'moon' ? 'moon' : 'planet'}-btn-${switchTarget}"]`);
        await page.waitForFunction((id) => {
          const c = window.__z11engine.getCameraSnapshot();
          return c.targetBodyId === id && !c.isTransitioning;
        }, { timeout: 90000, polling: 100 }, switchTarget);
      });

      // 首次准备落区（完整用户路径：选静海→[背面需前往]→开始→PREPARING→DESCENDING）
      await page.waitForSelector('[data-testid="landing-site-select"]', { timeout: 30000 });
      if (switchTarget !== 'moon') {
        await page.click('[data-testid="moon-btn-moon"]');
        await page.waitForFunction(() => {
          const c = window.__z11engine.getCameraSnapshot();
          return c.targetBodyId === 'moon' && !c.isTransitioning;
        }, { timeout: 90000, polling: 100 });
      }
      await timedAction(page, 'first-prepare-tranquility', async () => {
        await page.select('[data-testid="landing-site-select"]', 'tranquility-base');
        await page.waitForFunction(() => {
          const a = window.__z11engine.getLandingAvailability();
          return a.action === 'land' || a.action === 'travel-to-site';
        }, { timeout: 120000, polling: 200 });
        const act = await page.evaluate(() => window.__z11engine.getLandingAvailability().action);
        if (act === 'travel-to-site') {
          await page.click('[data-testid="lunar-landing-travel-site-btn"]');
          await page.waitForFunction(() => window.__z11engine.getLandingAvailability().action === 'land', { timeout: 180000, polling: 200 });
        }
        await page.click('[data-testid="lunar-landing-start-btn"]');
        await page.waitForFunction(() => window.__z11engine.getLandingTelemetry().state === 'DESCENDING', { timeout: 120000, polling: 100 });
      });
      // 立即取消下降（避免触地长流程），回 ORBIT
      await timedAction(page, 'cancel-descent-return-orbit', async () => {
        await page.click('[data-testid="landing-btn-cancel"]');
        await page.waitForFunction(() => {
          const c = window.__z11engine.getCameraSnapshot();
          return c.mode === 'ORBIT_TARGET' && !c.isTransitioning;
        }, { timeout: 180000, polling: 200 });
      });

      // 热复访：hadley → taurus（同页、已温缓存）
      await page.waitForSelector('[data-testid="landing-site-select"]', { timeout: 30000 });
      await timedAction(page, 'hot-visit-hadley', async () => {
        await page.select('[data-testid="landing-site-select"]', 'hadley-rille');
        await page.waitForFunction(() => window.__z11engine.moonSiteStacks.get('hadley-rille')?.built, { timeout: 120000, polling: 200 });
        await delay(1000);
      });
      await timedAction(page, 'hot-revisit-taurus', async () => {
        await page.select('[data-testid="landing-site-select"]', 'taurus-littrow');
        await delay(1000);
      });

      await page.screenshot({ path: path.join(OUT, `final-r${round}.png`) });
      const raw = await page.evaluate(() => ({ marks: window.__z11.marks, stateChanges: window.__z11.stateChanges, events: window.__z11.events }));
      await fs.writeFile(path.join(OUT, `raw-r${round}.json`), JSON.stringify(raw, null, 1));
      await browser.close();
      browser = null;
    }
    report.result = report.errors.length ? 'PASS_WITH_ERRORS_LOGGED' : 'PASS';
    if (report.errors.length) report.result = 'COLLECTED_WITH_PAGE_ERRORS';
  } catch (e) {
    report.result = 'FAIL';
    report.failure = String(e.stack || e);
    process.exitCode = 1;
  } finally {
    await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
    if (browser) await browser.close().catch(() => {});
    await new Promise((r) => server.httpServer.close(r));
  }
  console.log(JSON.stringify({ result: report.result, out: OUT, errors: report.errors.slice(0, 5) }));

  async function collect(page, start, end) {
    const data = await page.evaluate(({ start, end }) => {
      const l = window.__z11;
      const rafs = l.rafs;
      const inRange = rafs.filter((t) => t >= start && t <= end);
      const gaps = [];
      for (let i = 1; i < rafs.length; i++) {
        if (rafs[i] >= start && rafs[i - 1] <= end) gaps.push(rafs[i] - rafs[i - 1]);
      }
      gaps.sort((a, b) => a - b);
      const lt = l.longtasks.filter((t) => t.start + t.duration >= start && t.start <= end);
      const res = l.resources.filter((r) => r.end >= start && r.start <= end);
      const dem = res.filter((r) => /dem|ortho|lola|mola/.test(r.name));
      return {
        firstPaint: l.marks['first-paint'] ?? null,
        firstFCP: l.marks['first-contentful-paint'] ?? null,
        firstRAF: rafs[0] ?? null,
        marks: l.marks,
        rafCount: inRange.length,
        p95Gap: gaps[Math.floor(gaps.length * 0.95)] ?? null,
        maxRafGap: gaps.length ? gaps[gaps.length - 1] : null,
        over50Gaps: gaps.filter((g) => g > 50).length,
        over200Gaps: gaps.filter((g) => g > 200).length,
        longtasks: lt.map((t) => ({ start: Math.round(t.start), duration: Math.round(t.duration), container: t.container })),
        longestTaskMs: lt.length ? Math.max(...lt.map((t) => t.duration)) : 0,
        totalTaskMs: lt.reduce((a, t) => a + t.duration, 0),
        resources: {
          count: res.length,
          bytes: res.reduce((a, r) => a + (r.bytes || 0), 0),
          demCount: dem.length,
          demBytes: dem.reduce((a, r) => a + (r.bytes || 0), 0),
          demEndMs: dem.length ? Math.max(...dem.map((r) => r.end)) : null,
          jsCount: res.filter((r) => /\.js/.test(r.name)).length,
          jsBytes: res.filter((r) => /\.js/.test(r.name)).reduce((a, r) => a + (r.bytes || 0), 0),
        },
        renderer: window.__z11engine?.renderer ? {
          memory: window.__z11engine.renderer.info.memory,
          programs: window.__z11engine.renderer.info.programs.length,
        } : null,
      };
    }, { start, end });
    return data;
  }

  async function timedAction(page, name, fn) {
    const start = await page.evaluate(() => performance.now());
    await fn();
    await delay(150);
    const end = await page.evaluate(() => performance.now());
    const data = await collect(page, start, end);
    data.name = name;
    data.start = start; data.durationMs = end - start;
    // 输入分解：事件到达 → 期间状态变化 → 结束后首个 rAF
    const decomp = await page.evaluate(({ start, end }) => {
      const l = window.__z11;
      const ev = l.events.filter((e) => e.start >= start && e.start <= end).slice(0, 6);
      const sc = l.stateChanges.filter((s) => s.t >= start && s.t <= end).slice(0, 8);
      const nextRaf = l.rafs.find((t) => t >= end) ?? null;
      return { events: ev, stateChanges: sc, firstRafAfterEnd: nextRaf };
    }, { start, end });
    data.input = decomp;
    report.cases.push(data);
    console.log(`${name}: ${(end - start).toFixed(0)}ms maxGap=${data.maxRafGap?.toFixed(0)}ms longest=${data.longestTaskMs?.toFixed(0)}ms tasks=${data.longtasks.length}`);
  }
}

main().catch((e) => { console.error('RUNNER FAILED:', e); process.exit(1); });
