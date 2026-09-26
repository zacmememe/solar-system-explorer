import {readFile,writeFile,mkdir} from 'node:fs/promises';
const root='D:/solar-evidence/hud-directions';
const backgrounds={};
for(const state of ['orbit','descent','ground'])for(const suffix of ['','-current']){
 const name=state+suffix;const bytes=await readFile(`${root}/backgrounds/${name}.jpg`);backgrounds[name]='data:image/jpeg;base64,'+bytes.toString('base64');
}
await mkdir(root,{recursive:true});
const html=(await readFile('docs/design/hud-directions/index.template.html','utf8')).replace('__BACKGROUNDS__',JSON.stringify(backgrounds));
await writeFile(`${root}/HUD方案对比.html`,html);console.log(`${root}/HUD方案对比.html (${(Buffer.byteLength(html)/1024/1024).toFixed(1)} MB, offline, embedded backgrounds)`);
