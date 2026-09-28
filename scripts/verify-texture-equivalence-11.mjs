// G2 等价验证：23 颗卫星表面纹理逐颗哈希（改造前后对照，Z18-11 口径=同一代码路径输出一致）
// 运行时经引擎实例 bodyNodes 取每颗卫星当前材质的纹理：canvas 型取 toDataURL SHA-256，
// 网络图型记 src（不参与哈希）。等队列排空后采样。
import { preview } from 'vite';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';

const OUT = process.argv[2] || 'D:/solar-evidence/F-STARTUP-RESPONSIVENESS-11/equiv-after';
await fs.mkdir(OUT, { recursive: true });
const server = await preview({ preview: { host: '127.0.0.1', port: 0, open: false } });
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true, defaultViewport: { width: 1920, height: 1080 }, protocolTimeout: 300000,
  args: ['--use-gl=angle', '--use-angle=d3d11'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 160)));
await page.goto(server.resolvedUrls.local[0], { waitUntil: 'domcontentloaded', timeout: 90000 });
// G2 版有延迟队列；基线版无该字段（undefined!==0 会假等）——条件等待
await page.waitForFunction(() => {
  const e = window.__solarEngine;
  if (!e) return false;
  return e.pendingMoonTextureTasks ? e.pendingMoonTextureTasks.length === 0 : true;
}, { timeout: 240000, polling: 200 });
await new Promise((r) => setTimeout(r, 3000));
const hashes = await page.evaluate(async () => {
  const sha = async (s) => {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  };
  const e = window.__solarEngine;
  const ids = ['phobos','deimos','io','europa','ganymede','callisto','amalthea','mimas','enceladus','tethys','dione','rhea','hyperion','iapetus','miranda','ariel','umbriel','titania','oberon','triton','proteus','titan'];
  const out = {};
  for (const id of ids) {
    const node = e.bodyNodes?.get(id);
    if (!node?.mesh?.material) { out[id] = { kind: 'missing' }; continue; }
    const mats = [node.mesh.material, node.cloudMesh?.material].filter(Boolean);
    for (let mi = 0; mi < mats.length; mi++) {
      const mat = mats[mi];
      // ShaderMaterial：uniforms 里的全部纹理
      if (mat.uniforms) {
        for (const [k, v] of Object.entries(mat.uniforms)) {
          const val = v?.value;
          if (val && val.isTexture && val.image) {
            const img = val.image;
            const key = `${id}[${mi}].${k}`;
            out[key] = typeof img.toDataURL === 'function'
              ? { kind: 'canvas', w: img.width, h: img.height, sha: await sha(img.toDataURL()) }
              : { kind: 'img', src: String(img.src || '').slice(-60) };
          }
        }
      }
      // MeshStandardMaterial：map
      if (mat.map?.image) {
        const img = mat.map.image;
        const key = `${id}[${mi}].map`;
        out[key] = typeof img.toDataURL === 'function'
          ? { kind: 'canvas', w: img.width, h: img.height, sha: await sha(img.toDataURL()) }
          : { kind: 'img', src: String(img.src || '').slice(-60) };
      }
    }
  }
  return out;
});
await fs.writeFile(`${OUT}/texture-hashes.json`, JSON.stringify(hashes, null, 1));
const canvasCount = Object.values(hashes).filter((v) => v.kind === 'canvas').length;
const imgCount = Object.values(hashes).filter((v) => v.kind === 'img').length;
console.log(`sampled ${Object.keys(hashes).length} texture slots (${canvasCount} canvas-hashed, ${imgCount} img-src) -> ${OUT}/texture-hashes.json`);
await browser.close();
await new Promise((r) => server.httpServer.close(r));
console.log('EQUIV PROBE DONE');
