import {afterEach,expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {JezeroTerrainSource} from '../src/surface/JezeroTerrainSource';
import {MolaRegionalSource} from '../src/surface/MolaRegionalSource';
import {buildTerrainBoundaryBridge,sampleSurfaceGrid} from '../src/surface/TerrainBoundary';

afterEach(()=>vi.unstubAllGlobals());
it.each(['jezero','victoria','gale'])('%s closes the actual MOLA cut edge with matching positions/normals and image UVs',async(site)=>{
  vi.stubGlobal('fetch',async(url:string)=>new Response(new Uint8Array(await readFile('public'+url))));
  const dtm=new JezeroTerrainSource(site,`${site}-hirise-v1`),mola=new MolaRegionalSource();
  await Promise.all([dtm.load(`/data/dem/${site}-hirise-v1`),mola.load(`/data/dem/mola-l1-${site}-v1`)]);
  const wb=dtm.windowBounds!,center=dtm.metaReady!.site;
  const inner=dtm.buildDemWindowGeometry(1,512,site==='gale'?{lat:center.centerLat,lon:center.centerLon,sizeM:512}:undefined)!;
  const outer=mola.buildRegionalGeometry(1,2,{latMin:wb.latMin-.12,latMax:wb.latMax+.12,lonMin:wb.lonMin-.12,lonMax:wb.lonMax+.12})!;
  const bounds=outer.userData.holeBounds,g=outer.userData.surfaceGrid;
  const mpd=dtm.datumRadius*Math.PI/180,cos=Math.cos(center.centerLat*Math.PI/180);
  const uvAt=(lat:number,lon:number):[number,number]=>[(lon-wb.lonMin)*mpd*cos/dtm.uvSpanMeters.x,(wb.latMax-lat)*mpd/dtm.uvSpanMeters.y];
  const bridge=buildTerrainBoundaryBridge(inner,outer,bounds,1,10,uvAt);
  const {rings,perimeter:n}=bridge.userData.boundaryBridge,p=bridge.getAttribute('position'),normal=bridge.getAttribute('normal');
  const imageUv=bridge.getAttribute('aBoundaryUv');
  // Actual cut bounds are grid lines, not the requested geographic rectangle.
  for(const lat of [bounds.latMin,bounds.latMax])expect((lat-g.lat0)/g.dLat).toBeCloseTo(Math.round((lat-g.lat0)/g.dLat),8);
  for(const lon of [bounds.lonMin,bounds.lonMax])expect((lon-g.lon0)/g.dLon).toBeCloseTo(Math.round((lon-g.lon0)/g.dLon),8);
  // Every DTM boundary vertex is present; no long bridge edge can skip a corner.
  const ig=inner.userData.surfaceGrid,ip=inner.getAttribute('position');
  const keys=new Set(Array.from({length:n},(_,k)=>[p.getX(k),p.getY(k),p.getZ(k)].join(',')));
  let missing=0;
  for(let j=0;j<ig.rows;j++)for(let i=0;i<ig.cols;i++)if(!j||!i||j===ig.rows-1||i===ig.cols-1){
    const k=j*ig.cols+i;if(!keys.has([ip.getX(k),ip.getY(k),ip.getZ(k)].join(',')))missing++;
  }
  expect(missing).toBe(0);
  // Sample actual MOLA boundary edges; Float32-upload tolerance < 0.5m at Mars scale.
  let maxGap=0,maxNormalError=0,maxUvError=0;
  const centerLat=(bridge.userData.boundaryBridge.innerBounds.latMin+bridge.userData.boundaryBridge.innerBounds.latMax)/2;
  const centerLon=(bridge.userData.boundaryBridge.innerBounds.lonMin+bridge.userData.boundaryBridge.innerBounds.lonMax)/2;
  for(let k=0;k<n;k++){
    // Boundary image coordinates retain double->Float32 accuracy far better than global UVs.
    const i=rings*n+k,lon=wb.lonMin+imageUv.getX(i)*dtm.uvSpanMeters.x/mpd/cos;
    const lat=wb.latMax-imageUv.getY(i)*dtm.uvSpanMeters.y/mpd;
    const dx=lon-centerLon,dy=lat-centerLat;
    const t=Math.min(Math.abs(dx)<1e-15?Infinity:((dx>0?bounds.lonMax:bounds.lonMin)-centerLon)/dx,
      Math.abs(dy)<1e-15?Infinity:((dy>0?bounds.latMax:bounds.latMin)-centerLat)/dy);
    const edgeLat=centerLat+dy*t,edgeLon=centerLon+dx*t;
    const actual=new THREE.Vector3().fromBufferAttribute(p,i),expected=sampleSurfaceGrid(outer,edgeLat,edgeLon);
    maxGap=Math.max(maxGap,actual.distanceTo(expected)*dtm.datumRadius);
    maxNormalError=Math.max(maxNormalError,new THREE.Vector3().fromBufferAttribute(normal,i).distanceTo(sampleSurfaceGrid(outer,edgeLat,edgeLon,'normal').normalize()));
    const uv=uvAt(edgeLat,edgeLon);maxUvError=Math.max(maxUvError,Math.abs(uv[0]-imageUv.getX(i)),Math.abs(uv[1]-imageUv.getY(i)));
  }
  expect(maxGap).toBeLessThan(.5);expect(maxNormalError).toBeLessThan(1e-5);expect(maxUvError).toBeLessThan(1e-5);
  const ix=bridge.getIndex()!;let inward=0;
  for(let k=0;k<ix.count;k+=3){const a=new THREE.Vector3().fromBufferAttribute(p,ix.getX(k));
    const b=new THREE.Vector3().fromBufferAttribute(p,ix.getX(k+1)).sub(a),c=new THREE.Vector3().fromBufferAttribute(p,ix.getX(k+2)).sub(a);
    if(b.cross(c).dot(a)<-1e-18)inward++;
  }
  expect(inward).toBe(0);
  console.log(site,{maxGapM:maxGap,maxNormalError,missing,inward});
  inner.dispose();outer.dispose();bridge.dispose();
});
