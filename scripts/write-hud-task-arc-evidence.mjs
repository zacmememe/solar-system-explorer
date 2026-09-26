import {readFile,readdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
const base='56f94e697845a61a4015a4561d28192807c39c25',candidate='c2bc98e4e17e417bbe16cc67d29399898244360a';
const root='D:/solar-evidence/hud-task-arc',hash=x=>createHash('sha256').update(x).digest('hex'),normalize=x=>x.toString('utf8').replace(/\r\n/g,'\n');
const sourceFiles=[];
for(const file of execFileSync('git',['diff','--name-only',base,candidate],{encoding:'utf8'}).trim().split('\n')){
 const frozen=normalize(execFileSync('git',['show',`${candidate}:${file}`]));
 if(hash(frozen)!==hash(normalize(await readFile(file))))throw Error('Source drift '+file);
 sourceFiles.push({file,sha256:hash(frozen),textNormalization:'LF'});
}
const evidenceFiles=[];
for(const dir of ['iteration1','final-mars','final-moon','final-controls']){
 if(dir.startsWith('final')){
  const report=JSON.parse(await readFile(path.join(root,dir,'report.json'),'utf8'));
  if(report.failure||report.errors.length||report.consoleErrors?.length||report.httpErrors?.length||report.checks.some(c=>c.pass===false)||!report.bundle.some(b=>b.endsWith('index-p3DVOu2K.js')))throw Error('Evidence mismatch '+dir);
 }
 for(const entry of await readdir(path.join(root,dir),{withFileTypes:true})){
  if(!entry.isFile()||! /\.(png|json)$/.test(entry.name))continue;
  const file=path.join(root,dir,entry.name),bytes=await readFile(file);evidenceFiles.push({file,bytes:bytes.length,sha256:hash(bytes)});
 }
}
const productionBundles=[];
for(const name of ['index-p3DVOu2K.js','index-CTwyNB9b.css']){
 const file='dist/assets/'+name;productionBundles.push({file,sha256:hash(await readFile(file))});
}
await writeFile(path.join(root,'verification-manifest.json'),JSON.stringify({base,candidate,sourceFiles,productionBundles,evidenceFiles,independentApproval:'BLOCKED',visualScope:'See docs/hud-task-arc-report.md; not a terrain or independent acceptance.'},null,2));
console.log(JSON.stringify({candidate,sources:sourceFiles.length,evidence:evidenceFiles.length}));
