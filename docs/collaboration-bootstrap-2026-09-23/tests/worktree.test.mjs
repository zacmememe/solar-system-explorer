/** All repositories and remotes below are NEW disposable fixtures. No real repo is read or written. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Git for Windows rejects Node's os.devNull (\\.\nul) as a config path.
// Use a real, empty disposable file; never read or modify the user's config.
const emptyGlobalConfig = path.join(os.tmpdir(), `solar-worktree-global-${process.pid}.gitconfig`);
fs.writeFileSync(emptyGlobalConfig, '', { flag: 'wx' });
after(() => fs.unlinkSync(emptyGlobalConfig));

function cmd(cwd,args,ok=true) {
 const r=spawnSync('git',args,{cwd,encoding:'utf8',env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:emptyGlobalConfig,GIT_TERMINAL_PROMPT:'0'}});
 if(ok && r.status!==0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
 return r;
}
function fixture(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'solar-worktree-lab-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const repo=path.join(root,'repo');fs.mkdirSync(repo);
 cmd(repo,['init','-b','main']);cmd(repo,['config','user.name','Disposable Test']);cmd(repo,['config','user.email','fixture@example.invalid']);
 fs.writeFileSync(path.join(repo,'distance.mjs'),'export const radius = 6371; // kilometers\n');
 fs.writeFileSync(path.join(repo,'label.mjs'),"import {radius} from './distance.mjs';\nconsole.log(`${radius} km`);\n");
 cmd(repo,['add','distance.mjs','label.mjs']);cmd(repo,['commit','-m','fixture base']);
 const base=cmd(repo,['rev-parse','HEAD']).stdout.trim();
 const add=(name)=>{const p=path.join(root,name);cmd(repo,['worktree','add','-b',`task/${name}`,p,base]);return p};
 return {root,repo,base,add};
}
function commit(repo,file,content,message){fs.writeFileSync(path.join(repo,file),content);cmd(repo,['add',file]);cmd(repo,['commit','-m',message]);return cmd(repo,['rev-parse','HEAD']).stdout.trim()}

test('separate worktree edits and index do not modify sibling',t=>{const f=fixture(t);const z=f.add('zcode'),a=f.add('anti');fs.writeFileSync(path.join(z,'distance.mjs'),'draft');cmd(z,['add','distance.mjs']);assert.match(cmd(z,['status','--porcelain']).stdout,/distance/);assert.equal(cmd(a,['status','--porcelain']).stdout,'');assert.match(fs.readFileSync(path.join(a,'distance.mjs'),'utf8'),/6371/)});
test('same checked-out branch cannot be opened twice without override',t=>{const f=fixture(t);f.add('zcode');const r=cmd(f.repo,['worktree','add',path.join(f.root,'duplicate'),'task/zcode'],false);assert.notEqual(r.status,0)});
test('branch refs are shared even when files are separate',t=>{const f=fixture(t);const z=f.add('zcode'),a=f.add('anti');const head=commit(z,'distance.mjs','export const radius=6372;\n','changed');assert.equal(cmd(a,['rev-parse','task/zcode']).stdout.trim(),head);assert.match(fs.readFileSync(path.join(a,'distance.mjs'),'utf8'),/6371/)});
test('detached review stays at frozen commit while author branch advances',t=>{const f=fixture(t);const z=f.add('zcode');const review=path.join(f.root,'review');cmd(f.repo,['worktree','add','--detach',review,f.base]);commit(z,'distance.mjs','export const radius=99;\n','new change');assert.equal(cmd(review,['rev-parse','HEAD']).stdout.trim(),f.base);assert.match(fs.readFileSync(path.join(review,'distance.mjs'),'utf8'),/6371/)});
test('textually clean merge can contain a unit/meaning conflict',t=>{const f=fixture(t);const z=f.add('zcode'),a=f.add('anti'),i=f.add('integration');commit(z,'distance.mjs','export const radius = 6371000; // meters, new contract\n','change unit');commit(a,'label.mjs',"import {radius} from './distance.mjs';\nconsole.log(`${radius.toFixed(1)} km`);\n",'polish label');cmd(i,['merge','--no-ff','task/zcode','-m','integrate math']);cmd(i,['merge','--no-ff','task/anti','-m','integrate display']);const r=spawnSync(process.execPath,['label.mjs'],{cwd:i,encoding:'utf8'});assert.equal(r.status,0);assert.equal(r.stdout.trim(),'6371000.0 km');assert.notEqual(r.stdout.trim(),'6371.0 km');assert.equal(cmd(i,['status','--porcelain']).stdout,'')});
test('ordinary push rejects divergent newer main without force',t=>{const f=fixture(t);const remote=path.join(f.root,'remote.git');cmd(f.root,['init','--bare',remote]);cmd(f.repo,['remote','add','origin',remote]);cmd(f.repo,['push','origin','main']);const i=f.add('integration');commit(i,'label.mjs',"console.log('candidate');\n",'candidate');commit(f.repo,'distance.mjs','export const radius=12;\n','new main work');cmd(f.repo,['push','origin','main']);const r=cmd(i,['push','origin','HEAD:refs/heads/main'],false);assert.notEqual(r.status,0)});
test('exclusive filesystem integration lease refuses second holder',t=>{const f=fixture(t);const lock=path.join(f.root,'integration.lock');const first=fs.openSync(lock,'wx');assert.throws(()=>fs.openSync(lock,'wx'),{code:'EEXIST'});fs.closeSync(first);fs.unlinkSync(lock);const next=fs.openSync(lock,'wx');fs.closeSync(next)});
test('git worktree lock is NOT an editing lock',t=>{const f=fixture(t);const z=f.add('zcode');cmd(f.repo,['worktree','lock',z]);const head=commit(z,'distance.mjs','export const radius=17;\n','still editable');assert.notEqual(head,f.base);cmd(f.repo,['worktree','unlock',z])});
test('creating a sibling leaves dirty original files intact',t=>{const f=fixture(t);fs.writeFileSync(path.join(f.repo,'distance.mjs'),'do not lose active draft\n');fs.writeFileSync(path.join(f.repo,'untracked.txt'),'local work\n');const before=cmd(f.repo,['status','--porcelain']).stdout;f.add('isolated');assert.equal(fs.readFileSync(path.join(f.repo,'distance.mjs'),'utf8'),'do not lose active draft\n');assert.equal(cmd(f.repo,['status','--porcelain']).stdout,before)});
