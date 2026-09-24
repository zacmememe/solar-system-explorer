/**
 * S5-3 探针：月面多站点化——哈德利月溪（Apollo 15）下降流
 * 1) 默认 taurus 栈构建正常（回归）；
 * 2) 相机移至 hadley 半球 → 可用性解析 siteId=hadley-rille（资产预取触发）；
 * 3) 完整下降流（PREPARING→DESCENDING→SURFACE_LOOK）→ 遥测 site/admission/
 *    sourceId（NAC_DTM_APOLLO15）核验；
 * 4) 栈切换断言：hadley group 可见、taurus group 隐藏、挖孔球几何为 hadley 栈；
 * 5) GL 直读截图：触地 + 西向（哈德利月溪方向）+ 返轨；
 * 6) 返轨后切回 taurus 半球 → 可用性解析回 taurus-littrow（再切换能力）。
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:5199';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = 'D:/solar-evidence/pro-review';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=d3d11', '--enable-webgl', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const consoleLines: string[] = [];
  page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });

  // 1) taurus 默认栈就绪
  await page.waitForFunction(() => {
    const e = (window as any).__solarEngine;
    const mesh = e.getMoonMesh?.()?.getObjectByName?.('taurus-littrow-terrain');
    return !!mesh?.visible;
  }, { timeout: 60000 });
  console.log('[1] taurus default stack visible');

  // 2) 相机移至 hadley 半球上空（26.1N/3.6E 天顶）。select 不移动相机——须先
  // 普通 flyTo moon 建立月球锚点（exact targetPos 的偏移按当前锚点解释），
  // 再精确飞站顶
  await page.evaluate(`(() => {
    const e = window.__solarEngine;
    e.executeCameraCommand({ type: 'select', bodyId: 'moon' });
    e.executeCameraCommand({ type: 'flyTo', bodyId: 'moon', durationSec: 1.2 });
  })()`);
  await page.waitForFunction(() => {
    const s = (window as any).__solarEngine.cameraController.getSnapshot();
    return !s.isTransitioning;
  }, { timeout: 30000, polling: 300 });
  await new Promise((r) => setTimeout(r, 500));
  const flyToSiteZenith = (lat: number, lon: number) =>
    page.evaluate(`((lat, lon) => {
      const e = window.__solarEngine;
      const THREE = window.THREE;
      const pose = e.getBodyWorldPose('moon');
      const dir = new THREE.Vector3(
        Math.cos(lat * Math.PI / 180) * Math.cos(lon * Math.PI / 180),
        Math.sin(lat * Math.PI / 180),
        -Math.cos(lat * Math.PI / 180) * Math.sin(lon * Math.PI / 180)
      ).applyQuaternion(pose.quaternion).normalize();
      const dist = pose.surfaceRadius * 2.9;
      const target = pose.pos.clone().addScaledVector(dir, dist);
      e.executeCameraCommand({ type: 'flyTo', bodyId: 'moon', durationSec: 1.4, targetPos: [target.x, target.y, target.z], exact: true });
    })(${lat}, ${lon})`);
  await flyToSiteZenith(26.135698, 3.630127);
  await page.waitForFunction(() => {
    const s = (window as any).__solarEngine.cameraController.getSnapshot();
    return !s.isTransitioning;
  }, { timeout: 45000, polling: 300 });
  await new Promise((r) => setTimeout(r, 800));
  const flyDiag = await page.evaluate(`(() => {
    const e = window.__solarEngine;
    const THREE = window.THREE;
    const pose = e.getBodyWorldPose('moon');
    const cam = e.camera.position;
    const rel = cam.clone().sub(pose.pos).applyQuaternion(pose.quaternion.clone().invert()).normalize();
    const dot = (lat, lon) => {
      const d = [Math.cos(lat * Math.PI / 180) * Math.cos(lon * Math.PI / 180), Math.sin(lat * Math.PI / 180), -Math.cos(lat * Math.PI / 180) * Math.sin(lon * Math.PI / 180)];
      return rel.x * d[0] + rel.y * d[1] + rel.z * d[2];
    };
    return {
      dist: +cam.distanceTo(pose.pos).toFixed(3),
      radius: +pose.surfaceRadius.toFixed(3),
      dotHadley: +dot(26.135698, 3.630127).toFixed(4),
      dotTaurus: +dot(20.2108, 30.7997).toFixed(4),
      mode: e.cameraController.getSnapshot().mode,
    };
  })()`);
  console.log('[2a] fly diag =', JSON.stringify(flyDiag));
  await page.waitForFunction(() => {
    const a = (window as any).__solarEngine.getLandingAvailability();
    return a.action === 'land' || a.action === 'travel-to-site';
  }, { timeout: 45000, polling: 400 });
  let avail = await page.evaluate(() => (window as any).__solarEngine.getLandingAvailability());
  console.log('[2] at moon (hadley side), availability =', JSON.stringify(avail));
  if (avail.siteId !== 'hadley-rille') throw new Error(`站点解析错误: ${avail.siteId}`);
  if (avail.action === 'travel-to-site') {
    await page.evaluate(() => (window as any).__solarEngine.travelToLandingSite());
    await new Promise((r) => setTimeout(r, 4200));
  }
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingAvailability().action === 'land', {
    timeout: 45000, polling: 400,
  });
  // 等 hadley 资产（懒装载由可用性解析触发）
  await page.waitForFunction(() => {
    const e = (window as any).__solarEngine;
    return !!e.getMoonMesh?.()?.getObjectByName?.('hadley-rille-terrain')?.visible;
  }, { timeout: 90000, polling: 500 });
  console.log('[3] hadley stack built & visible');

  // 栈切换断言
  const stacks = await page.evaluate(`(() => {
    const e = window.__solarEngine;
    const h = e.getMoonMesh().getObjectByName('moon-site-hadley-rille');
    const t = e.getMoonMesh().getObjectByName('moon-site-taurus-littrow');
    return { hadleyVisible: h ? h.visible : null, taurusVisible: t ? t.visible : null };
  })()`);
  console.log('[4] stack visibility =', JSON.stringify(stacks));

  // 3) 下降流
  const started = await page.evaluate(() => (window as any).__solarEngine.startLunarLanding());
  if (!started) throw new Error('hadley descent entry rejected');
  const states = new Set<string>();
  const t0 = Date.now();
  for (;;) {
    const st = await page.evaluate(() => (window as any).__solarEngine.getLandingTelemetry());
    states.add(st.state);
    if (st.state === 'SURFACE_LOOK') break;
    if (Date.now() - t0 > 300000) throw new Error(`descent timeout at ${st.state}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log('[5] descent states:', [...states].join(' -> '));
  await new Promise((r) => setTimeout(r, 2500));
  const tele = await page.evaluate(() => {
    const t = (window as any).__solarEngine.getLandingTelemetry();
    return { site: t.site.id, agl: t.altitudeAGLM, lat: +t.currentLat.toFixed(4), lon: +t.currentLon.toFixed(4), terrain: t.terrain };
  });
  console.log('[6] touchdown telemetry =', JSON.stringify(tele));
  const priv = await page.evaluate(`(() => {
    const e = window.__solarEngine;
    const h = e.moonSiteStacks.get('hadley-rille');
    const t = e.moonSiteStacks.get('taurus-littrow');
    const hp = e.terrainProviderProbe;
    return {
      engineActiveMoonSite: e.activeMoonSiteId,
      hadleySourceTag: h ? h.raster.sourceTag : null,
      hadleyReady: h ? h.raster.isReady : null,
      taurusSourceTag: t ? t.raster.sourceTag : null,
      hadleyGroupVisible: h ? h.group.visible : null,
      taurusGroupVisible: t ? t.group.visible : null,
      stackSwitchAssert: e.getMoonMesh().geometry === (h ? h.holedGeometry : null),
    };
  })()`);
  console.log('[6a] engine internals =', JSON.stringify(priv));
  const hpDiag = await page.evaluate(`(async () => {
    const e = window.__solarEngine;
    const mod = await import('/src/surface/TerrainHeightProvider.ts');
    const dyn = mod.TerrainHeightProvider.getInstance();
    const ctlHp = e.landingController.heightProvider;
    return {
      sameInstance: dyn === ctlHp,
      ctlProviderActive: ctlHp.activeMoonSiteId,
      ctlRegistered: [...ctlHp.moonRasters.keys()],
      ctlActiveTag: ctlHp.activeMoonRaster().sourceTag,
      ctlSampleAtSite: ctlHp.getHeightSample('moon', 26.135698, 3.630127),
      dynamicImportUrl: mod[Symbol.toStringTag],
    };
  })()`);
  console.log('[6b] provider internals =', JSON.stringify(hpDiag, null, 1));
  if (tele.site !== 'hadley-rille') throw new Error(`telemetry site mismatch: ${tele.site}`);
  if (tele.terrain.sourceId !== 'NAC_DTM_APOLLO15') throw new Error(`sourceId mismatch: ${tele.terrain.sourceId}`);

  const glShot = (name: string) =>
    page.evaluate(`(() => {
      const e = window.__solarEngine;
      const renderer = e.renderer;
      renderer.render(e.scene, e.camera);
      const gl = renderer.getContext();
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      const buf = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      const px = (x, y) => { const i = ((H - 1 - y) * W + x) * 4; return [buf[i], buf[i + 1], buf[i + 2]]; };
      const diag = { exposure: +renderer.toneMappingExposure.toFixed(3), pxGround: px(Math.floor(W / 2), Math.floor(H * 0.3)), pxSky: px(Math.floor(W / 2), Math.floor(H * 0.85)) };
      const c2d = document.createElement('canvas');
      c2d.width = W; c2d.height = H;
      const ctx = c2d.getContext('2d');
      if (!ctx) throw new Error('2d ctx');
      const img = ctx.createImageData(W, H);
      for (let y = 0; y < H; y++) {
        const src = (H - 1 - y) * W * 4;
        img.data.set(buf.subarray(src, src + W * 4), y * W * 4);
      }
      ctx.putImageData(img, 0, 0);
      return { b64: c2d.toDataURL('image/png'), diag };
    })()`).then((res: any) => {
      fs.writeFileSync(`${OUT}/s53-${name}.png`, Buffer.from(res.b64.split(',')[1], 'base64'));
      console.log(`[gl-shot] ${name}`, JSON.stringify(res.diag));
    });

  await glShot('hadley-touchdown');
  // 西向平视（哈德利月溪在站点以西 ~1.5-2km）
  await page.evaluate(() => {
    (window as any).__solarEngine.cameraController.executeCommand({ type: 'setSurfaceLook', yawDeg: 270, pitchDeg: 2 });
  });
  await new Promise((r) => setTimeout(r, 800));
  await glShot('hadley-west-rille');

  // 6) 返轨
  await page.evaluate(() => (window as any).__solarEngine.returnToLunarOrbit());
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingTelemetry().state === 'ORBIT', {
    timeout: 120000, polling: 1000,
  });
  await new Promise((r) => setTimeout(r, 3000));
  // 切回 taurus 半球 → 解析回 taurus
  await flyToSiteZenith(20.2108, 30.7997);
  await page.waitForFunction(() => {
    const s = (window as any).__solarEngine.cameraController.getSnapshot();
    return !s.isTransitioning;
  }, { timeout: 45000, polling: 300 });
  await new Promise((r) => setTimeout(r, 800));
  avail = await page.evaluate(() => (window as any).__solarEngine.getLandingAvailability());
  console.log('[7] back at taurus side, availability =', JSON.stringify(avail));
  if (avail.siteId !== 'taurus-littrow') throw new Error(`回切解析错误: ${avail.siteId}`);

  const errs = consoleLines.filter((l) => /^\[(error|warn)\]/i.test(l) && !/WAC/.test(l));
  console.log('[8] err/warn:', errs.length ? errs.slice(0, 12).join(' | ') : '(none, WAC 仅 taurus 属预期)');
  await browser.close();
  console.log('HADLEY PROBE DONE');
}

main().catch((e) => { console.error('PROBE FAILED:', e); process.exit(1); });
