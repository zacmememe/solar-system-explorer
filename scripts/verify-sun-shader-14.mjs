// Isolated GPU diagnostics, not normal-UI acceptance. Uses the real materials
// and world depth-slice renderer; all browser data remains outside the project.
import fs from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import puppeteer from 'puppeteer-core';

const out=process.env.EVIDENCE_DIR||'D:/solar-evidence/sun-appearance-14/gpu';
await fs.mkdir(out,{recursive:true});
const code=await build({stdin:{resolveDir:process.cwd(),sourcefile:'sun-gpu-fixture.ts',contents:`
import * as THREE from 'three';
import {createSunMaterial,createSunCoronaMaterial} from './src/rendering/SunMaterial';
import {DepthSliceRenderer} from './src/engine/DepthSliceRenderer';
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setSize(512,512);renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.1;renderer.setClearColor(0x000000);
document.body.append(renderer.domElement);
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(45,1,.0003,1e7);camera.position.z=5;
const tex=new THREE.DataTexture(new Uint8Array([128,128,128,255]),1,1);
tex.needsUpdate=true;
const material=createSunMaterial(tex);
const sun=new THREE.Mesh(new THREE.SphereGeometry(1,128,96),material);scene.add(sun);
const halo=new THREE.Mesh(new THREE.PlaneGeometry(4.2,4.2),createSunCoronaMaterial(1/2.1));scene.add(halo);
const foreground=new THREE.Mesh(new THREE.SphereGeometry(1.1,96,64),new THREE.MeshBasicMaterial({color:0x000000}));
foreground.position.z=3;foreground.visible=false;scene.add(foreground);
const slices=new DepthSliceRenderer();const gl=renderer.getContext();const results=[];
function draw(){slices.render(renderer,scene,camera);const pixels=new Uint8Array(512*512*4);gl.readPixels(0,0,512,512,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels;}
function sample(p,x,y=256){let rgb=[0,0,0];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)for(let c=0;c<3;c++)rgb[c]+=p[((y+dy)*512+x+dx)*4+c]/9;return rgb;}
function lum(rgb){return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;}
function check(name,ok,data){results.push({name,pass:ok,...data});if(!ok)throw new Error(name+' '+JSON.stringify(data));}
window.runSolarChecks=()=>{
 try{
  halo.visible=false;const bare=draw();const center=sample(bare,256),limb=sample(bare,378);
  check('resolved limb remains darker than disk centre',lum(center)-lum(limb)>25,{center,limb});
  tex.image.data.set([64,64,64,255]);tex.needsUpdate=true;const dark=sample(draw(),256);
  tex.image.data.set([192,192,192,255]);tex.needsUpdate=true;const bright=sample(draw(),256);
  check('broad source texture stays subtle rather than white continents',lum(bright)-lum(dark)>1&&lum(bright)-lum(dark)<15,{dark,bright});
  tex.image.data.set([128,128,128,255]);tex.needsUpdate=true;
  const surface=draw();
  const spotPixel=new THREE.Vector3(-.70,.30,.64).normalize().project(camera);
  const sx=Math.round((spotPixel.x*.5+.5)*512),sy=Math.round((spotPixel.y*.5+.5)*512);
  const umbra=sample(surface,sx,sy),surround=sample(surface,sx+10,sy);
  check('resolved illustrative sunspot survives tone mapping',lum(surround)-lum(umbra)>40,{umbra,surround});
  material.uniforms.hasSurfaceMap.value=0;material.uniforms.sunTexture.value=null;
  check('missing texture still renders a luminous photosphere',lum(sample(draw(),256))>180,{});
  material.uniforms.hasSurfaceMap.value=1;material.uniforms.sunTexture.value=tex;
  halo.visible=true;const withHalo=draw();
  check('glow cannot wash over opaque photosphere',sample(withHalo,256).every((v,i)=>Math.abs(v-center[i])<=1),{withHalo:sample(withHalo,256),center});
  for(const distance of [20,5,2.7]){
   camera.position.z=distance;const radius=256/(Math.tan(Math.PI/8)*Math.sqrt(distance*distance-1));
   const x=Math.ceil(256+radius+3);const p=draw();const rim=sample(p,x);
   check('glow follows apparent limb at distance '+distance,lum(rim)>5,{distance,radius,rim});
  }
  camera.position.z=5;foreground.visible=true;const blocked=draw();let max=0;
  // This covers the entire solar disk plus its inner glow. Foreground and Sun
  // are in different depth slices, exercising actual far-to-near composition.
  for(let y=116;y<=396;y++)for(let x=116;x<=396;x++)if(Math.hypot(x-256,y-256)<140){const k=(y*512+x)*4;max=Math.max(max,blocked[k],blocked[k+1],blocked[k+2]);}
  check('foreground blocks photosphere and glow across world slices',max<=1,{max,slices:slices.render(renderer,scene,camera)});
  foreground.visible=false;const frozen1=draw();const frozen2=draw();
  check('paused simulation produces identical pixels',frozen1.every((v,i)=>v===frozen2[i]),{});
  check('WebGL error free',gl.getError()===gl.NO_ERROR,{});
  return {result:'PASS',checks:results};
 }catch(e){return {result:'FAIL',failure:String(e),checks:results};}
};
`},bundle:true,format:'iife',platform:'browser',write:false});
let browser;const errors=[];
try{
 browser=await puppeteer.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,userDataDir:path.join(out,'profile'),args:['--use-gl=angle','--use-angle=d3d11']});
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.setContent('<!doctype html><title>Solar shader GPU diagnostic</title>');
 await page.addScriptTag({content:code.outputFiles[0].text});
 const report=await page.evaluate(()=>window.runSolarChecks());report.errors=errors;
 await page.screenshot({path:path.join(out,'gpu-fixture.png')});
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 if(report.result!=='PASS'||errors.length)process.exitCode=1;
}finally{await browser?.close();}
