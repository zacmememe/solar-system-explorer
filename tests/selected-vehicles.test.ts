import {afterEach,expect,it,vi} from 'vitest';
import * as T from 'three';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {VehicleLoader} from '../src/vehicles/VehicleLoader';
import {VEHICLE_ASSET_REGISTRY} from '../src/vehicles/VehicleAssetRegistry';
import {selectableVehicleId} from '../src/contracts/vehicle';
import {upgradeBookmarkToV3} from '../src/contracts/bookmark';
import {PRESET_BOOKMARKS} from '../src/utils/bookmarkStorage';
afterEach(()=>vi.restoreAllMocks());

it.each(['cassini','voyager-1','juno','space-shuttle'] as const)('%s has the selected embedded source package and honest admission',id=>{
 const record=VEHICLE_ASSET_REGISTRY[id],bytes=readFileSync('public'+record.assetPath);
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(record.sha256);expect(bytes.length).toBe(record.fileSize);
 const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
 expect(json.images.every((i:any)=>i.bufferView!==undefined&&!i.uri)).toBe(true);
 expect(json.buffers.every((b:any)=>!b.uri)).toBe(true);
 const provenance=JSON.parse(readFileSync('public/assets/models/selected/provenance.json','utf8')).packages.find((p:any)=>p.id===id);
 expect(provenance.sourceAssets.length).toBeGreaterThan(0);expect(provenance.sha256).toBe(record.sha256);
 expect(record.approved).toBe(false);expect(record.calibratedMetres).toBe(false);
});
it('keeps metric scale separate from presentation and preserves source material sides/alpha',async()=>{
 const original=VEHICLE_ASSET_REGISTRY.cassini;VEHICLE_ASSET_REGISTRY.cassini={...original,metricScale:7};
 const scene=new T.Group(),material=new T.MeshStandardMaterial({side:T.FrontSide,transparent:true,opacity:.6});
 scene.add(new T.Mesh(new T.BoxGeometry(2,3,4),material));scene.position.set(17,-5,9);
 vi.spyOn(GLTFLoader.prototype,'loadAsync').mockResolvedValue({scene} as any);
 try{
  const model=(await VehicleLoader.loadVehicle('cassini'))!;
  expect(model.scale.x).toBe(1);expect(model.getObjectByName('vehicle-metric-root')!.scale.x).toBe(7);
  expect(model.userData.maxDim).toBe(28);expect(new T.Box3().setFromObject(model).getCenter(new T.Vector3()).length()).toBeLessThan(1e-12);
  model.scale.setScalar(.82/model.userData.maxDim);model.updateMatrixWorld(true);
  const s=new T.Box3().setFromObject(model).getSize(new T.Vector3());expect(Math.max(s.x,s.y,s.z)).toBeCloseTo(.82,8);
  expect(material.side).toBe(T.FrontSide);expect(material.transparent).toBe(true);expect(material.opacity).toBe(.6);
  VehicleLoader.disposeVehicleObject(model);
 }finally{VEHICLE_ASSET_REGISTRY.cassini=original;}
});
it.each(['apollo-lm','james-webb','hubble','tiangong','unknown','__proto__'])('restores %s bookmarks without substituting another vehicle or losing the observation',id=>{
 const raw={...PRESET_BOOKMARKS[0],vehicleId:id};const restored=upgradeBookmarkToV3(raw);
 expect(selectableVehicleId(id)).toBeNull();expect(restored.vehicleId).toBeNull();expect(restored.viewCameraMode).toBe('PLANET_OBSERVE');
 expect(restored.spherical).toEqual(raw.spherical);expect(restored.targetBodyId).toBe(raw.targetBodyId);expect(restored.simTimeHours).toBe(raw.simTimeHours);
});
it('retains a selected spacecraft in space but never in a surface bookmark',()=>{
 const raw={...PRESET_BOOKMARKS[0],vehicleId:'juno'};
 expect(upgradeBookmarkToV3(raw).vehicleId).toBe('juno');
 expect(upgradeBookmarkToV3({...raw,surfaceStation:{bodyId:'mars'}}).vehicleId).toBeNull();
});
