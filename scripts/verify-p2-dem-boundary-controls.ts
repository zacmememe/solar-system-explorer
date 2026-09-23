/**
 * 太阳系漫游 · D-P2-EVIDENCE 缺口 1【边界与 NoData 独立控制点】证据脚本
 * （solar-coordination-v1，base 6ade791…；纯验证材料，不接入生产）
 *
 * P2 验收已有 3 个内部锚点（站点/东2km/北2km，diffPacked=0）。本脚本补齐：
 *   B-1 窗口四角 + 北边/东边中点共 6 个边界控制点：远程 PDS 原始像元 vs 打包值逐位一致，
 *       且页面引擎统一入口（enterSurfaceLook 站点高程）= 像元中心双线性值；
 *   B-2 窗外紧邻点（东/西各 1）：远程证实源数据存在该值，但运行时必须回退 datum-sphere
 *       （heightM≈0 且与真实值差 >100m）——证明窗口边界 fail-closed、不泄漏窗外数据；
 *   B-3 valid.u8 全 1（窗口内无 NoData 像元；本窗口的 NoData 语义即窗外 fail-closed）。
 *
 * 预期值全部来自远程 PDS 网关小范围读数（独立通道），不由被测插值函数自产。
 */
import puppeteer from 'puppeteer-core';
import * as path from 'node:path';
import * as fs from 'node:fs';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:4173';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUTPUT_DIR = path.resolve('artifacts/pro-review');
const DEM_DIR = path.resolve('public/data/dem/apollo17-v1');
const MCP_BASE =
  'https://pds.mcp.nasa.gov/data/store/img/lunar_reconnaissance_orbiter/pds4/lroc/lro-l-lroc-5-rdr/LROLRC_2001/DATA/SDP/NAC_DTM/APOLLO17/NAC_DTM_APOLLO17.TIF';
const COMMIT = process.env.P2_COMMIT || 'worktree-uncommitted';

