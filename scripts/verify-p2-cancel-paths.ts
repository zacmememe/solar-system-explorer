/**
 * 太阳系漫游 · D-P2-EVIDENCE 缺口 2【真实 UI 失败/取消路径】独立证据脚本
 * 不接入生产、不动共享 runner；仅新增验证材料（solar-coordination-v1，base 6ade791…）。
 *
 * 覆盖：
 *   CP-1 数据装载停滞（请求挂起）时：真实 UI 点击「降落」→ PREPARING 不放行、
 *        网格不伪造、点「取消准备」回到 ORBIT；
 *   CP-2 数据 404 时：fail-closed（引擎诚实记录装载失败、网格保持隐藏、
 *        PREPARING 门槛不放行、可取消、无未处理 Promise 拒绝）；
 *   CP-3 干净重载回归：拦截解除后正常装载（防证据脚本误伤 happy path 的保险）。
 *
 * 诚实性约定：
 *   - 预期内错误（[SolarEngine] DTM 装载失败 / DEM 404 资源错误）单独归类，不算失败；
 *   - 其余控制台错误 / pageerror 任一出现 → FAIL；
 *   - 任一断言失败 → 非零退出，报告写 artifacts/pro-review/batch-p2-cancel-paths-report.json。
 */
import puppeteer from 'puppeteer-core';
import * as path from 'node:path';
import * as fs from 'node:fs';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:4173';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUTPUT_DIR = (process.env.EVIDENCE_DIR ? path.resolve(process.env.EVIDENCE_DIR) : 'D:/solar-evidence/pro-review');
const DEM_URL_HINT = '/data/dem/apollo17-v1/';
const COMMIT = process.env.P2_COMMIT || 'worktree-uncommitted';

