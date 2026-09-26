import fs from 'node:fs/promises';
import path from 'node:path';
const out = process.env.EVIDENCE_DIR || 'D:/solar-evidence/iss-solar-07';
for (const dir of ['final', 'game']) {
  const report = JSON.parse(await fs.readFile(path.join(out, dir, 'verification.json'), 'utf8'));
  if (report.result !== 'PASS') throw new Error(dir + ' verification not complete');
}
const card = (file, text) => `<figure><a href="${file}"><img src="${file}" alt="${text}"></a><figcaption>${text}</figcaption></figure>`;
const pair = (title, before, after) => `<section><h2>${title}</h2><div class="pair">${card(before, '修复前 · 相同机位与光照')}${card(after, '修复后 · 仅调整电池片材质')}</div></section>`;
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ISS 太阳翼修复对比</title><style>
*{box-sizing:border-box}body{margin:0;background:#090f15;color:#dce7ed;font:16px/1.8 'Segoe UI','Microsoft YaHei',sans-serif}main{max-width:1560px;margin:auto;padding:40px 28px}h1{font-size:34px;font-weight:450}h2{font-size:23px;font-weight:450}p{color:#a9bdc9;max-width:1060px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0;border:1px solid #2b3f49;background:#111c25;border-radius:8px;overflow:hidden}img{display:block;width:100%}figcaption{padding:12px 18px;font-size:14px}section{margin:30px 0}a{color:#acd4c2}small{color:#9ab8b8;letter-spacing:2px}@media(max-width:800px){.pair{grid-template-columns:1fr}main{padding:24px 16px}}
</style><main><small>SOLAR EXPLORER / ISS 07</small><h1>受光时看清电池片，背光仍然暗。</h1><p>ISS 太阳翼原来接近纯金属，深色电池片的漫反射被压低。现在只调整电池表面材质，保留程序纹理、灯光、曝光和几何。已进入本地游戏构建，重新运行原启动 BAT 可使用。它仍是程序模型，不是实测材质复原。</p>
${pair('游戏内伴飞', 'game/04-formation-legacy-diagnostic.png', 'game/03-formation-current.png')}
<p>通过正常机库选择到达伴飞。左图临时恢复旧金属度作诊断，右图为当前材质；相机、模拟时间和灯光均核对一致，诊断后已恢复。点击任意图片查看原图。</p>
${pair('单太阳正面受光', 'final/inspect-space-front-front-before.png', 'final/inspect-space-front-front-after.png')}
<section><h2>光向与表面保持一致</h2><div class="pair">${card('final/inspect-space-back-front-after.png', '修复后 · 正面处于背光，保持暗部')}${card('final/inspect-space-back-rear-after.png', '修复后 · 转到受光的背面，片格可见')}</div></section>
<section><h2>机库中查看</h2><div class="pair">${card('game/01-hangar-studio.png', '当前游戏 · 工坊光')}${card('game/02-hangar-orbit.png', '当前游戏 · 在轨日光')}</div></section>
<p>构建、23项相关测试、样机5组对照、游戏7帧流程取证通过，浏览器错误0。图像已作定向目视；不代表整体游戏体验或所有载具已验收。报告：docs/iss-solar-material-report.md。</p></main></html>`;
await fs.writeFile(path.join(out, 'ISS太阳翼修复对比.html'), html.replace('<h1>', '<p>后续舱体细化见 <a href="../vehicle-detail-08/ISS舱体与航天飞机伴飞对比.html">第08轮最新对照</a>；本页保留太阳翼修正时的历史证据。</p><h1>'));
console.log(path.join(out, 'ISS太阳翼修复对比.html'));
