import * as THREE from 'three';
import type {LocalRefinement} from './LocalTerrainRefinement';

/** Sample uploaded triangle positions; scientific source DEM sampling remains independent. */
export function sampleRenderedTerrain(geometry:THREE.BufferGeometry,lat:number,lon:number):THREE.Vector3|null {
  return sampleRenderedTerrainSurface(geometry,lat,lon)?.position ?? null;
}

/** Uploaded triangle contact, including its geometric (not smoothed lighting) normal. */
export function sampleRenderedTerrainSurface(geometry:THREE.BufferGeometry,lat:number,lon:number):{position:THREE.Vector3;normal:THREE.Vector3}|null {
  const grid=geometry.userData.surfaceGrid;
  if(!grid)return null;
  let x=(lon-grid.lon0)/grid.dLon,y=(lat-grid.lat0)/grid.dLat;
  const eps=1e-7;
  if(!Number.isFinite(x)||!Number.isFinite(y)||x < -eps||y < -eps||x>grid.cols-1+eps||y>grid.rows-1+eps)return null;
  x=Math.max(0,Math.min(grid.cols-1,x));y=Math.max(0,Math.min(grid.rows-1,y));
  const p=geometry.getAttribute('position');
  const mix=(a:number,b:number,c:number,u:number,v:number)=>{
    const pa=new THREE.Vector3().fromBufferAttribute(p,a),pb=new THREE.Vector3().fromBufferAttribute(p,b),pc=new THREE.Vector3().fromBufferAttribute(p,c);
    const position=pa.clone().multiplyScalar(1-u-v).addScaledVector(pb,u).addScaledVector(pc,v);
    const normal=pb.sub(pa).cross(pc.sub(pa)).normalize();
    if(normal.dot(position)<0)normal.negate();
    return {position,normal};
  };
  function sampleGrid(x:number,y:number,cols:number,rows:number,offset=0){
    const col=Math.min(cols-2,Math.max(0,Math.floor(x))),row=Math.min(rows-2,Math.max(0,Math.floor(y)));
    const u=x-col,v=y-row,a=offset+row*cols+col;
    return u+v<=1?mix(a,a+1,a+cols,u,v):mix(a+cols+1,a+1,a+cols,1-v,1-u);
  }
  const refined=geometry.userData.localRefinement as LocalRefinement|undefined;
  if(refined){
    const {core,outer}=refined,fx=(x-core.x0)/core.dx,fy=(y-core.y0)/core.dy;
    if(fx>=0&&fy>=0&&fx<=core.cols-1&&fy<=core.rows-1)return sampleGrid(fx,fy,core.cols,core.rows,core.offset);
    if(x>=outer.x0&&x<=outer.x1&&y>=outer.y0&&y<=outer.y1){
      const coord=(id:number)=>id<core.offset ? [id%grid.cols,Math.floor(id/grid.cols)]
        : [core.x0+(id-core.offset)%core.cols*core.dx,core.y0+Math.floor((id-core.offset)/core.cols)*core.dy];
      for(const t of refined.bandCells[`${Math.min(grid.cols-2,Math.floor(x))},${Math.min(grid.rows-2,Math.floor(y))}`]??[]){
        const [a,b,c]=refined.bandTriangles.slice(t,t+3),[ax,ay]=coord(a),[bx,by]=coord(b),[cx,cy]=coord(c);
        const det=(bx-ax)*(cy-ay)-(cx-ax)*(by-ay);
        const u=((x-ax)*(cy-ay)-(cx-ax)*(y-ay))/det,v=((bx-ax)*(y-ay)-(x-ax)*(by-ay))/det;
        if(u>=-eps&&v>=-eps&&u+v<=1+eps)return mix(a,b,c,u,v);
      }
      return null; // Never sample a removed coarse triangle in the transition band.
    }
  }
  return sampleGrid(x,y,grid.cols,grid.rows);
}

export function renderedTerrainBounds(geometry:THREE.BufferGeometry){
  const g=geometry.userData.surfaceGrid;
  if(!g)throw new Error('Terrain grid metadata is required for a continuous seam');
  const latEnd=g.lat0+(g.rows-1)*g.dLat,lonEnd=g.lon0+(g.cols-1)*g.dLon;
  return {latMin:Math.min(g.lat0,latEnd),latMax:Math.max(g.lat0,latEnd),lonMin:Math.min(g.lon0,lonEnd),lonMax:Math.max(g.lon0,lonEnd)};
}
