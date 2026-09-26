// Import already-reviewed local derivatives; never fetch or silently replace sources.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const source='D:/solar-evidence/vehicle-preflight-06',dest='public/assets/models/selected';
const packages=JSON.parse(await fs.readFile(path.join(source,'verification.json'),'utf8')).packages;
const ids=['cassini','voyager-1','juno','space-shuttle'];
const hashes=['52c0211f47ebe0bbd6304672d3642ab74ff348097b1caf37d30ead47561b7cc5','5c83c0af8a7ef08f992caac3572b02c98156f25be94445982d7e2f21d627055b','7e16e9494fe65c3c4ac058a65a02cf0f890f3c613a1d3c051597337b123b5af4','948ccb7e7a15f830eff9029f8f8dd993b99f4d50d31e96dc53533085d8a0a221'];
const manifest={license:'NASA Media Usage Guidelines',licenseUrl:'https://www.nasa.gov/nasa-brand-center/images-and-media/',derivedFrom:'F-VEHICLE-PREFLIGHT-06',calibratedMetres:false,independentApproval:false,
  modifications:'Source orientation and centering baked once. Cassini foil roughness/normal amplitude adjusted. Juno solar panels nonmetallic approximation. Shuttle doors and five engine parts assembled with embedded source textures. Formation pose is runtime-only.',
  packages:[]};
await fs.mkdir(dest,{recursive:true});
for(const [i,id] of ids.entries()){
 const bytes=await fs.readFile(path.join(source,'models',id+'.glb'));
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),hashes[i]);
 const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
 assert(!(json.images||[]).some(x=>x.uri));assert(!(json.buffers||[]).some(x=>x.uri));
 const p=packages.find(p=>p.id===id);assert(p,`missing provenance ${id}`);
 await fs.writeFile(path.join(dest,id+'.glb'),bytes);
 manifest.packages.push({id,file:id+'.glb',bytes:bytes.length,sha256:hashes[i],sourceAssets:p.sourceAssets});
}
await fs.writeFile(path.join(dest,'provenance.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(manifest.packages.map(({id,bytes})=>({id,bytes})));
