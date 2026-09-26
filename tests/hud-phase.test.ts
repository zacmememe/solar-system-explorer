import {describe,it,expect} from 'vitest';
import type {HudFrame} from '../src/contracts/hud';
import {LANDING_SITES} from '../src/contracts/landing';
import {hudPhase,observedAltitude,altitudeAxis,formatCoordinates,bearingLabel} from '../src/app/hud/phase';
import {buildContextMap} from '../src/app/hud/model';
import {getPlanetNavPosition,getSatelliteNavPosition} from '../src/astronomy/bodies';
import {LandingController} from '../src/surface/LandingController';
import {CameraController} from '../src/camera/CameraController';
import * as THREE from 'three';
import {compassTicks,journeyArc} from '../src/app/hud/arc';

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
 it('bookmark arrival preserves explicit overview intent, including the stored framing',()=>{
  const camera=new THREE.PerspectiveCamera(45,1.6,.1,10000);camera.position.set(0,30,100);
  const c=new CameraController({camera}),spherical={radius:600,phi:1,theta:.4};
  for(const destinationMode of ['OVERVIEW',undefined] as const){
   c.executeCommand({type:'restoreBookmark',targetBodyId:'sun',spherical,destinationMode,durationSec:1});
   c.update(2,()=>({pos:new THREE.Vector3(),radius:1}));
   expect(c.getSnapshot().mode).toBe(destinationMode??'ORBIT_TARGET');
   expect(c.getSnapshot().spherical.radius).toBeCloseTo(spherical.radius);
   expect(c.getSnapshot().spherical.phi).toBeCloseTo(spherical.phi);
  }
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
 it('return above the old 50km ceiling climbs and reports the actual positive guided rate',()=>{
  const c=new LandingController();c.startDescent();c.completePreparation(undefined,undefined,{latDeg:20.1,lonDeg:30.5,clearanceM:200000});
  c.holdDescent();c.returnToOrbit();c.update(2);
  expect(c.getTelemetry().altitudeMSLM).toBeGreaterThan(200000);
  expect(c.getTelemetry().verticalSpeedMps).toBeGreaterThan(0);
 });
});

describe('task arc semantics',()=>{
 it('distinguishes explicit landing-site travel from a same-body reframe',()=>{
  const f=frame();f.landing={...mission(),siteTravel:{siteId:'jezero',name:'耶泽罗'}};f.camera.isTransitioning=true;
  expect(hudPhase(f)).toBe('site_travel');expect(journeyArc(f).labels.at(-1)).toBe('落区上空');
  f.landing={...f.landing,siteTravel:null};expect(hudPhase(f)).toBe('transfer');
 });
 it('preparation has no fabricated descent progress or default height',()=>{
  const f=frame();f.landing=mission();f.landing.telemetry.state='PREPARING';f.landing.telemetry.progress=.9;
  expect(journeyArc(f).progress).toBeNull();expect(observedAltitude(f)).toBeNull();
 });
 it('HOLD retains the descent cursor and ascent starts a different segment',()=>{
  const f=frame();f.landing=mission();f.landing.telemetry.state='DESCENDING';f.landing.telemetry.progress=.64;
  const before=journeyArc(f);f.landing.telemetry.state='HOLD';expect(journeyArc(f).cursor).toBe(before.cursor);
  f.landing.telemetry.state='ASCENDING';f.landing.telemetry.progress=0;
  expect(journeyArc(f).kind).toBe('ascent');expect(journeyArc(f).cursor).toBe(0);
 });
 it('does not hide a legitimate current-segment replan reset',()=>{
  const f=frame();f.camera.isTransitioning=true;f.camera.transitionProgress=.8;expect(journeyArc(f).progress).toBe(.8);
  f.camera.transitionProgress=.04;expect(journeyArc(f).progress).toBe(.04);
 });
 it('north ticks move a single degree across the wrap without jumping 359 degrees',()=>{
  const oldNorth=compassTicks(359,420).find(t=>t.bearing===0)!;
  const newNorth=compassTicks(0,420).find(t=>t.bearing===0)!;
  expect(oldNorth.x-newNorth.x).toBeCloseTo((420-48)/150);expect(newNorth.x).toBe(210);
  expect(compassTicks(Number.NaN,420)).toEqual([]);
 });
 it('compact diagrams filter scope while retaining the actual dot/track correspondence',()=>{
  const f=frame(),p=getSatelliteNavPosition('moon',0);
  f.bodies=[{id:'earth',position:[0,0,0]},{id:'moon',position:p},{id:'mars',position:[10,20,30]}];
  const map=buildContextMap(f,'earth',500,64,['moon']);
  expect(map.points.map(p=>p.id)).toEqual(['earth','moon']);
  const point=map.points[1],match=/^M([\d.-]+),([\d.-]+)/.exec(map.paths[0].d)!;
  expect(Number(match[1])).toBeCloseTo(point.at.x,1);expect(Number(match[2])).toBeCloseTo(point.at.y,1);
 });
});
