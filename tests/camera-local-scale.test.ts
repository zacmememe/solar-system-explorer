import { expect, it } from 'vitest';
import * as THREE from 'three';
import { CameraController } from '../src/camera/CameraController';

function rig(radius: number) {
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 8000);
  const controller = new CameraController({camera});
  const pose = () => ({pos:new THREE.Vector3(20,0,0),radius,surfaceRadius:radius,framingRadius:radius});
  controller.update(0,pose);
  controller.executeCommand({type:'flyTo',bodyId:'phobos',framingRadius:radius,durationSec:1});
  controller.update(1,pose);
  controller.update(0.1,pose);
  return {camera,controller,pose};
}

it('small physical moons keep their framing after travel and a gentle wheel input', () => {
  const small=rig(0.004), large=rig(0.4);
  for(const r of [small,large]) {
    r.controller.executeCommand({type:'zoomInput',logDelta:0.02});
    for(let i=0;i<30;i++) r.controller.update(1/60,r.pose);
  }
  const a=small.controller.getSnapshot(), b=large.controller.getSnapshot();
  expect(a.distanceToTarget/0.004).toBeCloseTo(b.distanceToTarget/0.4,5);
  expect(a.distanceToTarget).toBeLessThan(0.03);
  expect(a.minDistance).toBeLessThan(0.0041);
  expect(small.camera.near).toBeLessThan(a.distanceToTarget-0.004);
});

it('destination framing is independent of the tiny distant sky proxy at departure', () => {
  const camera=new THREE.PerspectiveCamera(45,16/9,0.1,8000);
  const controller=new CameraController({camera});
  controller.update(0,()=>({pos:new THREE.Vector3(),radius:0.00001}));
  controller.executeCommand({type:'flyTo',bodyId:'saturn',framingRadius:10,durationSec:1});
  controller.update(1,()=>({pos:new THREE.Vector3(100,0,0),radius:10,surfaceRadius:4}));
  expect(controller.getSnapshot().distanceToTarget).toBeGreaterThan(40);
  expect(controller.getSnapshot().distanceToTarget).toBeLessThan(50);
});
