import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import * as THREE from 'three';
import {readFile} from 'node:fs/promises';
import {LolaRegionalSource} from '../src/surface/LolaRegionalSource';
import {TerrainHeightProvider} from '../src/surface/TerrainHeightProvider';
import {buildTerrainBoundaryBridge,computeTerrainNormals,sampleSurfaceGrid} from '../src/surface/TerrainBoundary';

const lola=new LolaRegionalSource();
let inner:THREE.BufferGeometry,outer:THREE.BufferGeometry,bridge:THREE.BufferGeometry;
let bounds:{latMin:number;latMax:number;lonMin:number;lonMax:number};
beforeAll(async()=>{
  vi.stubGlobal('fetch',async(url:string)=>new Response(new Uint8Array(await readFile('public'+url))));
  await lola.load('/data/dem/lola-l1-tranquility-v1');
  inner=lola.buildRegionalGeometry(1)!;
  const holed=TerrainHeightProvider.getInstance().buildHoledMoonSphereGeometry(1,128,64,lola.windowBounds!)!;
  outer=holed.geometry;bounds=holed.holeBounds;
  bridge=buildTerrainBoundaryBridge(inner,outer,bounds,1);
});
afterAll(()=>{vi.unstubAllGlobals();inner.dispose();outer.dispose();bridge.dispose();});

it('reproduces the old ideal-sphere skirt protruding from the displayed globe by hundreds of metres',()=>{
  const old=lola.buildBoundarySkirt(1,bounds)!;
  const pos=old.getAttribute('position'),uv=old.getAttribute('uv');
  let max=0;
  for(let i=pos.count-512;i<pos.count;i++) {
    // UV is stored in Float32, so use a small tolerance near boundary rounding.
    const lat=THREE.MathUtils.clamp(uv.getY(i)*180-90,bounds.latMin,bounds.latMax);
    const lon=THREE.MathUtils.clamp(uv.getX(i)*360-180,bounds.lonMin,bounds.lonMax);
    const p=new THREE.Vector3().fromBufferAttribute(pos,i);
    max=Math.max(max,p.distanceTo(sampleSurfaceGrid(outer,lat,lon))*1737400);
  }
  console.log('old outer skirt maximum displayed-edge mismatch (m)',max);
  expect(max).toBeGreaterThan(300);
  old.dispose();
});

it('joins the actual inner and outer positions and shading normals, with every corner present',()=>{
  const {perimeter:n,rings}=bridge.userData.boundaryBridge;
  const p=bridge.getAttribute('position'),norm=bridge.getAttribute('normal');
  // Every original L1 boundary vertex must be represented in the new inner ring.
  const g=inner.userData.surfaceGrid, source=inner.getAttribute('position');
  const keys=new Set(Array.from({length:n},(_,i)=>[p.getX(i),p.getY(i),p.getZ(i)].join(',')));
  for(let j=0;j<g.rows;j++)for(let i=0;i<g.cols;i++)if(j===0||j===g.rows-1||i===0||i===g.cols-1) {
    const k=j*g.cols+i;
    expect(keys.has([source.getX(k),source.getY(k),source.getZ(k)].join(','))).toBe(true);
  }
  const op=outer.getAttribute('position'),og=outer.userData.surfaceGrid;
  for(const lat of [bounds.latMin,bounds.latMax])for(const lon of [bounds.lonMin,bounds.lonMax]) {
    const row=Math.round((lat-og.lat0)/og.dLat),col=Math.round((lon-og.lon0)/og.dLon);
    const expected=new THREE.Vector3().fromBufferAttribute(op,row*og.cols+col);
    let distance=Infinity;
    for(let k=0;k<n;k++)distance=Math.min(distance,expected.distanceTo(new THREE.Vector3().fromBufferAttribute(p,rings*n+k)));
    expect(distance).toBeLessThan(1e-7);
  }
  // Outer ring segments lie ON a coarse globe edge, rather than merely on its ideal sphere.
  let max=0,normalError=0;
  const edges: {line:THREE.Line3;a:number;b:number}[]=[];
  for(let j=0;j<og.rows;j++)for(let i=0;i<og.cols;i++) {
    const lat=og.lat0+j*og.dLat,lon=og.lon0+i*og.dLon,k=j*og.cols+i;
    if((lat===bounds.latMin||lat===bounds.latMax)&&lon>=bounds.lonMin&&lon<bounds.lonMax)
      edges.push({line:new THREE.Line3(new THREE.Vector3().fromBufferAttribute(op,k),new THREE.Vector3().fromBufferAttribute(op,k+1)),a:k,b:k+1});
    if((lon===bounds.lonMin||lon===bounds.lonMax)&&lat<=bounds.latMax&&lat>bounds.latMin)
      edges.push({line:new THREE.Line3(new THREE.Vector3().fromBufferAttribute(op,k),new THREE.Vector3().fromBufferAttribute(op,k+og.cols)),a:k,b:k+og.cols});
  }
  for(let k=0;k<n;k++) {
    const v=new THREE.Vector3().fromBufferAttribute(p,rings*n+k);
    const best=edges.map(e=>({e,t:e.line.closestPointToPointParameter(v,true)})).sort((a,b)=>
      a.e.line.at(a.t,new THREE.Vector3()).distanceToSquared(v)-b.e.line.at(b.t,new THREE.Vector3()).distanceToSquared(v))[0];
    max=Math.max(max,best.e.line.at(best.t,new THREE.Vector3()).distanceTo(v)*1737400);
    const on=outer.getAttribute('normal');
    const expected=new THREE.Vector3().fromBufferAttribute(on,best.e.a).lerp(new THREE.Vector3().fromBufferAttribute(on,best.e.b),best.t).normalize();
    normalError=Math.max(normalError,expected.distanceTo(new THREE.Vector3().fromBufferAttribute(norm,rings*n+k)));
  }
  console.log('new outer maximum gap (m), normal vector error',max,normalError);
  expect(max).toBeLessThan(.2);expect(normalError).toBeLessThan(1e-5);
});

