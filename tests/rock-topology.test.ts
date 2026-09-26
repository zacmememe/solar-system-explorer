import { expect, it } from 'vitest';
import * as THREE from 'three';
import { buildRockGeometry, sampleRenderedTerrain } from '../src/surface/ProceduralRockField';

it('rocks rest on rendered triangles, not the bilinear saddle above them',()=>{
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0, 1,0,0, 0,0,1, 1,4,1],3));
  g.userData.surfaceGrid={cols:2,rows:2,lon0:0,lat0:0,dLon:1,dLat:1};
  expect(sampleRenderedTerrain(g,0.5,0.5)?.y).toBe(0); // Bilinear height would be 1.
  expect(sampleRenderedTerrain(g,0.75,0.75)?.y).toBe(2);
  expect(sampleRenderedTerrain(g,2,2)).toBeNull();
  g.dispose();
});

for(const coherent of [false,true]) for(let variant=0;variant<3;variant++) it(`rock variant ${variant}, coherent=${coherent} is a closed outward surface, not disconnected shards`,()=>{
  const g=buildRockGeometry(20260924,variant,coherent), p=g.getAttribute('position');
  const edges=new Map<string,number>();
  const key=(v:THREE.Vector3)=>v.toArray().map(n=>Math.round(n*1e6)).join(',');
  for(let i=0;i<p.count;i+=3) {
    const points=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(p,i+j));
    const normal=points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]));
    expect(normal.dot(points[0])).toBeGreaterThan(0);
    for(let j=0;j<3;j++) {
      const edge=[key(points[j]),key(points[(j+1)%3])].sort().join('|');
      edges.set(edge,(edges.get(edge)??0)+1);
    }
  }
  expect([...edges.values()].filter(count=>count!==2)).toHaveLength(0);
  const normals=new Map<string,THREE.Vector3>();
  for(let i=0;i<p.count;i++) {
    const k=key(new THREE.Vector3().fromBufferAttribute(p,i));
    const n=new THREE.Vector3().fromBufferAttribute(g.getAttribute('normal'),i);
    if(!coherent&&normals.has(k)) expect(n.distanceTo(normals.get(k)!)).toBeLessThan(1e-6);
    expect(n.length()).toBeCloseTo(1,6);
    const a=Math.floor(i/3)*3,pa=new THREE.Vector3().fromBufferAttribute(p,a);
    const face=new THREE.Vector3().fromBufferAttribute(p,a+1).sub(pa).cross(new THREE.Vector3().fromBufferAttribute(p,a+2).sub(pa)).normalize();
    if(coherent)expect(n.dot(face)).toBeGreaterThan(.75); // Mars creases may split normals without turning against the face.
    normals.set(k,n);
  }
  g.dispose();
});
