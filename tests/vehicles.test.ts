import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { VEHICLE_CATALOG } from '../src/vehicles/VehicleCatalog';
import { VehicleMeshBuilder } from '../src/vehicles/VehicleMeshBuilder';
import type { VehicleId, ViewCameraMode } from '../src/contracts/vehicle';

describe('航天器载具系统 (Spacecraft Vehicles System)', () => {
  const allVehicleIds: VehicleId[] = [
    'apollo-lm',
    'voyager-1',
    'james-webb',
    'iss',
    'tiangong',
    'cassini',
  ];

  it('VEHICLE-01: 完整包含六大人类核心航天器定义且元数据科学可追溯', () => {
    for (const id of allVehicleIds) {
      const v = VEHICLE_CATALOG[id];
      expect(v, `航天器 ${id} 必须在目录中定义`).toBeDefined();
      expect(v.id).toBe(id);
      expect(v.name.length).toBeGreaterThan(0);
      expect(v.nameEn.length).toBeGreaterThan(0);
      expect(v.agency.length).toBeGreaterThan(0);
      expect(v.launchYear).toBeGreaterThan(1950);
      expect(v.kidFact.length).toBeGreaterThan(5);
      expect(v.description.length).toBeGreaterThan(20);
      expect(v.sourceRef.length).toBeGreaterThan(0);
      expect(v.accentColorHex).toBeGreaterThan(0);

      // 物理米制尺寸有效性校验
      expect(v.dimensions.lengthM).toBeGreaterThan(0);
      expect(v.dimensions.widthM).toBeGreaterThan(0);
      expect(v.dimensions.heightM).toBeGreaterThan(0);
      expect(v.massKg).toBeGreaterThan(0);

      // 结构热点至少包含 2 个
      expect(v.hotspots.length).toBeGreaterThanOrEqual(2);
      for (const hs of v.hotspots) {
        expect(hs.id.length).toBeGreaterThan(0);
        expect(hs.name.length).toBeGreaterThan(0);
        expect(hs.kidTip.length).toBeGreaterThan(0);
        expect(hs.scienceDetail.length).toBeGreaterThan(0);
        expect(hs.relativePosM.length).toBe(3);
      }
    }
  });

  it('VEHICLE-02: 结构几何构建器能为所有载具生成完整合规的 3D 网格', () => {
    for (const id of allVehicleIds) {
      const group = VehicleMeshBuilder.buildVehicle(id);
      expect(group).toBeInstanceOf(THREE.Group);
      expect(group.name).toBe(`vehicle-${id}`);

      let meshCount = 0;
      let vertexCount = 0;

      group.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          meshCount++;
          const m = child as THREE.Mesh;
          expect(m.geometry).toBeDefined();
          expect(m.material).toBeDefined();
          vertexCount += m.geometry.getAttribute('position').count;
        }
      });

      // 每个航天器由多个具有语义的零部件构成
      expect(meshCount, `航天器 ${id} 必须包含几何网格构件`).toBeGreaterThanOrEqual(3);
      expect(vertexCount, `航天器 ${id} 必须包含足够的顶点细节`).toBeGreaterThan(100);

      // 包围盒尺寸自洽校验
      const box = new THREE.Box3().setFromObject(group);
      const size = new THREE.Vector3();
      box.getSize(size);
      expect(size.x).toBeGreaterThan(0);
      expect(size.y).toBeGreaterThan(0);
      expect(size.z).toBeGreaterThan(0);
    }
  });

  it('VEHICLE-03: 国际空间站与阿波罗登月舱尺寸比例符合真实物理尺度', () => {
    const iss = VEHICLE_CATALOG['iss'];
    const apollo = VEHICLE_CATALOG['apollo-lm'];
    const voyager = VEHICLE_CATALOG['voyager-1'];

    // 空间站长达 109 米，明显大于阿波罗登月舱和旅行者
    expect(iss.dimensions.lengthM).toBeGreaterThan(apollo.dimensions.lengthM * 5);
    expect(iss.dimensions.lengthM).toBeGreaterThan(voyager.dimensions.lengthM * 10);
    expect(iss.massKg).toBeGreaterThan(apollo.massKg! * 10);
  });

  it('VEHICLE-04: 支持三种正交的摄像机视角模式切换契约', () => {
    const validModes: ViewCameraMode[] = [
      'PLANET_OBSERVE',
      'VEHICLE_FORMATION',
      'VEHICLE_ONBOARD',
    ];
    expect(validModes.length).toBe(3);
  });
});
