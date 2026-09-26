// Normal UI travel; per-frame read-only geometry and camera diagnostics.
import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const out=process.env.EVIDENCE_DIR||'D:/solar-evidence/navigation-experience';
await mkdir(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless:true,userDataDir:path.join(out,`profile-${process.pid}`),defaultViewport:{width:1440,height:900},
  args:['--use-gl=angle','--use-angle=d3d11'],protocolTimeout:240000});
const page=await browser.newPage(),report={journeys:[],errors:[],consoleErrors:[],violations:[],visualAcceptance:'NOT_OBSERVED'};
page.on('pageerror',e=>report.errors.push(String(e)));
page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let phase='paused';
async function buttonText(text){const h=await page.evaluateHandle(text=>[...document.querySelectorAll('button')].find(b=>b.textContent?.trim()===text || b.getAttribute('aria-label')===text || (text==='减弱动态' && b.textContent?.includes(text))),text);if(!h.asElement())throw new Error('Missing button '+text);await h.asElement().click();await h.dispose();}
async function travel(id,moon=false){
  await page.evaluate(()=>{
    const e=window.__solarEngine,T=window.THREE,rows=[];
    window.__navAudit={rows,stop:false};
    let previous=e.camera.position.clone(),lastQ=e.camera.quaternion.clone(),start=performance.now();
    const sample=()=>{
      const c=e.camera,s=e.getCameraSnapshot();let min=Infinity,nearest=null;
      for(const [id,node] of e.bodyNodes){
        const p=e.getBodyWorldPose(id),ratio=c.position.distanceTo(p.pos)/p.surfaceRadius;
        if(ratio<min){min=ratio;nearest=id;}
      }
      rows.push({ms:performance.now()-start,progress:s.transitionProgress,transition:s.isTransitioning,
        minRatio:min,nearest,position:c.position.toArray(),angle:lastQ.angleTo(c.quaternion),step:previous.distanceTo(c.position)});
      previous.copy(c.position);lastQ.copy(c.quaternion);
      if(!window.__navAudit.stop&&rows.length<2400)requestAnimationFrame(sample);
    };requestAnimationFrame(sample);
  });
  await page.click(`[data-testid="${moon?'moon':'planet'}-btn-${id}"]`);
  await page.waitForFunction(id=>{const s=window.__solarEngine.getCameraSnapshot();return s.navigationBlocked || (s.targetBodyId===id&&!s.isTransitioning);},{timeout:30000},id);
  if(phase==='paused')await delay(250);
  const result=await page.evaluate(id=>{
    const e=window.__solarEngine,T=window.THREE;window.__navAudit.stop=true;
    const node=e.getBodyNode(id),parent=node.data.parentId;
    const planet=parent?e.getBodyWorldPose(parent):null;
    const projected=planet?planet.pos.clone().project(e.camera):null;
    return {id,frames:window.__navAudit.rows,parent,parentNdc:projected?.toArray(),snapshot:e.getCameraSnapshot(),time:e.getSimTimeHours()};
  },id);
  result.phase=phase;report.journeys.push(result);await page.screenshot({path:path.join(out,`${String(report.journeys.length).padStart(2,'0')}-${id}.png`)});
  const worst=result.frames.reduce((a,b)=>a.minRatio<b.minRatio?a:b);
  if(result.snapshot.navigationBlocked)report.violations.push(phase+':'+id+':blocked');
  if(worst.minRatio<.99999)report.violations.push(phase+':'+id+':collision:'+worst.nearest+':'+worst.minRatio);
  if(moon && phase!=='fast' && phase!=='speed-change' && (Math.abs(result.parentNdc[0])>1||Math.abs(result.parentNdc[1])>1||Math.abs(result.parentNdc[2])>1))report.violations.push(phase+':'+id+':parent-not-visible');
  console.log(JSON.stringify({phase,id,minRatio:worst.minRatio,nearest:worst.nearest,maxAngle:Math.max(...result.frames.map(f=>f.angle)),parentNdc:result.parentNdc}));
  await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
}
try{
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:5203',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__solarEngine?.getBodyNode('moon'));
  report.bundle=await page.$$eval('script[src]',xs=>xs.map(x=>x.src));
  // Freeze through UI for reproducible navigation; separate moving-time follow-up below.
  await page.click('[aria-label="暂停模拟"]');
  if(!['edges','visual'].includes(process.env.NAV_CASE))for(const id of ['earth','moon','mars','phobos','deimos','jupiter','io','europa','saturn','titan','enceladus','uranus','neptune','mercury','venus','sun','earth']){
    await travel(id,['moon','phobos','deimos','io','europa','titan','enceladus'].includes(id));
  }
  if(!['main','visual'].includes(process.env.NAV_CASE)) {
    phase='reduced';await buttonText('观测选项');await buttonText('减弱动态');await buttonText('观测选项');
    for(const id of ['mars','phobos','deimos','jupiter','io','saturn','enceladus'])await travel(id,['phobos','deimos','io','enceladus'].includes(id));
    await buttonText('观测选项');await buttonText('减弱动态');await buttonText('观测选项');
    await travel('mars');
    phase='fast';await page.click('[aria-label="调整时间流速"]');await page.click('[data-speed="86400"]');await page.keyboard.press('Escape');
    await page.click('[aria-label="继续模拟"]');
    await travel('phobos',true);await travel('deimos',true);
    phase='speed-change';
    await page.click('[data-testid="moon-btn-phobos"]');await delay(200);await page.click('[aria-label="暂停模拟"]');
    await page.waitForFunction(()=>!window.__solarEngine.getCameraSnapshot().isTransitioning,{timeout:30000});
    await travel('deimos',true);
    phase='portrait';await page.setViewport({width:390,height:844});
    await travel('earth');await travel('moon',true);await travel('mars');await travel('phobos',true);
  }
  if(process.env.NAV_CASE==='visual') {
    phase='paused';await travel('saturn');
    await page.mouse.move(720,440);await page.mouse.wheel({deltaY:-260});await delay(1000);
    for(let i=0;i<4;i++){
      if(i){await page.mouse.move(720,440);await page.mouse.down();await page.mouse.move(850,440+(i%2?70:-70),{steps:30});await page.mouse.up();await delay(200);}
      await page.screenshot({path:path.join(out,'saturn-angle-'+i+'.png')});
    }
    await page.setViewport({width:390,height:844});await travel('earth');await travel('moon',true);await travel('mars');await travel('phobos',true);
  }
  if(report.violations.length||report.errors.length||report.consoleErrors.length)process.exitCode=1;
}catch(e){report.failure=String(e);process.exitCode=1;await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
finally{await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();}
