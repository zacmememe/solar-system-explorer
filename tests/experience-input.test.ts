import {expect,it} from 'vitest';
import * as THREE from 'three';
import {CameraController} from '../src/camera/CameraController';
import {LandingController} from '../src/surface/LandingController';

it('drag takes over the visible guided direction, not stale surface yaw',()=>{
  const camera=new THREE.PerspectiveCamera(45,1.6,0.1,8000);
  const c=new CameraController({camera});
  const pose=()=>({pos:new THREE.Vector3(),radius:1,quaternion:new THREE.Quaternion()});
  c.update(0,pose);
  // At lat/lon 0/0, up=+X, north=+Y, east=-Z. Guide looks east.
  const q=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(),new THREE.Vector3(0,0,-1),new THREE.Vector3(1,0,0)));
  c.executeCommand({type:'enterSurfaceLook',bodyId:'moon',lat:0,lon:0,eyeHeightM:1000,orientationQuat:q.toArray()});
  const before=camera.getWorldDirection(new THREE.Vector3());
  c.executeCommand({type:'orbit',deltaTheta:0.01,deltaPhi:0});
  expect(before.angleTo(camera.getWorldDirection(new THREE.Vector3()))).toBeCloseTo(0.01,5);
  expect(c.getSnapshot().surfaceOrientation?.yawDeg).toBeCloseTo(90-0.01*180/Math.PI,4);
});

it('cancelling a tiny moon flight does not clamp the camera outward next frame',()=>{
  const camera=new THREE.PerspectiveCamera(45,1.6,0.1,8000), c=new CameraController({camera});
  const pose=()=>({pos:new THREE.Vector3(),radius:0.004,surfaceRadius:0.004});
  c.update(0,pose);
  c.executeCommand({type:'flyTo',bodyId:'phobos',framingRadius:0.004,durationSec:1});c.update(1,pose);
  c.executeCommand({type:'flyTo',bodyId:'phobos',framingRadius:0.004,durationSec:1});c.update(0.4,pose);
  c.executeCommand({type:'cancelFlight'});const before=camera.position.clone();
  c.update(1/60,pose);expect(camera.position.distanceTo(before)).toBeLessThan(1e-8);
});

it('manual speed choice during landing survives return/cancel',()=>{
  let speed=50;const c=new LandingController();c.startDescent();
  c.completePreparation(()=>speed,s=>speed=s,{latDeg:20.21,lonDeg:30.8,clearanceM:50000});
  expect(speed).toBe(1);
  c.releaseTimeScaleOverride();speed=10;
  c.cancel(s=>speed=s);expect(speed).toBe(10);
});

it('surface bookmark restores mission identity and saved eye height, with an exit path',()=>{
  const c=new LandingController();
  expect(c.restoreSurfaceStation('hadley-rille',26.1,3.7,2.3)).toBe(true);
  expect(c.getTelemetry().site.id).toBe('hadley-rille');
  expect(c.getTelemetry().state).toBe('SURFACE_LOOK');
  expect(c.evaluateTrajectory().altitudeAGLM).toBeCloseTo(2.3);
  c.returnToOrbit();expect(c.getState()).toBe('ASCENDING');
});
