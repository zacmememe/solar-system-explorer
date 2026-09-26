import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { VehicleMeshBuilder } from '../src/vehicles/VehicleMeshBuilder';

describe('ISS detail geometry safety', () => {
  it('keeps detailed surfaces finite and inside the existing presentation envelope', () => {
    const model = VehicleMeshBuilder.buildVehicle('iss');
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    // Original mast canisters extend .025 past each wing tip: height is 5.4.
    expect(size.x).toBeCloseTo(10.65,4); expect(size.y).toBeCloseTo(5.4,4);
    expect(size.z).toBeGreaterThan(6); expect(size.z).toBeLessThan(6.5);
    let triangles=0,draws=0,panels=0;
    model.traverse(o=>{if(o instanceof THREE.Mesh){
      draws++; const geometry=o.geometry;
      triangles+=(geometry.index?.count ?? geometry.getAttribute('position').count)/3;
      for(const key of ['position','normal']) expect(Array.from(geometry.getAttribute(key).array).every(Number.isFinite)).toBe(true);
      if((o.material as THREE.Material).name==='iss-solar-cells')panels++;
    }});
    expect(panels).toBe(8); expect(draws).toBeLessThan(42); expect(triangles).toBeLessThan(30000);
  });
});
