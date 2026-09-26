import * as THREE from 'three';

export interface SurfaceGrid {
  cols: number; rows: number; lat0: number; lon0: number; dLat: number; dLon: number;
}
export interface GeographicBounds { latMin: number; latMax: number; lonMin: number; lonMax: number }

/** Compute slopes before planet-centred positions lose precision on upload. */
export function computeTerrainNormals(geometry: THREE.BufferGeometry, positions: ArrayLike<number>): void {
  const uploaded = geometry.getAttribute('position');
  geometry.setAttribute('position', new THREE.BufferAttribute(Float64Array.from(positions), 3));
  geometry.computeVertexNormals();
  geometry.setAttribute('position', uploaded);
}

/** Interpolation on the actual grid triangles, also valid for their boundary edges. */
export function sampleSurfaceGrid(geometry: THREE.BufferGeometry, lat: number, lon: number, attribute = 'position'): THREE.Vector3 {
  const g = geometry.userData.surfaceGrid as SurfaceGrid;
  const x = (lon - g.lon0) / g.dLon, y = (lat - g.lat0) / g.dLat;
  if (x < -1e-6 || y < -1e-6 || x > g.cols - 1 + 1e-6 || y > g.rows - 1 + 1e-6) {
    throw new Error('Boundary sample outside displayed grid');
  }
  const cx = THREE.MathUtils.clamp(x, 0, g.cols - 1), cy = THREE.MathUtils.clamp(y, 0, g.rows - 1);
  const col = Math.min(g.cols - 2, Math.floor(cx)), row = Math.min(g.rows - 2, Math.floor(cy));
  const u = cx - col, v = cy - row, a = row * g.cols + col;
  const data = geometry.getAttribute(attribute);
  const p = (i: number) => new THREE.Vector3().fromBufferAttribute(data, i);
  return u + v <= 1
    ? p(a).multiplyScalar(1-u-v).addScaledVector(p(a+1),u).addScaledVector(p(a+g.cols),v)
    : p(a+g.cols+1).multiplyScalar(u+v-1).addScaledVector(p(a+1),1-v).addScaledVector(p(a+g.cols),1-u);
}

/** A display-only transition: both rims exactly follow the meshes they join.
 * Union of boundary directions includes EVERY corner/vertex on both meshes;
 * otherwise connecting samples can cut across a corner and leave a sliver hole.
 */
