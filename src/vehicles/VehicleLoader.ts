/**
 * 载具异步模型加载器与生命周期管理器 VehicleLoader
 * 遵循第二轮优化审计 R4 要求：
 * 1. 接入外部标准 GLTF/GLB 管线与 Draco 解码；
 * 2. 具备完整的代际事务安全（Generation Tracking），杜绝迟到回调复活与竞态污染；
 * 3. 几何中心校准与统一米制标定；
 * 4. 彻底且安全的显存资源释放（递归 dispose）。
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import type { VehicleId } from '../contracts/vehicle';
import { VEHICLE_ASSET_REGISTRY } from './VehicleAssetRegistry';
import { VehicleMeshBuilder } from './VehicleMeshBuilder';

export class VehicleLoader {
  private static gltfLoader: GLTFLoader | null = null;
  private static dracoLoader: DRACOLoader | null = null;
  private static currentGeneration = 0;

  /**
   * 初始化单例加载器
   */
  private static getLoader(): GLTFLoader {
    if (!this.gltfLoader) {
      this.gltfLoader = new GLTFLoader();
      this.dracoLoader = new DRACOLoader();
      this.dracoLoader.setDecoderPath('/draco/');
      this.gltfLoader.setDRACOLoader(this.dracoLoader);
    }
    return this.gltfLoader;
  }

  /**
   * 分配并自增一个新的加载代际
   */
  public static nextGeneration(): number {
    this.currentGeneration += 1;
    return this.currentGeneration;
  }

  /**
   * 获取当前有效代际
   */
  public static getCurrentGeneration(): number {
    return this.currentGeneration;
  }

  /**
   * 异步加载指定载具模型
   * @param id 载具 ID
   * @param generation 预期的加载代际（若提供且在载入完成时已过时，将主动丢弃并释放）
   */
  public static async loadVehicle(
    id: VehicleId,
    generation?: number
  ): Promise<THREE.Group | null> {
    const record = VEHICLE_ASSET_REGISTRY[id];

    // 1. 若为外部 GLB 模型资产
    if (record && record.format === 'glb' && record.assetPath) {
      try {
        const loader = this.getLoader();
        const gltf = await loader.loadAsync(record.assetPath);

        // 代际检查：如果在这期间发起了新请求或清空操作，丢弃结果防画面污染
        if (generation !== undefined && generation !== this.currentGeneration) {
          console.warn(`[VehicleLoader] 载具 ${id} 加载完成但代际已过期 (${generation} !== ${this.currentGeneration})，正在释放`);
          this.disposeVehicleObject(gltf.scene);
          return null;
        }

        const wrapper = new THREE.Group();
        wrapper.name = `vehicle-${id}`;

        // 统一计算原始包围盒并居中
        const rawBox = new THREE.Box3().setFromObject(gltf.scene);
        const center = new THREE.Vector3();
        rawBox.getCenter(center);
        gltf.scene.position.sub(center); // 使模型几何中心对齐本地原点

        // 将 GLTF 场景挂载到包装组
        wrapper.add(gltf.scene);

        // 应用米制缩放
        const scale = record.metricScale || 1.0;
        wrapper.scale.setScalar(scale);

        // 遍历所有子网格，启用阴影与规范材质
        wrapper.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            if (mesh.material) {
              const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
              for (const mat of mats) {
                mat.side = THREE.DoubleSide; // 太空薄壁结构两面均受光
                mat.needsUpdate = true;
              }
            }
          }
        });

        // 重新计算包装后的准确 Bounds
        const finalBox = new THREE.Box3().setFromObject(wrapper);
        const finalSize = new THREE.Vector3();
        finalBox.getSize(finalSize);

        wrapper.userData = {
          vehicleId: id,
          isGlb: true,
          box: finalBox,
          size: finalSize,
          maxDim: Math.max(finalSize.x, finalSize.y, finalSize.z),
          generation: generation ?? this.currentGeneration,
          assetRecord: record,
        };

        return wrapper;
      } catch (err) {
        console.error(`[VehicleLoader] GLB 模型加载失败 (${record.assetPath})，降级回退程序网格:`, err);
        // 出错时降级回退程序网格
      }
    }

    // 2. 程序化网格或兼容回退
    if (generation !== undefined && generation !== this.currentGeneration) {
      return null;
    }

    const group = VehicleMeshBuilder.buildVehicle(id);
    const box = new THREE.Box3().setFromObject(group);
    const size = new THREE.Vector3();
    box.getSize(size);

    group.userData = {
      vehicleId: id,
      isGlb: false,
      box,
      size,
      maxDim: Math.max(size.x, size.y, size.z),
      generation: generation ?? this.currentGeneration,
      assetRecord: record,
    };

    return group;
  }

  /**
   * 递归深度销毁载具 3D 对象占用的几何体、材质与贴图显存
   */
  public static disposeVehicleObject(object: THREE.Object3D | null): void {
    if (!object) return;

    object.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) {
          mesh.geometry.dispose();
        }
        if (mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const mat of mats) {
            // 释放所有关联贴图
            const m = mat as any;
            if (m.map) m.map.dispose();
            if (m.normalMap) m.normalMap.dispose();
            if (m.roughnessMap) m.roughnessMap.dispose();
            if (m.metalnessMap) m.metalnessMap.dispose();
            if (m.aoMap) m.aoMap.dispose();
            if (m.emissiveMap) m.emissiveMap.dispose();
            mat.dispose();
          }
        }
      }
    });

    if (object.parent) {
      object.parent.remove(object);
    }
    object.clear();
  }
}
