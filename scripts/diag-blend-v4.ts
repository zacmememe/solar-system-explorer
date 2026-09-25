// F-SURFACE-BLEND-01 诊断 v4：真实降落序列内取样（最终采用路径）。
// v2/v3 教训：人工球坐标机位与纹理参数化对不上（theta=90°+lon 打到 u=0.161 即
// -122° 区域），且站点 group 需激活才可见。v4 完全走 UI：选静海 → 启动降落 →
// DESCENDING 中轮询 AGL，在 300km / 60km 窗口时同步 raycast + 截图。
// 机位为引擎降落导引（与用户实机一致），不做任何人工摆位。
// 证据存 D:\solar-evidence\fsurface-blend\diagnosis\。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:4173';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = 'D:/solar-evidence/fsurface-blend/diagnosis';
const SITE = 'tranquility-base';

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=d3d11', '--enable-webgl', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 160)));
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window as any).__solarEngine?.camera, { timeout: 30000 });
  await page.click('[data-testid="moon-btn-moon"]');
  await page.waitForFunction(() => {
    const s = (window as any).__solarEngine.getCameraSnapshot();
    return s.targetBodyId === 'moon' && !s.isTransitioning;
  }, { timeout: 120000, polling: 400 });
  await new Promise((r) => setTimeout(r, 800));
  await page.waitForSelector('[data-testid="landing-site-select"]', { timeout: 30000 });
  await page.select('[data-testid="landing-site-select"]', SITE);
  await page.waitForFunction(() => {
    const st = (window as any).__solarEngine.moonSiteStacks.get('tranquility-base');
    return !!(st && st.built);
  }, { timeout: 60000, polling: 500 });
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingAvailability().action === 'land', {
    timeout: 60000, polling: 500,
  });
  await page.click('[data-testid="lunar-landing-start-btn"]');
  await page.waitForFunction(() => (window as any).__solarEngine.getLandingTelemetry().state === 'DESCENDING', {
    timeout: 180000, polling: 500,
  });
  console.log('descent started');

  const raycast = async (): Promise<any> => page.evaluate<any>(`(() => {
    const e = window.__solarEngine;
    const THREE = window.THREE;
    const stack = e.moonSiteStacks.get('tranquility-base');
    const moon = e.getMoonMesh();
    const moonCenter = moon.getWorldPosition(new THREE.Vector3());
    const meshes = [];
    moon.traverse((o) => { if (o.isMesh) meshes.push(o); });
    stack.group.traverse((o) => { if (o.isMesh && !meshes.includes(o)) meshes.push(o); });
    const moonR = moon.geometry.boundingSphere ? moon.geometry.boundingSphere.radius * moon.scale.x : moon.scale.x;
    const texInfo = (m) => {
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      const u = mat && mat.uniforms;
      const t = u && u.moonTexture ? u.moonTexture.value : (mat && mat.map);
      return t && t.image ? (t.image.width || 'canvas') : null;
    };
    const matInfo = (m) => {
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      return mat ? mat.type + '|tex=' + texInfo(m) : 'none';
    };
    const cells = [];
    const N = 11;
    for (let iy = 0; iy < N; iy++) {
      for (let ix = 0; ix < N; ix++) {
        const ndcX = -0.4 + (0.8 * ix) / (N - 1);
        const ndcY = -0.4 + (0.8 * iy) / (N - 1);
        const ray = new THREE.Raycaster();
        ray.near = 0.00001; ray.far = 10;
        ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), e.camera);
        const hit = ray.intersectObjects(meshes, false)[0];
        if (hit) {
          const radial = hit.point.clone().sub(moonCenter).length();
          cells.push({ px: [+ndcX.toFixed(3), +ndcY.toFixed(3)],
            mesh: hit.object.name || '(moon body unnamed)', mat: matInfo(hit.object),
            uv: hit.uv ? [+hit.uv.x.toFixed(3), +hit.uv.y.toFixed(3)] : null,
            radialOverR: +(radial / moonR).toFixed(5) });
        } else cells.push({ px: [+ndcX.toFixed(3), +ndcY.toFixed(3)], mesh: '(miss)' });
      }
    }
    const st2 = e.moonSiteStacks.get('tranquility-base');
    const dtmMat = st2.valleyMaterial || st2.terrainMaterial;
    const l1Mat = st2.lolaMaterials || [];
    const tel = e.getLandingTelemetry();
    return {
      aglM: tel.altitudeAGLM, state: tel.state,
      groupVisible: st2.group.visible,
      patchVisible: st2.patchMesh ? st2.patchMesh.visible : null,
      patchOpacity: st2.patchMaterial && st2.patchMaterial.uniforms && st2.patchMaterial.uniforms.uOpacity
        ? +st2.patchMaterial.uniforms.uOpacity.value.toFixed(3) : null,
      dtmOpacity: dtmMat ? +(dtmMat.opacity != null ? dtmMat.opacity : (dtmMat.uniforms && dtmMat.uniforms.uOpacity ? dtmMat.uniforms.uOpacity.value : -1)).toFixed(3) : null,
      l1Opacity: l1Mat.length ? +(l1Mat[0].opacity != null ? l1Mat[0].opacity : -1).toFixed(3) : null,
      cells,
    };
  })()`);

  const report: any = { poses: [] };
  const targets: Array<[string, number]> = [['descent-300km', 300000], ['descent-60km', 60000]];
  for (const [name, agl] of targets) {
    await page.waitForFunction((a: number) => (window as any).__solarEngine.getLandingTelemetry().altitudeAGLM <= a, {
      timeout: 12 * 60 * 1000, polling: 300,
    }, agl);
    const r: any = await raycast();
    r.name = name;
    report.poses.push(r);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    const tally: Record<string, number> = {};
    for (const c of r.cells) if (c.mesh !== '(miss)') tally[c.mesh] = (tally[c.mesh] || 0) + 1;
    r.tally = tally;
    console.log(`\n== ${name} agl=${(r.aglM / 1000).toFixed(1)}km state=${r.state} ==`);
    console.log('gates:', JSON.stringify({ groupVisible: r.groupVisible, patchVisible: r.patchVisible, patchOpacity: r.patchOpacity, dtmOpacity: r.dtmOpacity, l1Opacity: r.l1Opacity }));
    console.log('tally:', JSON.stringify(tally));
  }
  fs.writeFileSync(path.join(OUT, 'raycast-v4.json'), JSON.stringify(report, null, 1));
  await browser.close();
  console.log('\nBLEND DIAGNOSIS V4 DONE');
}

main().catch((e) => { console.error('DIAG FAILED:', e); process.exit(1); });
