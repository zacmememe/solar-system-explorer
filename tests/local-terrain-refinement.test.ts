import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {refineTerrainGrid} from '../src/surface/LocalTerrainRefinement';
import {sampleRenderedTerrain,sampleRenderedTerrainSurface} from '../src/surface/RenderedTerrain';
import {JezeroTerrainSource} from '../src/surface/JezeroTerrainSource';
import {LANDING_SITES} from '../src/contracts/landing';

function fixture(invalid=false){
 const cols=11,rows=9,positions:number[]=[],uvs:number[]=[],indices:number[]=[];
 const vertex=(x:number,y:number)=>({position:[x,Math.sin(x*.7)*Math.cos(y*.4)*2,y] as [number,number,number],uv:[x/20,y/24] as [number,number]});
 for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const v=vertex(x*2,y*3);positions.push(...v.position);uvs.push(...v.uv);}
 for(let y=0;y<rows-1;y++)for(let x=0;x<cols-1;x++){const a=y*cols+x,b=a+1,c=a+cols;indices.push(a,c,b,b,c,c+1);}
 const input={positions:Float64Array.from(positions),uvs:Float32Array.from(uvs),indices,cols,rows,stepX:2,stepY:3,centerX:10,centerY:12,halfSamples:3,vertex:invalid?()=>null:vertex};
 const result=refineTerrainGrid(input);
 const geo=new THREE.BufferGeometry();
 if(result){geo.setAttribute('position',new THREE.Float32BufferAttribute(result.positions,3));geo.setAttribute('uv',new THREE.BufferAttribute(result.uvs,2));geo.setIndex(result.indices);geo.userData.localRefinement=result.refinement;}
 geo.userData.surfaceGrid={cols,rows,lon0:0,lat0:0,dLon:2,dLat:3};
 return {input,result,geo};
}

