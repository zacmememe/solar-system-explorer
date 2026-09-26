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
import { isSharedVehicleTexture } from './VehicleTextures';

export class VehicleLoader {
  private static dracoLoader: DRACOLoader | null = null;
  private static currentGeneration = 0;

  /**
   * 每次请求独立统计依赖失败，只有 Draco 解码器跨请求复用。
   */
  private static getLoader(manager: THREE.LoadingManager): GLTFLoader {
    if (!this.dracoLoader) {
      this.dracoLoader = new DRACOLoader();
      this.dracoLoader.setDecoderPath('/draco/');
    }
    return new GLTFLoader(manager).setDRACOLoader(this.dracoLoader);
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
    if (!record) throw new Error('未找到此航天器的模型记录');

    // 1. 若为外部 GLB 模型资产
    if (record && record.format === 'glb' && record.assetPath) {
      try {
        const manager = new THREE.LoadingManager();
        const failedAssets: string[] = [];
        manager.onError = url => failedAssets.push(url);
        const loader = this.getLoader(manager);
        const gltf = await loader.loadAsync(record.assetPath);
        // GLTFLoader tolerates failed images and resolves a scene with null maps.
        // That incomplete asset must not become an apparently successful vehicle.
        if (failedAssets.length) {
          this.disposeVehicleObject(gltf.scene);
          throw new Error('模型贴图未能完整加载');
        }

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
        const metricRoot=new THREE.Group();
        metricRoot.name='vehicle-metric-root';
        metricRoot.add(gltf.scene);
        wrapper.add(metricRoot);

        // 应用米制缩放
        const scale = record.metricScale || 1.0;
        metricRoot.scale.setScalar(scale);

        // 遍历所有子网格，启用阴影与规范材质
        wrapper.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            if (mesh.material) {
              const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
              for (const mat of mats) {
                if(!record.preserveMaterialSide)mat.side = THREE.DoubleSide;
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
        throw new Error('航天器模型未能加载，请重试', { cause: err });
      }
    }

    // 2. 明确登记为程序模型的载具；不用于冒充失败的外部资产。
    if (generation !== undefined && generation !== this.currentGeneration) {
      return null;
    }

    const group = VehicleMeshBuilder.buildVehicle(id);
    // The cache owns CPU image data. Each model owns its GPU texture wrappers,
    // so closing one renderer releases its listeners without evicting another.
    const ownedTextures = new Map<THREE.Texture, THREE.Texture>();
    group.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        for (const [key, value] of Object.entries(material)) {
          if (!(value instanceof THREE.Texture) || !isSharedVehicleTexture(value)) continue;
          let owned = ownedTextures.get(value);
          if (!owned) { owned = value.clone(); ownedTextures.set(value, owned); }
          (material as unknown as Record<string, unknown>)[key] = owned;
        }
      }
    });
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

    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    object.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) {
          geometries.add(mesh.geometry);
        }
        if (mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const mat of mats) {
            materials.add(mat);
            for (const value of Object.values(mat)) {
              if (value instanceof THREE.Texture && !isSharedVehicleTexture(value)) textures.add(value);
            }
          }
        }
      }
    });
    textures.forEach(texture => texture.dispose());
    materials.forEach(material => material.dispose());
    geometries.forEach(geometry => geometry.dispose());

    if (object.parent) {
      object.parent.remove(object);
    }
    object.clear();
  }
}
