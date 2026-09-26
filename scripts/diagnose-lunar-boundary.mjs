// Controlled geometry/normal A/B, NOT a normal-UI acceptance run.
// Arrive via real UI, HOLD + pause time, temporarily restore old geometry/normals,
// then restore the candidate. No camera or lighting edits; each pair records its pose.
import puppeteer from 'puppeteer-core';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const out=process.env.EVIDENCE_DIR||'D:/solar-evidence/lunar-boundary-continuity/controlled';
await mkdir(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless:true,userDataDir:path.join(out,`profile-${process.pid}`),defaultViewport:{width:1440,height:900},args:['--use-gl=angle','--use-angle=d3d11'],protocolTimeout:45000});
const page=await browser.newPage(),report={kind:'CONTROLLED_DIAGNOSTIC_NOT_UI_ACCEPTANCE',frames:[],errors:[],consoleErrors:[]};
page.on('pageerror',e=>report.errors.push(String(e)));
page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
const click=id=>page.click(`[data-testid="${id}"]`),delay=ms=>new Promise(r=>setTimeout(r,ms));
async function shot(name){
  await delay(150);
  const state=await page.evaluate(()=>{const e=window.__solarEngine;return {position:e.camera.position.toArray(),quaternion:e.camera.quaternion.toArray(),simTime:e.getSimTimeHours(),telemetry:e.getLandingTelemetry()};});
  await page.screenshot({path:path.join(out,`${name}.png`)});report.frames.push({name,state});return state;
}
async function pause(){if(await page.$('[aria-label="暂停模拟"]'))await page.click('[aria-label="暂停模拟"]');}
try {
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:5203',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__solarEngine?.getBodyNode('moon'));
  report.bundle=await page.$$eval('script[src]',xs=>xs.map(x=>x.src));
  await click('moon-btn-moon');await page.waitForFunction(()=>!window.__solarEngine.getCameraSnapshot().isTransitioning);
  await page.waitForSelector('[data-testid="landing-site-select"]');await page.select('[data-testid="landing-site-select"]','tranquility-base');
  await page.waitForSelector('[data-testid="lunar-landing-start-btn"]',{timeout:60000});await click('lunar-landing-start-btn');
  await page.waitForFunction(()=>window.__solarEngine.getLandingTelemetry().state==='DESCENDING');
  await page.waitForFunction(()=>window.__solarEngine.getLandingTelemetry().altitudeAGLM<310000,{timeout:100000,polling:100});
  await click('landing-btn-hold');await pause();
  const fixed=await shot('01-boundary-candidate');
  report.geometry=await page.evaluate(()=>{
    const e=window.__solarEngine,s=e.moonSiteStacks.get('tranquility-base');
    const mesh=s.group.getObjectByName('lola-l1-boundary-skirt');
    const candidate=mesh.geometry,b=candidate.userData.boundaryBridge.outerBounds;
    // The exact local radius passed by the builder, not the body's world scale.
    const baseRadius=e.moonBaseRadius;
    const old=s.lola.buildBoundarySkirt(baseRadius,b);
    window.__boundaryDiagnostic={mesh,candidate,old};mesh.geometry=old;
    return {candidateVertices:candidate.getAttribute('position').count,oldVertices:old.getAttribute('position').count,bounds:b,baseRadius};
  });
  const old=await shot('02-boundary-old');
  assert.deepEqual(old.position,fixed.position);assert.deepEqual(old.quaternion,fixed.quaternion);assert.equal(old.simTime,fixed.simTime);
  await page.evaluate(()=>{const d=window.__boundaryDiagnostic;d.mesh.geometry=d.candidate;d.old.dispose();delete window.__boundaryDiagnostic;});
  await click('landing-btn-resume');
  await page.waitForFunction(()=>window.__solarEngine.getLandingTelemetry().state==='SURFACE_LOOK',{timeout:100000,polling:300});
  await pause();
  await page.mouse.move(640,360);await page.mouse.down();await page.mouse.move(640,440,{steps:10});await page.mouse.up();
  const ground=await shot('03-normals-candidate');
  await page.evaluate(()=>{const g=window.__solarEngine.getLunarValleyMesh().geometry;window.__savedNormal=g.getAttribute('normal').clone();g.computeVertexNormals();});
  const coarse=await shot('04-normals-old');
  assert.deepEqual(coarse.position,ground.position);assert.deepEqual(coarse.quaternion,ground.quaternion);assert.equal(coarse.simTime,ground.simTime);
  await page.evaluate(()=>{window.__solarEngine.getLunarValleyMesh().geometry.setAttribute('normal',window.__savedNormal);delete window.__savedNormal;});
  if(process.env.GROUND_ISOLATION==='1') {
    report.groundHits=await page.evaluate(()=>{
      const e=window.__solarEngine,T=window.THREE,ray=new T.Raycaster(),hits=[];
      const meshes=[];e.scene.traverse(o=>{if(o.isMesh&&o.visible)meshes.push(o);});
      for(const y of [300,350,400,450,550]) {
        ray.setFromCamera(new T.Vector2(500/1440*2-1,1-y/900*2),e.camera);
        hits.push({y,hits:ray.intersectObjects(meshes,false).slice(0,4).map(h=>({name:h.object.name,distance:h.distance,face:h.faceIndex,uv:h.uv?.toArray()}))});
      }
      const mat=e.getLunarValleyMesh().material;
      window.__groundMaterial={mat,vertex:mat.vertexShader,fragment:mat.fragmentShader};return hits;
    });
    await page.evaluate(()=>{const d=window.__groundMaterial;d.mat.fragmentShader=d.fragment.replace('vec3 finalColor = litColor * terminator + ambientTerm * (1.0 - terminator * 0.85);','vec3 finalColor = rawTex.rgb;');d.mat.needsUpdate=true;});
    await shot('05-ground-texture-only');
    await page.evaluate(()=>{const d=window.__groundMaterial;d.mat.fragmentShader=d.fragment.replace('vec3 finalColor = litColor * terminator + ambientTerm * (1.0 - terminator * 0.85);','vec3 finalColor = vec3(0.45);');d.mat.needsUpdate=true;});
    await shot('06-ground-constant-color');
    await page.evaluate(()=>{
      const d=window.__groundMaterial;
      d.mat.vertexShader=d.vertex.replace('vWorldPosition = worldPos.xyz;','vWorldPosition = -(modelViewMatrix * vec4(position, 1.0)).xyz;');
      d.mat.fragmentShader=d.fragment.replace('normalize(cameraPosition - vWorldPosition)','normalize(vec3(dot(vWorldPosition, viewMatrix[0].xyz), dot(vWorldPosition, viewMatrix[1].xyz), dot(vWorldPosition, viewMatrix[2].xyz)))');
      d.mat.needsUpdate=true;
    });
    await shot('07-ground-view-relative');
    // On a fixed production build, reintroduce the former world subtraction.
    // This makes the causal comparison reproducible after the fix is committed.
    await page.evaluate(()=>{
      const d=window.__groundMaterial;
      if(d.fragment.includes('inverseTransformDirection(vViewPosition, viewMatrix)')) {
        d.mat.vertexShader=d.vertex.replace('vViewPosition = -viewPos.xyz;','vViewPosition = (modelMatrix * vec4(position, 1.0)).xyz;');
        d.mat.fragmentShader=d.fragment.replace('inverseTransformDirection(vViewPosition, viewMatrix)','normalize(cameraPosition - vViewPosition)');
        d.mat.needsUpdate=true;
      }
    });
    await shot('08-ground-world-subtraction');
    await page.evaluate(()=>{const d=window.__groundMaterial;d.mat.vertexShader=d.vertex;d.mat.fragmentShader=d.fragment;d.mat.needsUpdate=true;delete window.__groundMaterial;});
    for(const {state} of report.frames.slice(2)) {
      assert.deepEqual(state.position,ground.position);assert.deepEqual(state.quaternion,ground.quaternion);assert.equal(state.simTime,ground.simTime);
    }
  }
  report.samePosePairs=true;assert.deepEqual(report.errors,[]);assert.deepEqual(report.consoleErrors,[]);
}catch(e){report.failure=String(e);process.exitCode=1;}
finally{await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({samePosePairs:report.samePosePairs,errors:report.errors,failure:report.failure,geometry:report.geometry}));
