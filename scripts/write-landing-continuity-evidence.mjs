import {readFile,readdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
const base='e38620d522ecfdee8b1b0a28ad0ea6dd9a286a03';
const candidate='aa8d9d4a2a3c7cc66a5b7dc2d58f7c7de5b08881';
const root='D:/solar-evidence/landing-continuity';
const hash=x=>createHash('sha256').update(x).digest('hex');
const normalize=x=>x.toString('utf8').replace(/\r\n/g,'\n');
const sourceFiles=[];
for(const file of execFileSync('git',['diff','--name-only',base,candidate],{encoding:'utf8'}).trim().split('\n')){
 const frozen=normalize(execFileSync('git',['show',`${candidate}:${file}`]));const actual=normalize(await readFile(file));
 if(hash(frozen)!==hash(actual))throw Error('Source drift '+file);
 sourceFiles.push({file,sha256:hash(frozen),textNormalization:'LF'});
}
const evidenceFiles=[];
for(const dir of ['baseline','final','final-daylight-controls'])for(const entry of await readdir(path.join(root,dir),{withFileTypes:true})){
 if(!entry.isFile()||! /\.(png|json)$/.test(entry.name))continue;
 const file=path.join(root,dir,entry.name),bytes=await readFile(file);evidenceFiles.push({file,bytes:bytes.length,sha256:hash(bytes)});
}
const productionBundles=[];for(const name of ['index-VtXa3VT5.js','index-CH4BTTPh.css']){
 const file='dist/assets/'+name,bytes=await readFile(file);productionBundles.push({file,sha256:hash(bytes)});
}
for(const dir of ['final','final-daylight-controls']){
 const report=JSON.parse(await readFile(path.join(root,dir,'report.json'),'utf8'));
 if(report.failure||report.errors?.length||!report.bundle?.some(b=>b.endsWith('index-VtXa3VT5.js')))throw Error('Evidence mismatch '+dir);
}
await writeFile(path.join(root,'verification-manifest.json'),JSON.stringify({base,candidate,sourceFiles,productionBundles,evidenceFiles,independentApproval:'BLOCKED',visualScope:'See docs/landing-continuity-report.md; automation is not visual acceptance.'},null,2));
console.log(JSON.stringify({candidate,sources:sourceFiles.length,evidence:evidenceFiles.length}));
