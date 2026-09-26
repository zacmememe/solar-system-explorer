// Production preview ownership lives here; each normal-UI browser closes itself.
import {preview} from 'vite';
import {spawn} from 'node:child_process';
const root=process.env.EVIDENCE_DIR||'D:/solar-evidence/hud-classic-a-17';
const server=await preview({preview:{host:'127.0.0.1',port:0,open:false}});
const run=(script,env)=>new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[script],{stdio:'inherit',env:{...process.env,TEST_URL:server.resolvedUrls.local[0],...env}});
 child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`${script} exited ${code}`)));
});
try{
 for(const [name,site] of [['moon','tranquility-base'],['mars','jezero']])await run('scripts/verify-hud-phases.mjs',{EVIDENCE_DIR:`${root}/${name}`,SITE_ID:site});
 await run('scripts/verify-hud-arc-controls.mjs',{EVIDENCE_DIR:`${root}/site-travel`});
}finally{await new Promise(resolve=>server.httpServer.close(resolve));}