it('keeps transition triangles outward and nonempty',()=>{
  const p=bridge.getAttribute('position'),ix=bridge.getIndex()!;let count=0,inward=0;
  for(let i=0;i<ix.count;i+=3) {
    const a=new THREE.Vector3().fromBufferAttribute(p,ix.getX(i));
    const b=new THREE.Vector3().fromBufferAttribute(p,ix.getX(i+1)).sub(a);
    const c=new THREE.Vector3().fromBufferAttribute(p,ix.getX(i+2)).sub(a);const n=b.cross(c);
    if(n.lengthSq()<1e-22)continue;
    count++;if(n.dot(a)<0)inward++;
  }
  expect(count).toBeGreaterThan(1000);expect(inward).toBe(0);
});

it('attenuates small edge craters instead of extruding them across the unmeasured collar',()=>{
  const {perimeter:n,rings}=bridge.userData.boundaryBridge,p=bridge.getAttribute('position');
  const variation=(r:number)=>{
    const radii=Array.from({length:n},(_,k)=>new THREE.Vector3().fromBufferAttribute(p,r*n+k).length());
    return Math.sqrt(radii.reduce((sum,h,k)=>sum+(h-radii[(k+1)%n])**2,0)/n);
  };
  const ratio=variation(rings/2)/variation(0);
  console.log('mid-collar small-scale radial variation relative to measured rim',ratio);
  expect(ratio).toBeLessThan(.25);
});

it('avoids false slope bands from Float32 planet-centred position quantization',()=>{
  const positions:number[]=[];const indices:number[]=[];const n=32;
  for(let j=0;j<=n;j++)for(let i=0;i<=n;i++)positions.push(1+i*1e-6,1+j*1e-6,1+(i*.021+j*.033)*1e-6);
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){const a=j*(n+1)+i;indices.push(a,a+1,a+n+1,a+1,a+n+2,a+n+1);}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setIndex(indices);geo.computeVertexNormals();
  const expected=new THREE.Vector3(-.021,-.033,1).normalize();
  const error=()=>{const normals=geo.getAttribute('normal');let e=0;for(let i=0;i<normals.count;i++)e=Math.max(e,expected.angleTo(new THREE.Vector3().fromBufferAttribute(normals,i)));return e*180/Math.PI;};
  const uploaded=geo.getAttribute('position');
  const old=error();computeTerrainNormals(geo,positions);const corrected=error();
  expect(geo.getAttribute('position')).toBe(uploaded); // shading cannot move the displayed terrain
  console.log('flat plane false maximum normal angle (degrees)',old,corrected);
  expect(old).toBeGreaterThan(1);expect(corrected).toBeLessThan(.03);geo.dispose();
});
