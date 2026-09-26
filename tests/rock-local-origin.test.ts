import {expect,it} from 'vitest';
import * as THREE from 'three';
import {buildRockGeometry,composeLocalRockMatrix,rockScenePosition,type RockPlacement} from '../src/surface/ProceduralRockField';

// Reproduce instanceMatrix*vertex in Float32, before camera subtraction.
function gpuPoint(p: THREE.Vector3,m: THREE.Matrix4) {
 const a=m.elements.map(Math.fround),v=p.toArray().map(Math.fround),f=Math.fround;
 return new THREE.Vector3(...[0,1,2].map(r=>f(f(f(f(a[r]*v[0])+f(a[4+r]*v[1]))+f(a[8+r]*v[2]))+a[12+r])));
}
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
