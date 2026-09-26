// Normal UI navigation; explicitly labelled diagnostic layer isolation preserves camera/time.
import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const out=process.env.EVIDENCE_DIR||'D:/solar-evidence/mars-materials-body-assets/baseline';
await mkdir(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,userDataDir:path.join(out,'profile-'+process.pid),defaultViewport:{width:1920,height:1080},args:['--use-gl=angle','--use-angle=d3d11'],protocolTimeout:240000});
const page=await browser.newPage(),delay=ms=>new Promise(r=>setTimeout(r,ms));
const report={images:[],isolation:[],errors:[],visualAcceptance:'NOT_OBSERVED',method:'Normal UI travel, descent and HOLD. Diagnostic layer visibility changes only; pose and simulated time are asserted unchanged.'};
page.on('pageerror',e=>report.errors.push(String(e)));
page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
page.on('response',r=>{if(r.status()>=400)report.errors.push(`${r.status()} ${r.url()}`);});
const click=id=>page.click(`[data-testid="${id}"]`);
async function shot(name){const meta=await page.evaluate(()=>{const e=window.__solarEngine;return {position:e.camera.position.toArray(),quaternion:e.camera.quaternion.toArray(),camera:e.getCameraSnapshot(),time:e.getSimTimeHours(),telemetry:e.getLandingTelemetry()};});await page.screenshot({path:path.join(out,name+'.png')});report.images.push({name,...meta});console.log('captured',name);await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));return meta;}
async function drag(dx,dy=0){await page.mouse.move(780,420);await page.mouse.down();await page.mouse.move(780+dx,420+dy,{steps:24});await page.mouse.up();await delay(600);}
try{
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:5206',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__solarEngine?.getBodyNode('moon'));
 report.bundle=await page.$$eval('script[src]',els=>els.map(e=>e.src));
 if(await page.$('[aria-label="暂停模拟"]'))await page.click('[aria-label="暂停模拟"]');
 await click('planet-btn-mars');await page.waitForFunction(()=>{const c=window.__solarEngine.getCameraSnapshot();return c.targetBodyId==='mars'&&!c.isTransitioning;},{timeout:45000});
 await page.waitForSelector('[data-testid="landing-site-select"]');await page.select('[data-testid="landing-site-select"]','gale-murray-buttes');
 await page.waitForFunction(()=>{const a=window.__solarEngine.getLandingAvailability();return a.siteId==='gale-murray-buttes'&&['land','travel-to-site'].includes(a.action);},{timeout:90000});
 await page.waitForSelector('[data-testid="lunar-landing-start-btn"], [data-testid="lunar-landing-travel-site-btn"]');
 if(await page.$('[data-testid="lunar-landing-travel-site-btn"]'))await click('lunar-landing-travel-site-btn');
 await page.waitForSelector('[data-testid="lunar-landing-start-btn"]',{timeout:45000});await click('lunar-landing-start-btn');
 await page.waitForFunction(()=>{const e=window.__solarEngine,t=e.getLandingTelemetry(),a=e.getCameraSnapshot().anchor;return t.state==='DESCENDING'&&a?.kind==='surface'&&a.eyeHeightM<550;},{timeout:160000,polling:50});await click('landing-btn-hold');await delay(800);
 const base=await shot('01-low-hold-normal');
 if(process.env.COMPARE_LEGACY==='1'){
  await page.evaluate(()=>{
   const e=window.__solarEngine,s=e.marsSiteStacks.get('gale-murray-buttes');
   window.__legacyMaterials=[];
   for(const name of ['mola-l1-regional-terrain','mola-l1-boundary-skirt','mola-l1-window-rim']){
    const mesh=s.group.getObjectByName(name),current=mesh.material,old=e.marsMaterial.clone();
    old.uniforms.marsTexture.value=current.map;old.uniforms.marsAirColor.value=e.marsAirColor;
    old.uniforms.marsSunVisibility=e.marsSunVisibility;old.uniforms.layerOpacity.value=current.opacity;
    old.transparent=current.transparent;old.polygonOffset=current.polygonOffset;old.polygonOffsetFactor=current.polygonOffsetFactor;old.polygonOffsetUnits=current.polygonOffsetUnits;
    if(name==='mola-l1-window-rim')old.onBeforeCompile=shader=>{
     shader.vertexShader='attribute float aGrayMix; varying float vGrayMix;\n'+shader.vertexShader.replace('vUv = uv;','vUv=uv; vGrayMix=aGrayMix;');
     shader.uniforms.regolithTint={value:s.terrainMaterial.color};
     shader.fragmentShader='uniform vec3 regolithTint; varying float vGrayMix;\n'+shader.fragmentShader.replace('vec4 texColor = texture2D(marsTexture, vUv);','vec4 texColor=texture2D(marsTexture,vUv); float grayLum=dot(texColor.rgb,vec3(.299,.587,.114)); texColor.rgb=mix(vec3(grayLum)*regolithTint,texColor.rgb,vGrayMix);');
    };
    window.__legacyMaterials.push({mesh,current,old});mesh.material=old;
   }
  });
  try{await delay(500);const legacy=await shot('diag-low-hold-legacy-shading');assert.deepEqual(legacy.position,base.position);assert.deepEqual(legacy.quaternion,base.quaternion);assert.equal(legacy.time,base.time);}
  finally{await page.evaluate(()=>{for(const {mesh,current,old} of window.__legacyMaterials){mesh.material=current;old.dispose();}delete window.__legacyMaterials;});}
 }
 if(process.env.ISOLATE!=='0')for(const name of ['mola-l1-regional-terrain','mola-l1-boundary-skirt','mola-l1-window-rim']){
  const exists=await page.evaluate(name=>{const s=window.__solarEngine.marsSiteStacks.get('gale-murray-buttes'),m=s.group.getObjectByName(name);if(!m)return false;window.__isolatedLayer={m,visible:m.visible};m.visible=false;return true;},name);
  if(!exists){report.isolation.push({name,found:false});continue;}
  try{await delay(300);const frame=await shot('diag-hide-'+name);assert.deepEqual(frame.position,base.position);assert.deepEqual(frame.quaternion,base.quaternion);assert.equal(frame.time,base.time);report.isolation.push({name,found:true,identicalPoseAndTime:true});}
  finally{await page.evaluate(()=>{const {m,visible}=window.__isolatedLayer;m.visible=visible;delete window.__isolatedLayer;});}
 }
 await click('landing-btn-resume');await page.waitForFunction(()=>window.__solarEngine.getLandingTelemetry().state==='SURFACE_LOOK',{timeout:60000});await delay(1600);
 const ground=await shot('02-ground-normal');
 if(process.env.COMPARE_LEGACY==='1'){
  await page.evaluate(()=>{
   const s=window.__solarEngine.marsSiteStacks.get('gale-murray-buttes');window.__legacyRocks=[];
   s.group.traverse(m=>{if(m.name!=='procedural-rockfield-mars')return;const origin=m.position.clone(),array=m.instanceMatrix.array;
    window.__legacyRocks.push({m,origin,array:array.slice()});for(let i=0;i<m.count;i++){array[i*16+12]+=origin.x;array[i*16+13]+=origin.y;array[i*16+14]+=origin.z;}m.position.set(0,0,0);m.instanceMatrix.needsUpdate=true;
   });
  });
  try{await delay(400);const old=await shot('diag-ground-legacy-rock-coordinates');assert.deepEqual(old.position,ground.position);assert.deepEqual(old.quaternion,ground.quaternion);assert.equal(old.time,ground.time);}
  finally{await page.evaluate(()=>{for(const {m,origin,array} of window.__legacyRocks){m.position.copy(origin);m.instanceMatrix.array.set(array);m.instanceMatrix.needsUpdate=true;}delete window.__legacyRocks;});}
 }
 await drag(300);await shot('03-left-normal');await drag(-600);await shot('04-right-normal');await drag(0,-240);await shot('05-sky-normal');
 await click('landing-btn-return-orbit');
 // ORBIT telemetry is set before the final camera transfer begins. Require a
 // stable camera mode too, so we do not mistake the intervening frame for arrival.
 await page.waitForFunction(()=>{
  const e=window.__solarEngine,c=e.getCameraSnapshot();
  const ready=e.getLandingTelemetry().state==='ORBIT'&&c.mode==='ORBIT_TARGET'&&!c.isTransitioning;
  if(!ready){delete window.__returnStableSince;return false;}
  window.__returnStableSince??=performance.now();return performance.now()-window.__returnStableSince>1200;
 },{timeout:60000});
 const returned=await shot('06-returned-normal');assert.equal(returned.camera.isTransitioning,false);
 assert.equal(report.errors.length,0);
}catch(e){report.failure=String(e);process.exitCode=1;await shot('failure').catch(()=>{});}
finally{await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({images:report.images.length,isolation:report.isolation,errors:report.errors,failure:report.failure}));