interface CheckResult { name: string; pass: boolean; detail: Record<string, unknown> }
const checks: CheckResult[] = [];
function record(name: string, pass: boolean, detail: Record<string, unknown>) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} [${pass ? 'PASS' : 'FAIL'}] ${name}`);
  console.log(`   ${JSON.stringify(detail)}`);
}

const demMeta = JSON.parse(fs.readFileSync(path.join(DEM_DIR, 'metadata.json'), 'utf-8'));
const packed = fs.readFileSync(path.join(DEM_DIR, 'height.f32'));
const valid = fs.readFileSync(path.join(DEM_DIR, 'valid.u8'));
const R = demMeta.projection.referenceRadiusM;
const A = demMeta.pixelCornerAffine;
const rad = Math.PI / 180;

/** 源图连续像元 → 源图地理（与 RasterTerrainSource 仿射互逆，Node 独立实现） */
function sourcePixelToLatLon(srcCol: number, srcRow: number) {
  const xM = A.x0 + (srcCol + 0.5) * A.dx;
  const yM = A.y0 + (srcRow + 0.5) * A.dy;
  return {
    lat: yM / (R * rad),
    lon: demMeta.projection.centerLongitudeDeg + xM / (R * Math.cos(demMeta.projection.centerLatitudeDeg * rad) * rad),
  };
}

async function fetchRange(url: string, start: number, end: number): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
    if (res.status === 206) return Buffer.from(await res.arrayBuffer());
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      await new Promise((r) => setTimeout(r, 2500 * attempt));
      continue;
    }
    throw new Error(`remote range HTTP ${res.status}`);
  }
}

async function remotePixel(srcCol: number, srcRow: number): Promise<number> {
  const off = demMeta.sourceStrip0 + srcRow * demMeta.sourceRowBytes + srcCol * 4;
  const buf = await fetchRange(MCP_BASE, off, off + 3);
  return buf.readFloatLE(0);
}

// packed(col,row) ↔ source(colStart+col, rowStart+row)
const W = demMeta.width, H = demMeta.height;
const c0 = demMeta.window.colStart, r0 = demMeta.window.rowStart;

interface Point { name: string; pcol: number; prow: number; inWindow: boolean }
const POINTS: Point[] = [
  { name: 'NW 角', pcol: 0, prow: 0, inWindow: true },
  { name: 'NE 角', pcol: W - 1, prow: 0, inWindow: true },
  { name: 'SW 角', pcol: 0, prow: H - 1, inWindow: true },
  { name: 'SE 角', pcol: W - 1, prow: H - 1, inWindow: true },
  { name: '北边中点', pcol: Math.floor(W / 2), prow: 0, inWindow: true },
  { name: '东边中点', pcol: W - 1, prow: Math.floor(H / 2), inWindow: true },
  { name: '窗外紧邻·东', pcol: W, prow: Math.floor(H / 2), inWindow: false },
  { name: '窗外紧邻·西', pcol: -1, prow: Math.floor(H / 2), inWindow: false },
];

async function main() {
  console.log('='.repeat(80));
  console.log('🛰️ D-P2-EVIDENCE 缺口 1 · 边界与 NoData 独立控制点（远程 PDS 独立读数）');
  console.log(`commit: ${COMMIT}`);
  console.log('='.repeat(80));
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // ---------- B-3: valid 掩码 ----------
  const allValid = valid.length === W * H && valid.every((b: number) => b === 1);
  record('B-3 valid.u8 全 1（窗口内无 NoData；NoData 语义=窗外 fail-closed）', allValid, {
    bytes: valid.length, expected: W * H,
  });

  // ---------- B-1/B-2: 远程 vs 打包 ----------
  const results: Array<Record<string, unknown>> = [];
  for (const p of POINTS) {
    const srcCol = c0 + p.pcol, srcRow = r0 + p.prow;
    const remote = await remotePixel(srcCol, srcRow);
    const geo = sourcePixelToLatLon(srcCol, srcRow);
    const entry: Record<string, unknown> = {
      name: p.name, srcCol, srcRow, inWindow: p.inWindow, remote,
      lat: geo.lat, lon: geo.lon,
    };
    if (p.inWindow) {
      const packedVal = packed.readFloatLE((p.prow * W + p.pcol) * 4);
      entry.packed = packedVal;
      entry.diffPacked = Math.abs(remote - packedVal);
    }
    results.push(entry);
    await new Promise((r) => setTimeout(r, 700)); // 网关礼貌间隔
  }
  const inWindow = results.filter((r) => r.inWindow);
  record('B-1 边界控制点：远程 PDS 原始像元 = 打包值（逐位）',
    inWindow.every((r) => (r.diffPacked as number) === 0),
    { points: inWindow });

  const outside = results.filter((r) => !r.inWindow);
  record('B-2 窗外紧邻点：源数据存在（远程有限值）且非平凡地形',
    outside.every((r) => Number.isFinite(r.remote as number) && Math.abs(r.remote as number) > 100),
    { points: outside });

  // ---------- 页面统一入口采样 ----------
  console.log('\n页面引擎统一入口采样（enterSurfaceLook 站点高程）…');
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
    return e && typeof e.getSurfaceStationPose === 'function' && e.getLunarValleyMesh?.()?.visible === true;
  }, { timeout: 60000 });

  const pageSamples = await page.evaluate((pts: Array<{ lat: number; lon: number; inWindow: boolean }>) => {
    const engine = (window as any).__solarEngine;
    const out: Array<Record<string, number | boolean>> = [];
    for (const p of pts) {
      engine.executeCameraCommand({
        type: 'enterSurfaceLook', bodyId: 'moon', lat: p.lat, lon: p.lon, eyeHeightM: 1.7,
        initialYawDeg: 0, initialPitchDeg: 0,
      });
      const pose = engine.getSurfaceStationPose();
      out.push({ lat: p.lat, lon: p.lon, inWindow: p.inWindow, heightM: pose?.station?.heightM ?? NaN });
    }
    return out;
  }, results.map((r) => ({ lat: r.lat as number, lon: r.lon as number, inWindow: r.inWindow as boolean })));
  await browser.close();

  // 窗内：站点高程 = 像元中心值（远程独立值），|Δ|<1e-3；窗外：datum-sphere≈0 且与真实值差>100
  const pageInOk = pageSamples
    .filter((s: any) => s.inWindow)
    .every((s: any, i: number) => Math.abs(s.heightM - (inWindow[i].remote as number)) < 1e-3);
  const pageOut = pageSamples.filter((s: any) => !s.inWindow);
  const pageOutOk = pageOut.every((s: any, i: number) =>
    Math.abs(s.heightM) < 1e-6 && Math.abs((outside[i].remote as number) - s.heightM) > 100
  );
  record('B-1b 页面统一入口：窗内边界点高程 = 远程独立像元值', pageInOk && consoleErrors.length === 0,
    { samples: pageSamples.filter((s: any) => s.inWindow), consoleErrors });
  record('B-2b 页面统一入口：窗外点回退 datum-sphere（0m）且不泄漏窗外真值', pageOutOk,
    { samples: pageOut, remoteTruth: outside.map((o) => o.remote) });

  const failed = checks.filter((c) => !c.pass);
  const report = {
    task: 'D-P2-EVIDENCE gap1',
    commit: COMMIT,
    timestamp: new Date().toISOString(),
    status: failed.length === 0 ? 'PASSED' : 'FAILED',
    controls: results,
    checks,
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'batch-p2-boundary-controls-report.json'), JSON.stringify(report, null, 2));
  console.log('='.repeat(80));
  console.log(`${failed.length === 0 ? '🎉' : '⛔'} D-P2-EVIDENCE 缺口 1 结果: ${report.status} (${checks.length - failed.length}/${checks.length})`);
  console.log(`📄 报告: ${path.join(OUTPUT_DIR, 'batch-p2-boundary-controls-report.json')}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('脚本异常退出:', err);
  process.exit(2);
});