interface CheckResult {
  name: string;
  pass: boolean;
  detail: Record<string, unknown>;
}
const checks: CheckResult[] = [];
function record(name: string, pass: boolean, detail: Record<string, unknown>) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} [${pass ? 'PASS' : 'FAIL'}] ${name}`);
  console.log(`   ${JSON.stringify(detail)}`);
}

type Req = puppeteer.HTTPRequest;

async function main() {
  console.log('='.repeat(80));
  console.log('🛰️ D-P2-EVIDENCE 缺口 2 · 真实 UI 失败/取消路径证据（PREPARING 取消 / 404 fail-closed）');
  console.log(`目标 URL: ${TARGET_URL} | commit: ${COMMIT}`);
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

  const saveShot = async (page: puppeteer.Page, f: string) => {
    await page.screenshot({ path: path.join(OUTPUT_DIR, f) });
    console.log(`📸 截图: ${f}`);
  };
  const waitEngine = async (page: puppeteer.Page) => {
    await page.waitForFunction(() => {
      const e = (window as any).__solarEngine;
      return e && typeof e.getLandingTelemetry === 'function';
    }, { timeout: 60000 });
  };
  /** 选中月球使 HUD 入口按钮出现（沿用 P2 验收 check6 的既有布置方式） */
  const focusMoon = async (page: puppeteer.Page) => {
    await page.evaluate(() => {
      (window as any).__solarEngine.executeCameraCommand({ type: 'flyTo', bodyId: 'moon', durationSec: 1.2 });
    });
    await page.waitForSelector('[data-testid="lunar-landing-start-btn"]', { timeout: 30000 });
  };
  const readState = (page: puppeteer.Page): Promise<string> =>
    page.evaluate(() => ((window as any).__solarEngine.getLandingTelemetry()?.state as string) || 'ORBIT');

  // ---------- CP-1: 装载停滞 → PREPARING 取消 ----------
  console.log('\n【CP-1】DEM 请求挂起：真实 UI 进入 PREPARING → 取消准备 → ORBIT…');
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    const consoleErrors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    const held: Req[] = [];
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.url().includes(DEM_URL_HINT)) held.push(req); // 挂起：既不 continue 也不 abort
      else void req.continue();
    });

    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitEngine(page);
    await focusMoon(page);

    await page.click('[data-testid="lunar-landing-start-btn"]');
    await page.waitForSelector('[data-testid="lunar-landing-telemetry-hud"]', { timeout: 10000 });
    await page.waitForSelector('[data-testid="landing-btn-cancel-prep"]', { timeout: 10000 });

    // 停滞条件下 3s 内不得自行放行（fail-closed：门槛等待 measured-dem）
    await new Promise((r) => setTimeout(r, 3000));
    const stateStalled = await readState(page);
    const meshHiddenWhileStalled = await page.evaluate(
      () => (window as any).__solarEngine.getLunarValleyMesh()?.visible === false
    );
    const telemetryStalled = await page.evaluate(() => (window as any).__solarEngine.getLandingTelemetry());
    await saveShot(page, '84-p2-preparing-stalled-cancel.png');

    await page.click('[data-testid="landing-btn-cancel-prep"]');
    await page.waitForFunction(
      () => ((window as any).__solarEngine.getLandingTelemetry()?.state || 'ORBIT') === 'ORBIT',
      { timeout: 5000 }
    );
    const startBtnBack = await page.waitForSelector('[data-testid="lunar-landing-start-btn"]', { timeout: 5000 }).then(() => true).catch(() => false);
    const unexpected = consoleErrors.filter(
      (t) => !t.includes('[SolarEngine] DTM 装载失败') && !t.includes(DEM_URL_HINT)
    );
    record('CP-1 停滞装载：PREPARING 不放行、网格隐藏、UI 取消回到 ORBIT', 
      stateStalled === 'PREPARING' && meshHiddenWhileStalled && startBtnBack && unexpected.length === 0 && pageErrors.length === 0,
      {
        stateStalled,
        meshHiddenWhileStalled,
        startBtnBackAfterCancel: startBtnBack,
        terrainFidelityDuringStall: telemetryStalled?.terrain?.fidelity,
        admissionStateDuringStall: telemetryStalled?.terrain?.admissionState,
        consoleErrors: consoleErrors,
        pageErrors,
      });

    for (const r of held) void r.abort(); // 释放挂起请求后关闭页面
    await page.close();
  }

  // ---------- CP-2: 404 fail-closed ----------
  console.log('\n【CP-2】DEM 404：装载失败诚实记录、不伪造地形、门槛不放行、可取消…');
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    // “Failed to load resource…404” 的文本不含 URL，URL 在消息 location 里——
    // 归类必须按 (text, sourceUrl) 成对记录，否则会把预期内的 DEM 404 当意外错误。
    const consoleErrors: Array<{ text: string; url: string }> = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push({ text: m.text(), url: m.location().url || '' });
    });
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.url().includes(DEM_URL_HINT)) void req.respond({ status: 404, body: 'not found (evidence CP-2)' });
      else void req.continue();
    });

    await page.goto(TARGET_URL, { waitUntil: 'networkidle0', timeout: 60000 });
    await waitEngine(page);
    await new Promise((r) => setTimeout(r, 2500)); // 等 load 失败传播（fetch+sha 校验链）

    const meshHidden = await page.evaluate(
      () => (window as any).__solarEngine.getLunarValleyMesh()?.visible === false
    );
    const demFailLogged = consoleErrors.some((e) => e.text.includes('[SolarEngine] DTM 装载失败'));

    await focusMoon(page);
    await page.click('[data-testid="lunar-landing-start-btn"]');
    await page.waitForSelector('[data-testid="lunar-landing-telemetry-hud"]', { timeout: 10000 });
    await page.waitForSelector('[data-testid="landing-btn-cancel-prep"]', { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 3000)); // 失败后门槛不得自动放行
    const stateAfter404 = await readState(page);
    const telemetry404 = await page.evaluate(() => (window as any).__solarEngine.getLandingTelemetry());
    await saveShot(page, '85-p2-dem404-failclosed.png');

    await page.click('[data-testid="landing-btn-cancel-prep"]');
    await page.waitForFunction(
      () => ((window as any).__solarEngine.getLandingTelemetry()?.state || 'ORBIT') === 'ORBIT',
      { timeout: 5000 }
    );
    const unexpected = consoleErrors.filter(
      (e) => !e.text.includes('[SolarEngine] DTM 装载失败') && !e.text.includes(DEM_URL_HINT) && !e.url.includes(DEM_URL_HINT)
    );
    record('CP-2 DEM 404：fail-closed + 可取消 + 无未处理拒绝',
      meshHidden && demFailLogged && stateAfter404 === 'PREPARING' && unexpected.length === 0 && pageErrors.length === 0,
      {
        meshVisibleFalse: meshHidden,
        demFailLogged,
        stateAfter404,
        terrainFidelityAfter404: telemetry404?.terrain?.fidelity,
        admissionStateAfter404: telemetry404?.terrain?.admissionState,
        rawConsoleErrors: consoleErrors,
        pageErrors,
      });
    await page.close();
  }

  // ---------- CP-3: 干净重载回归 ----------
  console.log('\n【CP-3】无拦截干净重载：DTM 正常装载（证据脚手架无误伤）…');
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    const consoleErrors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    await page.goto(TARGET_URL, { waitUntil: 'networkidle0', timeout: 60000 });
    await waitEngine(page);
    await page.waitForFunction(
      () => (window as any).__solarEngine.getLunarValleyMesh()?.visible === true,
      { timeout: 60000 }
    );
    record('CP-3 干净重载：DTM 网格正常挂载', consoleErrors.length === 0, { consoleErrorCount: consoleErrors.length });
    await page.close();
  }

  await browser.close();

  const failed = checks.filter((c) => !c.pass);
  const report = {
    task: 'D-P2-EVIDENCE gap2',
    commit: COMMIT,
    targetUrl: TARGET_URL,
    timestamp: new Date().toISOString(),
    status: failed.length === 0 ? 'PASSED' : 'FAILED',
    checks,
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'batch-p2-cancel-paths-report.json'), JSON.stringify(report, null, 2));
  console.log('='.repeat(80));
  console.log(`${failed.length === 0 ? '🎉' : '⛔'} D-P2-EVIDENCE 缺口 2 结果: ${report.status} (${checks.length - failed.length}/${checks.length})`);
  console.log(`📄 报告: ${path.join(OUTPUT_DIR, 'batch-p2-cancel-paths-report.json')}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('脚本异常退出:', err);
  process.exit(2);
});
