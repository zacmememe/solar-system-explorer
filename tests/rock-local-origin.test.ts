import {expect,it} from 'vitest';
import * as THREE from 'three';
import {buildRockGeometry,composeLocalRockMatrix,rockScenePosition,type RockPlacement} from '../src/surface/ProceduralRockField';

// Reproduce instanceMatrix*vertex in Float32, before camera subtraction.
function gpuPoint(p: THREE.Vector3,m: THREE.Matrix4) {
 const a=m.elements.map(Math.fround),v=p.toArray().map(Math.fround),f=Math.fround;
 return new THREE.Vector3(...[0,1,2].map(r=>f(f(f(f(a[r]*v[0])+f(a[4+r]*v[1]))+f(a[8+r]*v[2]))+a[12+r])));
}

it('aligns the rock base and embedded offset to the actual sloping triangle, without planet-scale float translations',()=>{
 const ground=new THREE.Vector3(0,1,0),normal=new THREE.Vector3(.3,1,.2).normalize();
 const p:RockPlacement={latDeg:0,lonDeg:0,heightM:0,scaleM:[.8,.4,.7],rotYRad:.8,variant:1};
 const metric=1/3396000,m=composeLocalRockMatrix(ground,p,metric,ground,new THREE.Matrix4(),normal);
 const pos=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();m.decompose(pos,rotation,scale);
 expect(new THREE.Vector3(0,1,0).applyQuaternion(rotation).distanceTo(normal)).toBeLessThan(1e-12);
 expect(pos.clone().divideScalar(metric).distanceTo(normal.clone().multiplyScalar(.1))).toBeLessThan(1e-9);
 const g=buildRockGeometry(20260924,1,true),v=g.getAttribute('position');let min=Infinity,max=-Infinity;
 for(let i=0;i<v.count;i++){const d=new THREE.Vector3().fromBufferAttribute(v,i).applyMatrix4(m).dot(normal)/metric;min=Math.min(min,d);max=Math.max(max,d);}
 expect(min).toBeLessThan(0);expect(max).toBeGreaterThan(0);g.dispose();
});
for(const [radius,datum,lat,lon] of [[.9723359558,3396190,-4.947112,137.382878],[.475,1737400,20.1911,30.7717]]) {
 it(`local rock origin preserves the physical placement and rotation on radius ${datum}`,()=>{
  const origin=rockScenePosition(lat,lon,-3000,radius,datum),ground=rockScenePosition(lat+.001,lon+.002,-2995,radius,datum);
  const p:RockPlacement={latDeg:lat,lonDeg:lon,heightM:-2995,scaleM:[.047,.035,.06],rotYRad:1.2,variant:0},scale=radius/datum;
  const m=composeLocalRockMatrix(ground,p,scale,origin);
  const world=new THREE.Matrix4().makeTranslation(...origin.toArray()).multiply(m);
  const expectedPos=ground.clone().setLength(ground.length()+.25*p.scaleM[1]*scale);
  const expectedQ=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),ground.clone().normalize()).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),p.rotYRad));
  const expected=new THREE.Matrix4().compose(expectedPos,expectedQ,new THREE.Vector3(...p.scaleM).multiplyScalar(scale));
  world.elements.forEach((v,i)=>expect(Math.abs(v-expected.elements[i])).toBeLessThan(2e-16));
  // Regression: same closed rock collapses when translated by a planet radius.
  const g=buildRockGeometry(20260924,0,true),pos=g.getAttribute('position');
  let oldFlat=0,newFlat=0;
  for(let i=0;i<pos.count;i+=3){
   for(const [mat,old] of [[expected,true],[m,false]] as const){
    const v=[0,1,2].map(j=>gpuPoint(new THREE.Vector3().fromBufferAttribute(pos,i+j),mat));
    if(v[1].sub(v[0]).cross(v[2].sub(v[0])).lengthSq()===0){if(old)oldFlat++;else newFlat++;}
   }
  }
  expect(oldFlat).toBeGreaterThan(pos.count/6);expect(newFlat).toBe(0);g.dispose();
 });
}
