// Persist exact candidate/file hashes; never infer visual acceptance from screenshots.
import {readFile,mkdir,readdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const candidate='03b6220f2161301c9207f9a110a5b1c38ba5fd54';
const out=process.env.EVIDENCE_DIR||'D:/solar-evidence/mars-materials-body-assets';
const base='b22c76bf1c8b1dea34ec6315a729e1e21e7ecae4';
const hash=b=>createHash('sha256').update(b).digest('hex');
const files=execFileSync('git',['diff','--name-only',base,candidate],{encoding:'utf8'}).trim().split(/\r?\n/);
const manifest={base,candidate,createdAt:new Date().toISOString(),sources:[],bundle:[],runners:[],evidence:[],automatedTests:{files:53,passed:343},visualAcceptance:'See docs/mars-materials-body-assets-report.md; screenshots alone do not grant acceptance',independentApproval:'BLOCKED'};
for(const file of files){
 const disk=await readFile(file),git=execFileSync('git',['show',candidate+':'+file],{maxBuffer:10*1024*1024});
 const binary=file.endsWith('.jpg'),normalize=b=>binary?b:Buffer.from(b.toString('utf8').replaceAll('\r\n','\n'));
 assert.equal(hash(normalize(disk)),hash(normalize(git)),`Source drift: ${file}`);
 manifest.sources.push({file,sha256:hash(disk),gitSha256:hash(git),equalAfterTextLineEndingNormalization:true});
}
for(const file of ['dist/assets/index-DFTktD8V.js','dist/assets/index-CH4BTTPh.css'])manifest.bundle.push({file,sha256:hash(await readFile(file))});
for(const file of ['scripts/verify-mars-materials.mjs','scripts/verify-tethys-asset.mjs','scripts/verify-realism.mjs','scripts/lib/browser-performance.ts','scripts/lib/hud-ui.mjs'])manifest.runners.push({file,sha256:hash(await readFile(file))});
for(const folder of ['frozen-gale','final-surface','tethys-final']){
 const report=JSON.parse(await readFile(path.join(out,folder,'report.json'),'utf8'));
 assert.ok(!report.failure,folder+' failed');assert.equal(report.errors.length,0);
 assert.equal(report.consoleErrors?.length??0,0);assert.equal(report.failedRequests?.length??0,0);
 assert.ok(report.bundle.some(b=>b.endsWith('/index-DFTktD8V.js')),folder+' bundle drift');
 for(const file of await readdir(path.join(out,folder)))if(/\.(png|json)$/.test(file)){
  const bytes=await readFile(path.join(out,folder,file));manifest.evidence.push({file:folder+'/'+file,bytes:bytes.length,sha256:hash(bytes)});
 }
}
await mkdir(out,{recursive:true});await writeFile(path.join(out,'verification-manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({candidate,sourceFiles:manifest.sources.length,images:manifest.evidence.filter(x=>x.file.endsWith('.png')).length,evidenceFiles:manifest.evidence.length}));
