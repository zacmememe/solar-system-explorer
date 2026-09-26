import fs from 'node:fs/promises';
import path from 'node:path';
const out = 'D:/solar-evidence/vehicle-detail-08';
for (const dir of ['baseline','final','game']) {
  const report = JSON.parse(await fs.readFile(path.join(out,dir,'verification.json'),'utf8'));
  if(report.result!=='PASS')throw new Error(dir+' verification incomplete');
}
const card=(file,caption)=>`<figure><a href="${file}"><img src="${file}" alt="${caption}"></a><figcaption>${caption}</figcaption></figure>`;
const pair=(file)=>`<div class="pair">${card('baseline/'+file,'修改前')}${card('final/'+file,'修改后 · 相同机位与光照')}</div>`;
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ISS舱体与航天飞机伴飞对比</title><style>
*{box-sizing:border-box}body{margin:0;background:#090f15;color:#dce7ed;font:16px/1.8 'Segoe UI','Microsoft YaHei',sans-serif}main{max-width:1560px;margin:auto;padding:40px 28px}h1{font-size:34px;font-weight:450}h2{font-size:23px;font-weight:450}p{color:#a9bdc9;max-width:1120px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0;border:1px solid #2b3f49;background:#111c25;border-radius:8px;overflow:hidden}img{display:block;width:100%}figcaption{padding:12px 18px;font-size:14px}section{margin:32px 0}a{color:#acd4c2}small{color:#9ab8b8;letter-spacing:2px}.tag{display:inline-block;border:1px solid #365b51;border-radius:20px;padding:4px 12px;color:#b9dfcd;font-size:13px}@media(max-width:800px){.pair{grid-template-columns:1fr}main{padding:24px 16px}}
</style><main><small>SOLAR EXPLORER / VEHICLE DETAIL 08</small><h1>舱段有层次，伴飞有方向。</h1><p>ISS 用端锥、连接颈、分块护板、密封圈与凸起扶手，替代等长光滑圆桶。航天飞机从尾部斜后方观察，机鼻朝向星球，保留完整机翼、垂尾与喷管。以下都是实际渲染，可点击图片放大。</p><span class="tag">ISS 已更新本地游戏 · 航天飞机为待接入样机构图</span>
<section><h2>ISS / 看清舱体连接</h2><p>不同舱段有长短和粗细差别；舱端收窄，接口与密封层实际建模。白色防护板采用浅凸曲面，扶手高出表面，避免只在圆桶上画纹理。</p>${pair('iss-detail-front-studio.png')}</section>
<section><h2>ISS / 背面同样成立</h2>${pair('iss-detail-rear-studio.png')}<p>观察舱也由整块蓝色几何体改成带实体框架的六侧窗和中央窗。此模型仍是参考真实结构的程序示意；未宣称精确在轨布局或测量级复刻。</p></section>
<section><h2>航天飞机 / 尾部斜后方</h2><p>只改伴飞展示姿态。源轴向、机库观察方向、模型贴图与装配位置保持不变；这份姿态配置供后续游戏接入沿用。</p>${pair('shuttle-d-formation-front-assisted.png')}</section>
<section><h2>ISS / 当前游戏</h2><div class="pair">${card('game/01-hangar-studio.png','机库 · 新舱体')}${card('game/03-formation-current.png','伴飞 · 新舱体')}</div><p>重新运行原来的「启动太阳系漫游.bat」即可看到ISS更新。上一轮太阳翼修正保留。</p></section>
<p>验证：25项相关测试、生产构建、7组样机前后对照、ISS导出重载与7帧游戏UI流程通过，浏览器错误0。ISS预览绘制次数41→34，三角面2592→25672；不能据此代替完整性能测试。</p><p>结构参考：<a href="https://www.nasa.gov/international-space-station/destiny-laboratory-module/">NASA Destiny</a> · <a href="https://www.nasa.gov/international-space-station/harmony-module/">NASA Harmony</a> · <a href="https://www.nasa.gov/international-space-station/cupola/">NASA Cupola</a>。本轮没有下载或使用这些页面的图片资产。</p></main></html>`;
await fs.writeFile(path.join(out,'ISS舱体与航天飞机伴飞对比.html'),html); console.log(out+'/ISS舱体与航天飞机伴飞对比.html');
