import {readFile,readdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
const base='4e9019a61da59e1216905d15286cc2b0f28aa23d';
const candidate='281e65d7ee7646b405bbe8fe41c91ca0133b867b';
const root='D:/solar-evidence/vehicle-space-only';
const hash=x=>createHash('sha256').update(x).digest('hex');
const normalize=x=>x.toString('utf8').replace(/\r\n/g,'\n');
const sourceFiles=[];
for(const file of execFileSync('git',['diff','--name-only',base,candidate],{encoding:'utf8'}).trim().split('\n')){
 const frozen=normalize(execFileSync('git',['show',`${candidate}:${file}`]));
 if(hash(frozen)!==hash(normalize(await readFile(file))))throw Error('Source drift '+file);
 sourceFiles.push({file,sha256:hash(frozen),textNormalization:'LF'});
}
const evidenceFiles=[];
for(const dir of ['baseline','final','final-confirmed'])for(const entry of await readdir(path.join(root,dir),{withFileTypes:true})){
 if(!entry.isFile()||! /\.(png|json)$/.test(entry.name))continue;
 const file=path.join(root,dir,entry.name),bytes=await readFile(file);evidenceFiles.push({file,bytes:bytes.length,sha256:hash(bytes)});
}
const report=JSON.parse(await readFile(path.join(root,'final-confirmed/report.json'),'utf8'));
if(report.failure||report.errors.length||report.images.length!==10||!report.bundle.some(b=>b.endsWith('index-CKfEZ_r-.js')))throw Error('Final evidence mismatch');
const productionBundles=[];
for(const name of ['index-CKfEZ_r-.js','index-CH4BTTPh.css']){
 const file='dist/assets/'+name;productionBundles.push({file,sha256:hash(await readFile(file))});
}
await writeFile(path.join(root,'verification-manifest.json'),JSON.stringify({base,candidate,sourceFiles,productionBundles,evidenceFiles,independentApproval:'BLOCKED',visualScope:'See docs/vehicle-space-only-report.md; author screenshots are not independent approval.'},null,2));
console.log(JSON.stringify({candidate,sources:sourceFiles.length,evidence:evidenceFiles.length}));
