import {describe,it,expect} from 'vitest';
import type {HudFrame} from '../src/contracts/hud';
import {LANDING_SITES} from '../src/contracts/landing';
import {hudPhase,observedAltitude,altitudeAxis,formatCoordinates,bearingLabel} from '../src/app/hud/phase';
import {buildContextMap} from '../src/app/hud/model';
import {getPlanetNavPosition,getSatelliteNavPosition} from '../src/astronomy/bodies';
import {LandingController} from '../src/surface/LandingController';
import {CameraController} from '../src/camera/CameraController';
import * as THREE from 'three';

const frame=():{-readonly [K in keyof HudFrame]:HudFrame[K]}=>({sequence:1,simTimeHours:0,isPaused:true,timeScale:50,observerPosition:[0,0,0],bodies:[],
 camera:{mode:'ORBIT_TARGET',targetBodyId:'moon',selectedBodyId:'moon',distanceToTarget:3,minDistance:1,maxDistance:10,commandId:1,isTransitioning:false,spherical:{radius:3,theta:0,phi:1}}});
const mission=()=>({telemetry:new LandingController().getTelemetry(),availability:{action:'none' as const,reason:'mission-active' as const},sites:[LANDING_SITES['taurus-littrow']],preparation:{active:false,phase:null,lightingAdjustedSimHours:null}});
describe('phase-aware observer instruments',()=>{
 it('the real controller distinguishes overview arrival from Sun observation',()=>{
  const camera=new THREE.PerspectiveCamera(45,1.6,.1,10000);camera.position.set(0,30,100);
  const c=new CameraController({camera});
  c.executeCommand({type:'overview'});
  expect(c.getSnapshot().destinationMode).toBe('OVERVIEW');
  c.update(3,()=>({pos:new THREE.Vector3(),radius:1}));
  expect(c.getSnapshot().mode).toBe('OVERVIEW');
  c.executeCommand({type:'flyTo',bodyId:'sun',durationSec:1});
  expect(c.getSnapshot().destinationMode).toBe('ORBIT_TARGET');
  c.update(2,()=>({pos:new THREE.Vector3(),radius:1}));
  expect(c.getSnapshot().mode).toBe('ORBIT_TARGET');
 });
 it('suppresses default 50km before a real surface observer exists',()=>{
  const f=frame();f.landing=mission();f.landing.telemetry.state='PREPARING';
  expect(f.landing.telemetry.altitudeAGLM).toBe(50000);
  expect(hudPhase(f)).toBe('preparing');expect(observedAltitude(f)).toBeNull();
 });
 it('landing phases override incidental camera reframing, independent of astronomical pause',()=>{
  for(const state of ['DESCENDING','HOLD','SURFACE_LOOK','ASCENDING'] as const){
   const f=frame();f.landing=mission();f.landing.telemetry.state=state;f.camera.isTransitioning=true;
   expect(hudPhase(f)).toBe(state.toLowerCase());
  }
  const f=frame();f.camera.isTransitioning=true;expect(hudPhase(f)).toBe('transfer');
 });
 it('reports actual observer eye height rather than the different planner clearance',()=>{
  const f=frame();f.landing=mission();f.landing.telemetry.state='DESCENDING';f.landing.telemetry.altitudeAGLM=125;
  f.surface={bodyId:'moon',lat:0,lon:0,eyeHeightM:108.3,datumHeightM:-50,yawDeg:0,pitchDeg:0};
  expect(observedAltitude(f)).toBe(108.3);
 });
 it('overview, cancelled free camera and direct surface observation do not masquerade as arrival',()=>{
  const f=frame();f.camera.mode='OVERVIEW';expect(hudPhase(f)).toBe('overview');
  f.camera.mode='ORBIT_TARGET';f.camera.anchor={kind:'free',pivotScene:[1,2,3]};expect(hudPhase(f)).toBe('free');
  f.camera.mode='SURFACE_LOOK';expect(hudPhase(f)).toBe('surface_look');
  expect(hudPhase(null)).toBe('loading');
 });
 it('height axis is bounded, monotone and decade-labelled; headings wrap through north',()=>{
  expect(altitudeAxis(1000000)).toBe(0);expect(altitudeAxis(1000)).toBe(.5);expect(altitudeAxis(1)).toBe(1);
  expect(altitudeAxis(10000000)).toBe(0);expect(bearingLabel(359)).toBe('北');expect(bearingLabel(90)).toBe('东');
  expect(formatCoordinates(-20,350)).toBe('20.00°S · 10.00°W');
 });
 it('solar physical positions and smaller-than-nav satellite systems share their track scale',()=>{
  for(const [id,center,mult] of [['neptune','sun',10000],['moon','earth',.2]] as const){
   const f=frame(),p=(center==='sun'?getPlanetNavPosition:getSatelliteNavPosition)(id,0);
   f.bodies=[{id:center,position:[0,0,0]},{id,position:p.map(v=>v*mult) as [number,number,number]}];
   const map=buildContextMap(f,center,540,100), point=map.points.find(p=>p.id===id)!;
   const match=/^M([\d.-]+),([\d.-]+)/.exec(map.paths.find(p=>p.id===id)!.d)!;
   expect(Number(match[1])).toBeCloseTo(point.at.x,1);expect(Number(match[2])).toBeCloseTo(point.at.y,1);
  }
 });
});
describe('mission telemetry counterexamples',()=>{
 const descent=()=>{const c=new LandingController();c.startDescent();c.completePreparation(undefined,undefined,{latDeg:20.1,lonDeg:30.5,clearanceM:50000});c.update(5);return c;};
 it('HOLD stops both commanded motion rates and preserves progress',()=>{
  const c=descent();expect(c.getTelemetry().horizontalSpeedMps).toBeGreaterThan(0);c.holdDescent();
  const a=c.getTelemetry();c.update(10);const b=c.getTelemetry();
  expect(a.horizontalSpeedMps).toBe(0);expect(a.verticalSpeedMps).toBe(0);expect(a.progress).toBe(b.progress);expect(a.altitudeAGLM).toBe(b.altitudeAGLM);
 });
 it.each(['surface','midway'])('return from %s starts a new progress segment',from=>{
  const c=descent();if(from==='surface')c.touchdown();else c.holdDescent();
  c.returnToOrbit();expect(c.getTelemetry().progress).toBe(0);
  c.update(4);const a=c.getProgress();c.update(4);const b=c.getProgress();
  expect(a).toBeGreaterThan(0);expect(b).toBeGreaterThan(a);expect(b).toBeLessThan(1);
  c.update(30);expect(c.getState()).toBe('ORBIT');expect(c.getProgress()).toBe(0);
 });
 it('return from above the 50km framing height retains the negative guided rate',()=>{
  const c=new LandingController();c.startDescent();c.completePreparation(undefined,undefined,{latDeg:20.1,lonDeg:30.5,clearanceM:200000});
  c.holdDescent();c.returnToOrbit();c.update(2);
  expect(c.getTelemetry().verticalSpeedMps).toBeLessThan(0);
 });
});
