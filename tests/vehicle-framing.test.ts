import {expect,it} from 'vitest';
import * as T from 'three';
import {formationFraming} from '../src/vehicles/formationFraming';
import {previewDistance} from '../src/vehicles/previewFraming';

it.each([390/844,430/932,1,1920/1080,2560/1080])('keeps rotated, off-center appendages inside aspect %s through the full bob',aspect=>{
 const camera=new T.PerspectiveCamera(45,aspect,.01,100);
 const box=new T.Box3(new T.Vector3(-60,-25,-12),new T.Vector3(48,39,32));
 for(const factor of [.001,1,1000]) for(const rotation of [[.12,-.38,0],[.24,Math.PI+.58,0]] as [number,number,number][]){
  const scaled=new T.Box3(box.min.clone().multiplyScalar(factor),box.max.clone().multiplyScalar(factor));
  const fit=formationFraming(scaled,108*factor,.95,rotation,45,aspect);
  expect(fit.scale).toBeGreaterThan(0);expect(fit.scale*108*factor).toBeLessThanOrEqual(.9500001);
  for(const bob of [-.012,0,.012]) for(const x of [scaled.min.x,scaled.max.x]) for(const y of [scaled.min.y,scaled.max.y]) for(const z of [scaled.min.z,scaled.max.z]){
   const p=new T.Vector3(x,y,z).multiplyScalar(fit.scale).applyEuler(new T.Euler(...rotation)).add(new T.Vector3(fit.x,-.34+bob,-2.1)).project(camera);
   expect(Math.abs(p.x)).toBeLessThanOrEqual(.92000001);expect(Math.abs(p.y)).toBeLessThanOrEqual(.92000001);expect(Math.abs(p.z)).toBeLessThan(1);
  }
 }
});
it('retains the chosen desktop size and position when the model already fits',()=>{
 const box=new T.Box3(new T.Vector3(-10,-3,-2),new T.Vector3(10,3,2));
 expect(formationFraming(box,20,.6375,[.12,-.38,0],45,16/9)).toEqual({x:.48,scale:.6375/20});
});
it.each([.45,1,564/340])('fits a rotating bounding sphere in a preview of aspect %s',aspect=>{
 const r=13,c=new T.PerspectiveCamera(40,aspect,.1,500);
 c.position.set(0,.4,1.8).normalize().multiplyScalar(previewDistance(r,40,aspect));c.lookAt(0,0,0);c.updateMatrixWorld();
 // Independent dense projection, including directions tangent to the sphere.
 for(let latitude=0;latitude<=Math.PI;latitude+=.04) for(let longitude=0;longitude<2*Math.PI;longitude+=.04){
  const p=new T.Vector3().setFromSphericalCoords(r,latitude,longitude).project(c);
  expect(Math.abs(p.x)).toBeLessThanOrEqual(.900001);expect(Math.abs(p.y)).toBeLessThanOrEqual(.900001);expect(Math.abs(p.z)).toBeLessThan(1);
 }
});
