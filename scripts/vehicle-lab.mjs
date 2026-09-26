import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repo = fileURLToPath(new URL('../', import.meta.url));
export async function startVehicleLab({ port = 5212, fetchMissing = false } = {}) {
  const modelDir = process.env.VEHICLE_MODEL_DIR || 'D:/solar-evidence/vehicle-lineup-plan/models';
  const manifest = JSON.parse(await fs.readFile(path.join(repo, 'tools/vehicle-lab/assets.json'), 'utf8'));
  const allowed = new Map();
  for (const asset of manifest.assets) {
    const filename = asset.filename || asset.id + '.glb';
    if (path.basename(filename) !== filename) throw new Error('Invalid asset filename');
    const file = path.join(modelDir, filename);
    let bytes;
    try { bytes = await fs.readFile(file); }
    catch (e) {
      if (e.code !== 'ENOENT') throw e;
      if (!fetchMissing) throw new Error('缺少模型 ' + asset.id + '；可运行 npm run vehicles:lab -- --fetch 下载到外部 D 盘缓存。');
      const response = await fetch(asset.url);
      if (!response.ok) throw new Error('下载失败：' + asset.id + ' HTTP ' + response.status);
      bytes = Buffer.from(await response.arrayBuffer());
      if (asset.archiveMember) {
        if (crypto.createHash('sha256').update(bytes).digest('hex') !== asset.archiveSha256) throw new Error('原始归档指纹不符：' + asset.id);
        await fs.mkdir(modelDir, { recursive: true });
        const archive = path.join(modelDir, 'shuttle-source-' + asset.archiveSha256.slice(0, 12) + '.7z');
        try { await fs.writeFile(archive, bytes, { flag: 'wx' }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
        if (crypto.createHash('sha256').update(await fs.readFile(archive)).digest('hex') !== asset.archiveSha256) throw new Error('本地归档指纹不符');
        // Stream the named file to memory, never extract arbitrary archive paths.
        bytes = execFileSync('tar', ['-xOf', archive, asset.archiveMember], { maxBuffer: 20 * 1024 * 1024, windowsHide: true });
      }
      if (crypto.createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('下载内容指纹不符：' + asset.id);
      await fs.mkdir(modelDir, { recursive: true });
      await fs.writeFile(file, bytes, { flag: 'wx' });
    }
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('模型指纹不符：' + asset.id);
    allowed.set('/models/' + filename, file);
  }
  const builder = await build({ entryPoints: [path.join(repo, 'src/vehicles/VehicleMeshBuilder.ts')], bundle: true, write: false, format: 'esm', external: ['three'] });
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg' };
  const server = http.createServer(async (req, res) => {
    try {
      const route = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      res.setHeader('Cache-Control', 'no-store');
      if (route === '/builder.js') { res.setHeader('Content-Type', mime['.js']); res.end(builder.outputFiles[0].text); return; }
      let file = allowed.get(route);
      if (route === '/') file = path.join(repo, 'tools/vehicle-lab/index.html');
      if (!file) for (const [prefix, base] of [['/three/', 'node_modules/three'], ['/draco/', 'public/draco'], ['/lab/', 'tools/vehicle-lab']]) {
        if (!route.startsWith(prefix)) continue;
        const root = path.resolve(repo, base), target = path.resolve(root, route.slice(prefix.length));
        if (target.toLowerCase().startsWith(root.toLowerCase() + path.sep)) file = target;
      }
      if (!file) { res.writeHead(404); res.end('Not found'); return; }
      res.setHeader('Content-Type', mime[path.extname(file).toLowerCase()] || 'application/octet-stream'); res.end(await fs.readFile(file));
    } catch (e) { res.writeHead(e.code === 'ENOENT' ? 404 : 500); res.end('Asset unavailable'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r)), manifest };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lab = await startVehicleLab({ fetchMissing: process.argv.includes('--fetch') }); console.log('载具独立样机：' + lab.url + '（Ctrl+C 退出；不会启动或修改游戏）');
  process.once('SIGINT', async () => { await lab.close(); process.exit(0); });
}