describe('single-surface local source refinement',()=>{
 it('has no internal boundary, duplicate face, degenerate or reversed triangle',()=>{
  const {geo}=fixture(),p=geo.getAttribute('position'),idx=geo.index!.array;
  const edges=new Map<string,number>(),faces=new Set<string>();
  for(let i=0;i<idx.length;i+=3){
   const a=idx[i],b=idx[i+1],c=idx[i+2],key=[a,b,c].sort((a,b)=>a-b).join(',');
   expect(faces.has(key)).toBe(false);faces.add(key);
   const area=(p.getX(b)-p.getX(a))*(p.getZ(c)-p.getZ(a))-(p.getZ(b)-p.getZ(a))*(p.getX(c)-p.getX(a));
   expect(area).toBeLessThan(-1e-8);
   for(const [u,v] of [[a,b],[b,c],[c,a]]){const k=u<v?`${u},${v}`:`${v},${u}`;edges.set(k,(edges.get(k)??0)+1);}
  }
  for(const [key,count] of edges){
   expect(count).toBeLessThanOrEqual(2);
   if(count===1){const [a,b]=key.split(',').map(Number);
    expect((p.getX(a)===0&&p.getX(b)===0)||(p.getX(a)===20&&p.getX(b)===20)||(p.getZ(a)===0&&p.getZ(b)===0)||(p.getZ(a)===24&&p.getZ(b)===24)).toBe(true);
   }
  }
 });
 it('matches independent ray intersections in core, zipper, corners and both boundary sides',()=>{
  const {geo,result}=fixture(),mesh=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));mesh.updateMatrixWorld(true);
  const r=result!.refinement,ray=new THREE.Raycaster(),samples:Array<[number,number]>=[];
  for(let i=0;i<120;i++)samples.push([4+(i*.61803398875%1)*12,5+(i*.41421356237%1)*14]);
  for(const x of [r.outer.x0*2,7,13,r.outer.x1*2])for(const y of [r.outer.y0*3,9,15,r.outer.y1*3])
   for(const d of [-1e-5,0,1e-5])samples.push([x+d,y+d]);
  for(const [x,y] of samples){
   const sample=sampleRenderedTerrain(geo,y,x);expect(sample).not.toBeNull();
   ray.set(new THREE.Vector3(x,20,y),new THREE.Vector3(0,-1,0));const hit=ray.intersectObject(mesh)[0];
   expect(hit).toBeDefined();expect(sample!.distanceTo(hit.point)).toBeLessThan(1e-5);
   const contact=sampleRenderedTerrainSurface(geo,y,x)!;
   const p=geo.getAttribute('position'),face=hit.face!;
   const bary=THREE.Triangle.getBarycoord(hit.point,...[face.a,face.b,face.c].map(k=>new THREE.Vector3().fromBufferAttribute(p,k)) as [THREE.Vector3,THREE.Vector3,THREE.Vector3],new THREE.Vector3())!;
   // On a shared edge either adjacent triangle is a legitimate contact face.
   if(Math.min(bary.x,bary.y,bary.z)>1e-5)expect(Math.abs(contact.normal.dot(face.normal))).toBeCloseTo(1,6);
  }
  expect(sampleRenderedTerrain(geo,0,-.01)).toBeNull();
 });
 it('preserves original buffers on invalid source data and refuses out-of-window cores',()=>{
  const {input,result}=fixture(true);expect(result).toBeNull();expect(input.positions.length).toBe(11*9*3);
  expect(refineTerrainGrid({...fixture().input,centerX:1})).toBeNull();
 });
 it('preserves all outer positions/UVs exactly',()=>{
  const {input,result}=fixture();
  expect(Array.from(result!.positions.slice(0,input.positions.length))).toEqual(Array.from(input.positions));
  expect(Array.from(result!.uvs.slice(0,input.uvs.length))).toEqual(Array.from(input.uvs));
 });
 it('uses existing Gale DEM and improves actual radial clearance without moving the camera',()=>{
  const dir='public/data/dem/gale-hirise-v1/',meta=JSON.parse(readFileSync(dir+'metadata.json','utf8'));
  const bytes=readFileSync(dir+'height.f32'),heights=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);
  const source=new JezeroTerrainSource('gale-murray-buttes','gale-hirise-v1');Object.assign(source,{meta,heights,valid:new Uint8Array(readFileSync(dir+'valid.u8')),datumRadiusM:meta.projection.referenceRadiusM});
  expect(source.datumRadius).toBe(3396190);
  const site=LANDING_SITES['gale-murray-buttes'],radius=2,coarse=source.buildDemWindowGeometry(radius)!;
  const fine=source.buildDemWindowGeometry(radius,512,{lat:site.centerLat,lon:site.centerLon,sizeM:512})!;
  expect(coarse.userData.localRefinement).toBeUndefined();expect(fine.index!.count/3).toBe(583678);
  const lat=THREE.MathUtils.degToRad(site.centerLat),lon=THREE.MathUtils.degToRad(site.centerLon);
  const up=new THREE.Vector3(Math.cos(lat)*Math.cos(lon),Math.sin(lat),-Math.cos(lat)*Math.sin(lon));
  const height=source.sampleHeight(site.centerLat,site.centerLon).heightM,scale=radius/source.datumRadius;
  const origin=up.clone().multiplyScalar(radius+(height+101.7)*scale),ray=new THREE.Raycaster(origin,up.clone().negate());
  const clearance=(geo:THREE.BufferGeometry)=>{const mesh=new THREE.Mesh(geo,new THREE.MeshBasicMaterial());mesh.updateMatrixWorld(true);return ray.intersectObject(mesh)[0].distance/scale-100;};
  const old=clearance(coarse),next=clearance(fine);
  expect(Math.abs(old-1.7)).toBeGreaterThan(.3);expect(Math.abs(next-1.7)).toBeLessThan(.12);
  expect(source.sampleHeight(site.centerLat,site.centerLon).heightM).toBe(height);
  console.log('Gale uploaded-geometry clearance (m)',{old,next,triangles:fine.index!.count/3});
  coarse.dispose();fine.dispose();
 });
});