export function buildTerrainBoundaryBridge(
  inner: THREE.BufferGeometry, outer: THREE.BufferGeometry,
  outerBounds: GeographicBounds, baseRadius: number, rings = 12,
  imageUvAt?: (lat: number, lon: number) => [number, number],
): THREE.BufferGeometry {
  const g = inner.userData.surfaceGrid as SurfaceGrid;
  const latEnd = g.lat0 + (g.rows-1)*g.dLat, lonEnd = g.lon0 + (g.cols-1)*g.dLon;
  const ib = {latMin: Math.min(g.lat0,latEnd), latMax: Math.max(g.lat0,latEnd),
    lonMin: Math.min(g.lon0,lonEnd), lonMax: Math.max(g.lon0,lonEnd)};
  const cLat = (ib.latMin+ib.latMax)/2, cLon = (ib.lonMin+ib.lonMax)/2;
  if (!(outerBounds.latMin < ib.latMin && outerBounds.latMax > ib.latMax &&
    outerBounds.lonMin < ib.lonMin && outerBounds.lonMax > ib.lonMax)) throw new Error('Boundary must enclose terrain');
  const angles: number[] = [];
  const add = (lat: number, lon: number) => angles.push(Math.atan2(lat-cLat, lon-cLon));
  for (let i=0;i<g.cols;i++) { const lon=g.lon0+i*g.dLon; add(ib.latMin,lon);add(ib.latMax,lon); }
  for (let j=0;j<g.rows;j++) { const lat=g.lat0+j*g.dLat; add(lat,ib.lonMin);add(lat,ib.lonMax); }
  const og = outer.userData.surfaceGrid as SurfaceGrid;
  for (let i=0;i<og.cols;i++) { const lon=og.lon0+i*og.dLon;
    if(lon>=outerBounds.lonMin-1e-8&&lon<=outerBounds.lonMax+1e-8) {add(outerBounds.latMin,lon);add(outerBounds.latMax,lon);} }
  for (let j=0;j<og.rows;j++) { const lat=og.lat0+j*og.dLat;
    if(lat>=outerBounds.latMin-1e-8&&lat<=outerBounds.latMax+1e-8) {add(lat,outerBounds.lonMin);add(lat,outerBounds.lonMax);} }
  angles.sort((a,b)=>a-b);
  const directions = angles.filter((a,i)=>i===0||a-angles[i-1]>1e-10);
  if(directions.length>1&&directions.at(-1)!-directions[0]>2*Math.PI-1e-10)directions.pop();
  const at = (b: GeographicBounds, angle: number) => {
    const dx=Math.cos(angle), dy=Math.sin(angle);
    const t=Math.min(Math.abs(dx)<1e-12?Infinity:((dx>0?b.lonMax:b.lonMin)-cLon)/dx,
      Math.abs(dy)<1e-12?Infinity:((dy>0?b.latMax:b.latMin)-cLat)/dy);
    return {lat:cLat+dy*t,lon:cLon+dx*t};
  };
  const radial = (lat:number,lon:number,r:number) => {
    const a=THREE.MathUtils.degToRad(lat), b=THREE.MathUtils.degToRad(lon);
    return new THREE.Vector3(r*Math.cos(a)*Math.cos(b),r*Math.sin(a),-r*Math.cos(a)*Math.sin(b));
  };
  const smooth = (t:number)=>{t=THREE.MathUtils.clamp(t,0,1);return t*t*(3-2*t);};
  const edges = directions.map(angle=>{
    const a=at(ib,angle), b=at(outerBounds,angle);
    return {a,b,p:sampleSurfaceGrid(inner,a.lat,a.lon),q:sampleSurfaceGrid(outer,b.lat,b.lon),
      n:sampleSurfaceGrid(inner,a.lat,a.lon,'normal').normalize(),m:sampleSurfaceGrid(outer,b.lat,b.lon,'normal').normalize()};
  });
  // The collar has no measured DEM. Continuing every tiny edge crater at full
  // amplitude makes kilometre-long radial grooves. Extend progressively lower
  // spatial frequencies with distance, without changing either measured rim.
  // Uniform arc-length resampling avoids bias from the union's irregular spacing.
  const arc=[0];
  for(let i=0;i<edges.length;i++)arc.push(arc[i]+edges[i].p.distanceTo(edges[(i+1)%edges.length].p));
  const length=arc.at(-1)!, bins=2048, heights=new Float64Array(bins);
  let edge=0;
  for(let i=0;i<bins;i++) {
    const distance=length*i/bins;
    while(edge<edges.length-1&&arc[edge+1]<distance)edge++;
    const t=(distance-arc[edge])/Math.max(1e-15,arc[edge+1]-arc[edge]);
    heights[i]=THREE.MathUtils.lerp(edges[edge].p.length()-baseRadius,edges[(edge+1)%edges.length].p.length()-baseRadius,t);
  }
  const meanWidth=edges.reduce((s,e)=>s+e.p.distanceTo(e.q),0)/edges.length;
  const blurredHeights=(distance:number)=>{
    let data=heights;
    const radius=Math.max(1,Math.min(bins/4,Math.round(distance/length*bins)));
    for(let pass=0;pass<3;pass++) {
      const result=new Float64Array(bins);let sum=0;
      for(let j=-radius;j<=radius;j++)sum+=data[(j+bins)%bins];
      for(let i=0;i<bins;i++) {
        result[i]=sum/(radius*2+1);
        sum+=data[(i+radius+1)%bins]-data[(i-radius+bins)%bins];
      }
      data=result;
    }
    return data;
  };
  const positions:number[]=[],uvs:number[]=[],indices:number[]=[],imageUvs:number[]=[],blend:number[]=[];
  const count=edges.length;
  for(let r=0;r<=rings;r++) {
    const t=r/rings,w=smooth(t),filtered=blurredHeights(meanWidth*t*.5);
    for(let k=0;k<count;k++) {
      const e=edges[k],lat=THREE.MathUtils.lerp(e.a.lat,e.b.lat,t),lon=THREE.MathUtils.lerp(e.a.lon,e.b.lon,t);
      const s=arc[k]/length*bins,j=Math.floor(s),fraction=s-j;
      const innerR=e.p.length();
      const h=r===0?innerR-baseRadius:THREE.MathUtils.lerp(filtered[j%bins],filtered[(j+1)%bins],fraction);
      const p=radial(lat,lon,baseRadius+h*(1-w));
      p.addScaledVector(e.p.clone().sub(radial(e.a.lat,e.a.lon,innerR)),1-w);
      p.addScaledVector(e.q.clone().sub(radial(e.b.lat,e.b.lon,baseRadius)),w);
      positions.push(p.x,p.y,p.z);uvs.push((lon+180)/360,(lat+90)/180);
      if(imageUvAt) { imageUvs.push(...imageUvAt(lat,lon)); blend.push(t); }
    }
  }
  for(let r=0;r<rings;r++) for(let k=0;k<count;k++) {
    const a=r*count+k,d=r*count+(k+1)%count,b=a+count,c=d+count;
    indices.push(a,b,d,b,c,d);
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geo.setIndex(indices);
  if(imageUvAt) {
    geo.setAttribute('aBoundaryUv',new THREE.Float32BufferAttribute(imageUvs,2));
    geo.setAttribute('aGrayMix',new THREE.Float32BufferAttribute(blend,1));
  }
  computeTerrainNormals(geo,positions);
  const normals=geo.getAttribute('normal'), v=new THREE.Vector3();
  for(let r=0;r<=rings;r++) for(let k=0;k<count;k++) {
    const t=r/rings,i=r*count+k;
    v.fromBufferAttribute(normals,i);
    // Match measured normals at the seam, but don't drag their crater-scale
    // frequencies over several collar rings (that creates radial light streaks).
    v.lerp(edges[k].n,1-smooth(t*rings)).lerp(edges[k].m,1-smooth((1-t)*4)).normalize();
    normals.setXYZ(i,v.x,v.y,v.z);
  }
  geo.userData.boundaryBridge={rings,perimeter:count,innerBounds:ib,outerBounds};
  geo.computeBoundingSphere();
  return geo;
}
