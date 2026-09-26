import {afterEach,describe,it,expect,vi} from 'vitest';
import * as T from 'three';
import {SolarEngine} from '../src/engine/SolarEngine';
import {VehicleLoader} from '../src/vehicles/VehicleLoader';
import {LandingController} from '../src/surface/LandingController';
import type {LandingState} from '../src/contracts/landing';
import {PRESET_BOOKMARKS_V3} from '../src/utils/bookmarkStorage';

function setup(){
 const camera=new T.PerspectiveCamera();camera.position.set(0,0,140);
 const snapshot:any={mode:'ORBIT_TARGET',isTransitioning:false,targetBodyId:'moon',anchor:{kind:'body',bodyId:'moon'}};
 const engine:any=Object.create(SolarEngine.prototype),landing=new LandingController('tranquility-base');
 Object.assign(engine,{camera,cameraController:{getSnapshot:()=>snapshot},landingController:landing,
  landingPrep:null,landingSiteTravel:false,vehicleSurfaceBody:null,vehicleLoadGeneration:0,
  currentVehicleId:null,currentVehicleMesh:null,vehicleGroup:new T.Group(),viewCameraMode:'PLANET_OBSERVE',vehicleLightingMode:'PLANET_OBSERVE',
  cameraHeadlight:new T.DirectionalLight(),ambientLight:new T.AmbientLight(),teachingLight:false,
  bodyNodes:new Map(),vehicleDisplayRangeOut:{near:0,far:0},depthRenderer:{render:vi.fn(()=>[{near:.1,far:100}])},
  getBodyWorldPose:()=>({pos:new T.Vector3(),surfaceRadius:100})});
 return {engine:engine as SolarEngine,raw:engine,snapshot,landing};
}
function attach(raw:any){const mesh=new T.Group();mesh.add(new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial()));raw.currentVehicleMesh=mesh;raw.currentVehicleId='iss';raw.viewCameraMode='VEHICLE_FORMATION';raw.vehicleLightingMode='VEHICLE_FORMATION';raw.vehicleGroup.add(mesh);raw.camera.add(raw.vehicleGroup);raw.vehicleGroup.visible=true;raw.cameraHeadlight.intensity=.7;return mesh;}
afterEach(()=>vi.restoreAllMocks());

describe('vehicles only belong to space observation',()=>{
 it.each<LandingState>(['PREPARING','DESCENDING','HOLD','SURFACE_LOOK','ASCENDING'])('rejects selection and immediate rendering in %s',state=>{
  const {engine,raw,landing}=setup();attach(raw);vi.spyOn(landing,'getState').mockReturnValue(state);
  expect(engine.setVehicle('voyager-1')).toBe(false);engine.setViewCameraMode('VEHICLE_ONBOARD');engine.renderFrame();
  expect(engine.getCurrentVehicle()).toBeNull();expect(engine.getViewCameraMode()).toBe('PLANET_OBSERVE');expect(raw.vehicleGroup.visible).toBe(false);
  expect(raw.depthRenderer.render.mock.calls[0][3]).toBeUndefined();expect(raw.cameraHeadlight.intensity).toBe(0);expect(raw.ambientLight.intensity).toBe(.22);
 });
 it('blocks a surface camera even if the landing controller says ORBIT',()=>{
  const {engine,raw,snapshot}=setup();attach(raw);snapshot.mode='SURFACE_LOOK';snapshot.anchor={kind:'surface',bodyId:'moon',lat:0,lon:0,eyeHeightM:1.7};
  engine.renderFrame();expect(engine.canUseVehicles()).toBe(false);expect(engine.getCurrentVehicle()).toBeNull();
 });
 it('blocks landing-site travel before descent starts',()=>{
  const {engine,raw}=setup();attach(raw);raw.landingSiteTravel=true;engine.renderFrame();expect(engine.canUseVehicles()).toBe(false);expect(engine.getCurrentVehicle()).toBeNull();
 });
 it('disposes a model that finishes loading after descent begins',async()=>{
  const {engine,raw,landing}=setup();let resolve!:(g:T.Group)=>void;const model=new T.Group();
  vi.spyOn(VehicleLoader,'loadVehicle').mockReturnValue(new Promise(r=>resolve=r));const dispose=vi.spyOn(VehicleLoader,'disposeVehicleObject');
  expect(engine.setVehicle('iss')).toBe(true);landing.startDescent();resolve(model);await Promise.resolve();
  expect(engine.getCurrentVehicle()).toBeNull();expect(raw.vehicleGroup.children).toHaveLength(0);expect(dispose).toHaveBeenCalledWith(model);
 });
 it('preserves an existing space selection across normal transfer but blocks new selection',()=>{
  const {engine,raw,snapshot}=setup();attach(raw);snapshot.mode='TRANSITION';snapshot.isTransitioning=true;
  engine.renderFrame();expect(engine.setVehicle('voyager-1')).toBe(false);expect(engine.getCurrentVehicle()).toBe('iss');expect(engine.getViewCameraMode()).toBe('PLANET_OBSERVE');expect(raw.vehicleGroup.visible).toBe(false);
  snapshot.mode='ORBIT_TARGET';snapshot.isTransitioning=false;expect(engine.canUseVehicles()).toBe(true);expect(engine.getViewCameraMode()).toBe('VEHICLE_FORMATION');
 });
 it('does not unlock a cancelled departure only metres above the old surface',()=>{
  const {engine,raw,snapshot}=setup();raw.vehicleSurfaceBody='moon';snapshot.anchor={kind:'free',pivotScene:[0,0,0]};
  raw.camera.position.set(0,0,100.001);expect(engine.canUseVehicles()).toBe(false);
  raw.camera.position.set(0,0,118);expect(engine.canUseVehicles()).toBe(true);expect(engine.getCurrentVehicle()).toBeNull();
 });
 it('ends site travel before restoring a space bookmark with a vehicle',async()=>{
  const {engine,raw,snapshot}=setup();raw.landingSiteTravel=true;
  Object.assign(raw,{navigationRevision:0,navigationClockRevision:0,callbacks:{},
   bodyPoseProvider:{setPhysicalReferenceBody:vi.fn()},
   setPresentationPolicy:vi.fn(),updateEphemerisPoses:vi.fn(),setShowClouds:vi.fn(),
   setShowAtmosphere:vi.fn(),setTeachingLight:vi.fn(),setShowVenusSurface:vi.fn(),
   setObservationMode:vi.fn(),emitSnapshot:vi.fn()});
  raw.cameraController.getUserInputRevision=()=>0;
  raw.cameraController.executeCommand=(command:any)=>{if(command.type==='restoreBookmark'){
   snapshot.mode='TRANSITION';snapshot.isTransitioning=true;
  }};
  vi.spyOn(VehicleLoader,'loadVehicle').mockResolvedValue(new T.Group());
  const bookmark={...PRESET_BOOKMARKS_V3[0],surfaceStation:undefined,simulation:undefined,
   vehicleId:'iss' as const,viewCameraMode:'VEHICLE_FORMATION' as const};
  expect(await engine.restoreObservationSnapshot(bookmark)).toBe(true);
  await Promise.resolve();
  expect(raw.landingSiteTravel).toBe(false);expect(engine.getCurrentVehicle()).toBe('iss');
  snapshot.mode='ORBIT_TARGET';snapshot.isTransitioning=false;
  expect(engine.canUseVehicles()).toBe(true);expect(engine.getViewCameraMode()).toBe('VEHICLE_FORMATION');
 });
});
