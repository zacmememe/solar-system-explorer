import {expect,it,vi} from 'vitest';
import * as THREE from 'three';
import {SolarEngine} from '../src/engine/SolarEngine';
import {VehicleLoader} from '../src/vehicles/VehicleLoader';
import {VehicleMeshBuilder} from '../src/vehicles/VehicleMeshBuilder';

it('hangar preview generations cannot discard the main scene vehicle',async()=>{
  const model=new THREE.Group();model.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()));
  const build=vi.spyOn(VehicleMeshBuilder,'buildVehicle').mockReturnValue(model);
  const engine=Object.create(SolarEngine.prototype) as SolarEngine;
  Object.assign(engine,{vehicleLoadGeneration:0,currentVehicleMesh:null,currentVehicleId:null,vehicleGroup:new THREE.Group()});
  VehicleLoader.nextGeneration();VehicleLoader.nextGeneration();VehicleLoader.nextGeneration();
  engine.setVehicle('iss');await new Promise(resolve=>setTimeout(resolve,0));
  expect((engine as any).currentVehicleMesh).toBe(model);
  expect((engine as any).vehicleGroup.children).toContain(model);
  engine.setVehicle(null);expect((engine as any).vehicleGroup.children).toHaveLength(0);
  build.mockRestore();
});
