// F-LUNAR-LIMB-01 复现/验收探针：月球落区靠近球缘时的凹陷（正常 UI + 真实拖动）。
// 流程：天体按钮→月球（远观）→站点下拉选 SITE_ID→前往（如需）→[A] 轨道视角
// 滚轮放大到用户实机月盘尺寸→真实拖动把站区转到盘缘（连拍）→[B] 正常着陆→
// HOLD 暂停→真实拖动环顾连拍。全程只读引擎诊断；截图按序存
// D:\solar-evidence\F-LUNAR-LIMB-01\<prefix>。
// 人工机位干预（仅 A-lit 时间扫描与滚轮缩放）如实记录，与正常 UI 序列分开命名。
// SITE_ID=taurus-littrow|tranquility-base（默认 taurus-littrow）
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:5199';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = 'D:/solar-evidence/F-LUNAR-LIMB-01';
const SITE_ID = process.env.SITE_ID || 'taurus-littrow';
const SITE_COORDS: Record<string, { lat: number; lon: number }> = {
  'taurus-littrow': { lat: 20.2108, lon: 30.7997 },
  'tranquility-base': { lat: 0.6741, lon: 23.473 },
};
const site = SITE_COORDS[SITE_ID];
if (!site) {
  console.error(`[SITE] 未支持站点: ${SITE_ID}`);
  process.exit(1);
}
const siteDirExpr = `new THREE.Vector3(
  Math.cos(${site.lat} * Math.PI / 180) * Math.cos(${site.lon} * Math.PI / 180),
  Math.sin(${site.lat} * Math.PI / 180),
  -Math.cos(${site.lat} * Math.PI / 180) * Math.sin(${site.lon} * Math.PI / 180)
)`;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=d3d11', '--enable-webgl', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window as any).__solarEngine?.camera, { timeout: 30000 });

  const clickId = async (id: string) => {
    await page.waitForSelector(`[data-testid="${id}"]`, { timeout: 30000 });
    await page.click(`[data-testid="${id}"]`);
  };
  // 站点/盘缘几何（只读）：站区 NDC、月盘中心 NDC、月盘角半径（像素）、栈/门控状态
  const geo = () => page.evaluate(`(() => {
    const e = window.__solarEngine;
    const THREE = window.THREE;
    const pose = e.getBodyWorldPose('moon');
    const siteDir = ${siteDirExpr};
    const centerNdc = pose.pos.clone().project(e.camera);
    const siteWorld = pose.pos.clone().addScaledVector(siteDir.applyQuaternion(pose.quaternion).normalize(), pose.surfaceRadius);
    const siteNdc = siteWorld.clone().project(e.camera);
    const dist = e.camera.position.distanceTo(pose.pos);
    const angularRad = Math.asin(Math.min(1, pose.surfaceRadius / Math.max(dist, 1e-9)));
    const fovRad = e.camera.fov * Math.PI / 180;
    const discPx = (angularRad / (fovRad / 2)) * (window.innerHeight / 2);
    const stack = e.moonSiteStacks.get('${SITE_ID}');
    const offPx = Math.hypot(
      (siteNdc.x - centerNdc.x) * window.innerWidth / 2,
      (siteNdc.y - centerNdc.y) * window.innerHeight / 2
    );
    return {
      centerNdc: [+centerNdc.x.toFixed(3), +centerNdc.y.toFixed(3)],
      siteNdc: [+siteNdc.x.toFixed(3), +siteNdc.y.toFixed(3)],
      siteOffsetPx: +offPx.toFixed(0),
      discRadiusPx: +discPx.toFixed(0),
      mode: e.cameraController.getSnapshot().mode,
      stackBuilt: !!(stack && stack.built),
      l1Opacity: stack && stack.lolaMaterials && stack.lolaMaterials.length ? +stack.lolaMaterials[0].opacity.toFixed(3) : null,
      dtmOpacity: stack && stack.valleyMaterial ? +stack.valleyMaterial.opacity.toFixed(3) : null,
      patchVisible: !!(stack && stack.patchMesh && stack.patchMesh.visible),
    };
  })()`);
  // 真实拖动（runner 同款）
  const drag = async (dx: number, dy = 0) => {
    await page.mouse.move(700, 450);
    await page.mouse.down();
    await page.mouse.move(700 + dx, 450 + dy, { steps: Math.max(1, Math.ceil(Math.abs(dx) / 15)) });
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 200));
  };

  // ---- A) 轨道远观：正常 UI 到达月球 → 选站 → 滚轮放大 → 拖动把站区转到盘缘 ----
  await clickId('planet-btn-earth');
  await new Promise((r) => setTimeout(r, 600));
  await clickId('moon-btn-moon');
  await page.waitForFunction(() => {
    const s = (window as any).__solarEngine.getCameraSnapshot();
    return s.targetBodyId === 'moon' && !s.isTransitioning;
  }, { timeout: 30000, polling: 300 });
  await new Promise((r) => setTimeout(r, 400));
  await page.waitForSelector('[data-testid="landing-site-select"]', { timeout: 30000 });
  await page.select('[data-testid="landing-site-select"]', SITE_ID);
  await page.waitForFunction((id) => {
    const a = (window as any).__solarEngine.getLandingAvailability();
    return a.siteId === id && ['land', 'travel-to-site'].includes(a.action);
  }, { timeout: 60000, polling: 400 }, SITE_ID);
  if (await page.$('[data-testid="lunar-landing-travel-site-btn"]')) {
    await clickId('lunar-landing-travel-site-btn');
    await page.waitForFunction(() => (window as any).__solarEngine.getLandingAvailability().action === 'land', {
      timeout: 45000, polling: 400,
    });
  }
  await new Promise((r) => setTimeout(r, 800));
  interface GeoR {
    centerNdc: number[]; siteNdc: number[]; siteOffsetPx: number; discRadiusPx: number; mode: string;
    stackBuilt?: boolean; l1Opacity?: number | null; dtmOpacity?: number | null; patchVisible?: boolean;
  }
  let g = (await geo()) as unknown as GeoR;
  console.log('[A0 orbit start]', JSON.stringify(g));
  await page.screenshot({ path: path.join(OUT, `${SITE_ID}-A0-orbit-center.png`) });
  // 人工机位干预 1（如实记录）：滚轮放大月盘到用户实机尺寸（≥420px 半径），
  // 缺陷在该尺度清晰可辨；只写相机距离，不动相机指向/站点/任务状态。
  for (let i = 0; i < 14; i++) {
    if (g.discRadiusPx >= 420) break;
    await page.mouse.move(700, 450);
    await page.mouse.wheel({ deltaY: -240 });
    await new Promise((r) => setTimeout(r, 350));
    g = (await geo()) as unknown as GeoR;
  }
  console.log('[A-zoom]', JSON.stringify(g));
  // 人工机位干预 2（如实记录）：扫描模拟时间让站区受光，否则凹陷轮廓在暗面
  // 与星空对比度不足。只写时间，不动相机/站点/任务状态。
  const lit = await page.evaluate(`(() => {
    const e = window.__solarEngine;
    const THREE = window.THREE;
    const siteLocal = ${siteDirExpr};
    const t0 = e.getSimTimeHours();
    let best = null;
    for (let k = 0; k < 24; k++) {
      const t = t0 + k * 27.32;
      e.setSimTimeHours(t);
      const pose = e.getBodyWorldPose('moon');
      const siteWorld = siteLocal.clone().applyQuaternion(pose.quaternion).normalize();
      const sun = e.bodyPoseProvider.getPhysicalSunDirection('moon', t).normalize();
      const d = sun.dot(siteWorld);
      if (!best || d > best.d) best = { t, d };
    }
    e.setSimTimeHours(best.t);
    const sun = e.bodyPoseProvider.getPhysicalSunDirection('moon', best.t).normalize();
    const pose = e.getBodyWorldPose('moon');
    const siteWorld = siteLocal.clone().applyQuaternion(pose.quaternion).normalize();
    return { t0: +t0.toFixed(1), bestT: +best.t.toFixed(1), dot: +sun.dot(siteWorld).toFixed(3) };
  })()`);
  console.log('[A-lit scan]', JSON.stringify(lit));
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: path.join(OUT, `${SITE_ID}-A0b-lit.png`) });
  // 拖动逐步把站区移向盘缘（每步后检查偏移/半径比；0.97+ 才停——凹陷在真盘缘）
  for (let i = 1; i <= 26; i++) {
    await drag(-90, i % 3 === 0 ? -30 : 0);
    g = (await geo()) as unknown as GeoR;
    const ratio = g.discRadiusPx > 0 ? g.siteOffsetPx / g.discRadiusPx : -1;
    console.log(`[A${i} drag]`, JSON.stringify({ ...g, edgeRatio: +ratio.toFixed(3) }));
    if (ratio > 0.9 && ratio < 1.35) {
      await page.screenshot({ path: path.join(OUT, `${SITE_ID}-A${i}-near-limb.png`) });
    }
    if (ratio >= 0.97) break;
  }
  await page.screenshot({ path: path.join(OUT, `${SITE_ID}-A-final-limb.png`) });

  // ---- B) 正常着陆 → HOLD → 真实拖动环顾至球缘 ----
  // 受光扫描/缩放可能改了 availability——先确认状态，必要时重新走正常 UI 前往
  const availB = await page.evaluate(() => (window as any).__solarEngine.getLandingAvailability());
  console.log('[B avail]', JSON.stringify(availB));
  if (availB.action !== 'land') {
    await page.waitForSelector('[data-testid="landing-site-select"]', { timeout: 30000 });
    await page.select('[data-testid="landing-site-select"]', SITE_ID);
    await page.waitForFunction((id) => {
      const a = (window as any).__solarEngine.getLandingAvailability();
      return a.siteId === id && ['land', 'travel-to-site'].includes(a.action);
    }, { timeout: 60000, polling: 400 }, SITE_ID);
    if (await page.$('[data-testid="lunar-landing-travel-site-btn"]')) {
      await clickId('lunar-landing-travel-site-btn');
      await page.waitForFunction(() => (window as any).__solarEngine.getLandingAvailability().action === 'land', {
        timeout: 45000, polling: 400,
      });
    }
  }
  await page.waitForSelector('[data-testid="lunar-landing-start-btn"]', { timeout: 30000 });
  await clickId('lunar-landing-start-btn');
  await page.waitForFunction(() => ['DESCENDING', 'HOLD'].includes((window as any).__solarEngine.getLandingTelemetry().state), {
    timeout: 120000, polling: 800,
  });
  // 等下降到中低高度（更接近用户在下降中观察球缘的场景）再暂停；180s 未到也继续（如实记录 agl）
  await page.waitForFunction(() => {
    const t = (window as any).__solarEngine.getLandingTelemetry();
    return t.state !== 'DESCENDING' || t.altitudeAGLM < 2500000;
  }, { timeout: 180000, polling: 1500 }).catch(() => console.log('[B wait] 180s 未达 2500km，按当前高度继续'));
  const paused = await page.evaluate(() => (window as any).__solarEngine.pauseLanding());
  void paused;
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingTelemetry().state === 'HOLD', {
    timeout: 20000, polling: 300,
  });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: path.join(OUT, `${SITE_ID}-B0-hold-start.png`) });
  // 真实拖动环顾（SURFACE_LOOK 的 orbit=yaw/pitch），把视线转向地平线/球缘
  for (const [i, dx, dy] of [[1, -220, 60], [2, -220, 60], [3, -160, 80], [4, -160, 0]] as const) {
    await drag(dx, dy);
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: path.join(OUT, `${SITE_ID}-B${i}-hold-look.png`) });
  }
  const finalDiag = await page.evaluate(`(() => {
    const e = window.__solarEngine;
    const stack = e.moonSiteStacks.get('${SITE_ID}');
    const vm = stack.valleyMesh;
    return {
      state: e.getLandingTelemetry().state, agl: e.getLandingTelemetry().altitudeAGLM,
      dtmVisible: vm.visible, matOpacity: vm.material.opacity,
      l1Mat: stack.lolaMaterials.length ? (stack.lolaMaterials[0].map ? (stack.lolaMaterials[0].map.image ? (stack.lolaMaterials[0].map.image.width || 'canvas') : 'no-img') : 'no-map') : 'none',
      patchVisible: !!(stack.patchMesh && stack.patchMesh.visible),
      renderInfo: e.lastFrameRenderInfo ? { layered: e.lastFrameRenderInfo.layered } : null,
    };
  })()`);
  console.log('[B final]', JSON.stringify(finalDiag));

  // ---- C) 返轨（用户实机场景：激活站+返轨道后拖到盘缘）→ 拖动站区到盘缘连拍 ----
  const returnBtn = (await page.$('[data-testid="landing-btn-return-hold"]'))
    ?? (await page.$('[data-testid="landing-btn-return-orbit"]'));
  if (returnBtn) {
    await returnBtn.click();
    await page.waitForFunction(() => {
      const s = (window as any).__solarEngine.getCameraSnapshot();
      return s.mode === 'ORBIT_TARGET' && !s.isTransitioning;
    }, { timeout: 60000, polling: 500 });
    await new Promise((r) => setTimeout(r, 800));
    console.log('[C0 return-orbit]', JSON.stringify(await (async () => geo())()));
    // 拖动把站区转到盘缘（激活站门控运行中——缺陷/修复的关键对照态）
    for (let i = 1; i <= 26; i++) {
      await drag(-90, i % 3 === 0 ? -30 : 0);
      g = (await geo()) as unknown as GeoR;
      const ratio = g.discRadiusPx > 0 ? g.siteOffsetPx / g.discRadiusPx : -1;
      console.log(`[C${i} drag]`, JSON.stringify({ ...g, edgeRatio: +ratio.toFixed(3) }));
      if (ratio > 0.9 && ratio < 1.35) {
        await page.screenshot({ path: path.join(OUT, `${SITE_ID}-C${i}-orbit-limb.png`) });
      }
      if (ratio >= 0.97) break;
    }
    await page.screenshot({ path: path.join(OUT, `${SITE_ID}-C-final-orbit-limb.png`) });
  } else {
    console.log('[C] 未找到返轨按钮，跳过 C 段');
  }
  console.log('[errors]', errs.length ? errs.slice(0, 5).join(' | ') : '(none)');
  await browser.close();
  console.log('LIMB REPRO DONE');
}

main().catch((e) => { console.error('LIMB REPRO FAILED:', e); process.exit(1); });
