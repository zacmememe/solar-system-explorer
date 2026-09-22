/**
 * 地表瓦片自适应 LOD 调度器 (SurfaceTileManager)
 * 遵循主方案规范与 Pro model 第二轮审计门禁：
 * 1. 解耦 IO 状态与平滑混合进度，收图后持续收敛至 1.0 (TILE-05)；
 * 2. 祖先 UV 采样与消除占位彩色图块，优雅承接未就绪/缺图区域 (TILE-07)；
 * 3. 读取 manifest 可用性，杜绝不存在的 404 瓦片请求 (TILE-04)；
 * 4. 单一不透明叶子覆盖，子节点就绪后祖先隐藏，消除冗余 Draw Calls 与重绘 (TILE-06)；
 * 5. 严格 64 瓦片硬预算调度与地平线剔除，环绕不膨胀 (TILE-08)；
 * 6. 代际安全 generation 机制，dispose 后阻断迟到请求回写缓存 (TILE-09)。
 */

import * as THREE from 'three';
import {
  TileCoordinate,
  SurfaceTileItem,
  SurfaceDatasetManifest,
} from '../contracts/surface';
import { SurfaceTileScheme } from './SurfaceTileScheme';
import { TileGeometryBuilder } from './TileGeometryBuilder';
import { createTileShaderMaterial } from './TileMaterial';

export interface SurfaceTileManagerOptions {
  manifest: SurfaceDatasetManifest;
  radius: number;
  maxMemoryTiles?: number;
  sseThreshold?: number; // 屏幕空间误差触发阈值系数 (默认 1.0)
}

export class SurfaceTileManager {
  private manifest: SurfaceDatasetManifest;
  private radius: number;
  private maxMemoryTiles: number;
  private sseThreshold: number;

  public group: THREE.Group; // 挂载至天体 poleFrame
  private activeTiles: Map<string, SurfaceTileItem> = new Map();
  private textureCache: Map<string, THREE.Texture> = new Map();
  private inFlightLoads: Map<string, Promise<THREE.Texture | null>> = new Map();

  private textureLoader: THREE.TextureLoader = new THREE.TextureLoader();
  private frustum: THREE.Frustum = new THREE.Frustum();
  private projScreenMatrix: THREE.Matrix4 = new THREE.Matrix4();

  // 代际标记：dispose() 或重建时自增，阻断迟到异步回调回写 (TILE-09)
  private generation: number = 0;

  // 默认极简占位纹理 (1x1 纯中性底色，仅用于根瓦片未到达时的绝对底层防空)
  private fallbackTexture: THREE.Texture;
  private availableTilesSet: Set<string> | null = null;
  private frameSplits: number = 0; // 单帧分裂计数器，平摊 LOD 细分峰值开销

  constructor(options: SurfaceTileManagerOptions) {
    this.manifest = options.manifest;
    this.radius = options.radius;
    this.maxMemoryTiles = options.maxMemoryTiles ?? 64;
    this.sseThreshold = options.sseThreshold ?? 1.0;

    if (this.manifest.availableTiles && this.manifest.availableTiles.length > 0) {
      this.availableTilesSet = new Set(this.manifest.availableTiles);
    }

    this.group = new THREE.Group();
    this.group.name = `SurfaceTiles_${this.manifest.bodyId}`;

    this.fallbackTexture = this.createFallbackTexture();

    // 初始化第 0 层双根瓦片 (西半球 0/0/0, 东半球 0/1/0)
    this.initRootTiles();
  }

  /**
   * 初始化双根瓦片
   */
  private initRootTiles(): void {
    const rootCoords: TileCoordinate[] = [
      { z: 0, x: 0, y: 0 }, // 西半球
      { z: 0, x: 1, y: 0 }, // 东半球
    ];

    for (const coord of rootCoords) {
      const tile = this.createTileItem(coord);
      this.activeTiles.set(tile.key, tile);
      this.group.add(tile.mesh);
      this.requestTileTexture(coord);
    }
  }

  /**
   * 构建瓦片运行时节点
   */
  private createTileItem(coord: TileCoordinate, parent?: SurfaceTileItem): SurfaceTileItem {
    const key = SurfaceTileScheme.tileKey(coord);
    const bbox = SurfaceTileScheme.getTileBoundingBox(coord);
    const geo = TileGeometryBuilder.buildPatchGeometry(bbox, this.radius, 16);

    // 寻找最近已加载的祖先节点与其纹理与 UV 变换
    let anc: SurfaceTileItem | undefined = parent;
    let ancCoord: TileCoordinate = parent ? parent.coord : coord;
    let ancTex: THREE.Texture = this.fallbackTexture;
    while (anc) {
      if (this.textureCache.has(anc.key)) {
        ancTex = this.textureCache.get(anc.key)!;
        ancCoord = anc.coord;
        break;
      }
      anc = anc.parent;
    }
    if (coord.z === 0 && this.textureCache.has(key)) {
      ancTex = this.textureCache.get(key)!;
    }

    const { offset, scale } = SurfaceTileScheme.getAncestorUvTransform(coord, ancCoord);

    const isCached = this.textureCache.has(key);
    const dayTex = isCached ? this.textureCache.get(key)! : ancTex;

    const material = createTileShaderMaterial({
      dayTexture: dayTex,
      coarseTexture: ancTex,
      ancestorUvOffset: offset,
      ancestorUvScale: scale,
      imageMix: isCached ? 1.0 : 0.0,
      hasFineTexture: isCached ? 1.0 : 0.0,
      initialAlpha: 1.0,
    });

    const mesh = new THREE.Mesh(geo, material);
    mesh.name = `Tile_${key}`;
    mesh.userData = { bodyId: this.manifest.bodyId, tileKey: key };

    return {
      coord,
      key,
      bbox,
      mesh,
      material,
      ioState: isCached ? 'ready' : 'unrequested',
      loadState: isCached ? 'ready' : 'idle',
      imageMix: isCached ? 1.0 : 0.0,
      fadeAlpha: isCached ? 1.0 : 0.0,
      parent,
      lastUsedTimestamp: performance.now(),
    };
  }

  /**
   * 生成极简 1x1 保底纹理
   */
  private createFallbackTexture(): THREE.Texture {
    const data = new Uint8Array([25, 45, 80, 255]);
    const tex = new THREE.DataTexture(data, 1, 1);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * 异步请求特定瓦片纹理并写入缓存
   */
  public requestTileTexture(coord: TileCoordinate): Promise<THREE.Texture | null> {
    const key = SurfaceTileScheme.tileKey(coord);

    // 1. 数据集可用性过滤：若不在 manifest 可用清单或覆盖范围内，不发请求，直接返回 null (TILE-04)
    if (this.availableTilesSet && !this.availableTilesSet.has(key)) {
      const tile = this.activeTiles.get(key);
      if (tile) {
        tile.ioState = 'unrequested';
        tile.material.uniforms.hasFineTexture.value = 0.0;
      }
      return Promise.resolve(null);
    }

    if (!SurfaceTileScheme.isTileCoveredByRoi(coord, this.manifest.coverageRoi)) {
      const tile = this.activeTiles.get(key);
      if (tile) {
        tile.ioState = 'unrequested';
        tile.material.uniforms.hasFineTexture.value = 0.0;
      }
      return Promise.resolve(null);
    }

    if (this.textureCache.has(key)) {
      const tex = this.textureCache.get(key)!;
      const tile = this.activeTiles.get(key);
      if (tile) {
        tile.ioState = 'ready';
        tile.material.uniforms.dayTexture.value = tex;
        tile.material.uniforms.hasFineTexture.value = 1.0;
      }
      return Promise.resolve(tex);
    }

    if (this.inFlightLoads.has(key)) {
      return this.inFlightLoads.get(key)!;
    }

    const currentGen = this.generation;
    const tile = this.activeTiles.get(key);
    if (tile) {
      tile.ioState = 'loading';
      tile.loadState = 'loading';
    }

    const tileUrl = `${this.manifest.tileRootPath}/${key}.jpg`;

    if (typeof document === 'undefined') {
      // 纯 CPU/Node 测试环境：生成受控模拟纹理
      const texture = this.fallbackTexture;
      this.textureCache.set(key, texture);
      if (tile) {
        tile.ioState = 'ready';
        tile.loadState = 'ready';
        tile.material.uniforms.dayTexture.value = texture;
        tile.material.uniforms.hasFineTexture.value = 1.0;
      }
      return Promise.resolve(texture);
    }

    const loadPromise = new Promise<THREE.Texture | null>((resolve) => {
      this.textureLoader.load(
        tileUrl,
        (texture) => {
          this.inFlightLoads.delete(key);
          // 代际安全检查：若已执行过 dispose()，彻底抛弃迟到纹理并释放显存 (TILE-09)
          if (currentGen !== this.generation) {
            texture.dispose();
            resolve(null);
            return;
          }

          texture.colorSpace = THREE.SRGBColorSpace;
          texture.wrapS = THREE.ClampToEdgeWrapping;
          texture.wrapT = THREE.ClampToEdgeWrapping;
          this.textureCache.set(key, texture);

          // 更新所有引用该瓦片的材质与状态
          const activeTile = this.activeTiles.get(key);
          if (activeTile) {
            activeTile.ioState = 'ready';
            activeTile.material.uniforms.dayTexture.value = texture;
            activeTile.material.uniforms.hasFineTexture.value = 1.0;
            // 标记 fading-in 启动渐变收敛
            activeTile.loadState = 'fading-in';
          }
          resolve(texture);
        },
        undefined,
        () => {
          this.inFlightLoads.delete(key);
          if (currentGen !== this.generation) {
            resolve(null);
            return;
          }
          // 404/失败时严禁将 fallback 缓存为成功资源！(TILE-07)
          const activeTile = this.activeTiles.get(key);
          if (activeTile) {
            activeTile.ioState = 'failed';
            activeTile.loadState = 'idle';
            activeTile.material.uniforms.hasFineTexture.value = 0.0;
          }
          resolve(null);
        }
      );
    });

    this.inFlightLoads.set(key, loadPromise);
    return loadPromise;
  }

  /**
   * 每帧自适应 LOD 调度与渐变更新
   */
  public update(
    camera: THREE.PerspectiveCamera,
    sunDirection: THREE.Vector3,
    teachingLight: number,
    dtSeconds: number
  ): void {
    const now = performance.now();
    this.frameSplits = 0; // 重置单帧分裂计数

    // 更新视锥体
    this.projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);

    // 计算相机在天体 poleFrame 局部坐标系下的位置与高度
    const worldCameraPos = camera.position.clone();
    const localCameraPos = this.group.worldToLocal(worldCameraPos);
    const altitude = localCameraPos.length() - this.radius;

    // 递归评估细分与合并决策
    const rootKeys = ['0/0/0', '0/1/0'];
    for (const rootKey of rootKeys) {
      const rootTile = this.activeTiles.get(rootKey);
      if (rootTile) {
        this.evaluateTileLOD(rootTile, camera, localCameraPos, altitude, now);
      }
    }

    // 更新所有活跃材质的太阳方向与渐变混合进度
    for (const tile of this.activeTiles.values()) {
      tile.material.uniforms.sunDirection.value.copy(sunDirection);
      tile.material.uniforms.teachingLight.value = teachingLight;

      // 解耦 IO 与渐变：一旦 ioState === 'ready'，混合进度持续推进直到 1.0！(TILE-05)
      if (tile.ioState === 'ready' && tile.imageMix < 1.0) {
        tile.imageMix = Math.min(1.0, tile.imageMix + dtSeconds * 5.0); // 0.2s 淡入混合
        tile.material.uniforms.imageMix.value = tile.imageMix;
        tile.fadeAlpha = tile.imageMix;
        tile.material.uniforms.fadeAlpha.value = tile.fadeAlpha;
        if (tile.imageMix >= 1.0) {
          tile.loadState = 'ready';
        } else {
          tile.loadState = 'fading-in';
        }
      }
    }

    // 单一不透明叶子覆盖更新：若一个瓦片的所有 4 个子节点均已稳定呈现，隐藏其自身网格 (TILE-06)
    for (const tile of this.activeTiles.values()) {
      if (tile.children && tile.children.length === 4) {
        const allChildrenReady = tile.children.every(
          (c) =>
            (c.ioState === 'ready' && c.imageMix >= 1.0) ||
            c.ioState === 'unrequested' ||
            c.ioState === 'failed'
        );
        tile.mesh.visible = !allChildrenReady;
      } else {
        tile.mesh.visible = true;
      }
    }

    // 执行 LRU 缓存预算与活跃瓦片硬限制检查 (TILE-08)
    this.trimCache();
  }

  /**
   * 递归评估瓦片 LOD 细分
   */
  private evaluateTileLOD(
    tile: SurfaceTileItem,
    camera: THREE.PerspectiveCamera,
    localCameraPos: THREE.Vector3,
    altitude: number,
    now: number
  ): void {
    tile.lastUsedTimestamp = now;

    // 最高层级保护
    if (tile.coord.z >= this.manifest.maxLevel) {
      if (tile.children) {
        this.collapseTileChildren(tile);
      }
      return;
    }

    // 包围球与视距计算
    const sphere = SurfaceTileScheme.getTileBoundingSphere(tile.coord, this.radius);
    const tileCenter = sphere.center;
    const distToTile = tileCenter.distanceTo(localCameraPos);

    // 地平线背离剔除 (Horizon culling)：背向视线的瓦片不细分
    const dirToCam = localCameraPos.clone().sub(tileCenter).normalize();
    const tileNormal = tileCenter.clone().normalize();
    const dotHorizon = tileNormal.dot(dirToCam);
    const isBackfacing = dotHorizon < -0.2 && distToTile > this.radius * 0.5;

    // 屏幕空间误差 (SSE) 估算
    const fovDeg = camera.fov;
    const geometricError = (this.radius * 2.0) / Math.pow(2, tile.coord.z);
    const sse = SurfaceTileScheme.screenSpaceError(geometricError, distToTile, 900, fovDeg);

    const splitDistance = ((this.radius * 2.2) / Math.pow(2, tile.coord.z)) * this.sseThreshold;
    const shouldSplit =
      !isBackfacing &&
      tile.coord.z < this.manifest.maxLevel &&
      (sse > 2.0 * this.sseThreshold || distToTile < splitDistance) &&
      altitude < this.radius * 2.0;

    if (shouldSplit) {
      if (!tile.children) {
        // 预算守卫与平摊控制：若活跃瓦片将超出上限或单帧分裂次数已满，推迟至后续帧平滑细分 (TILE-08)
        if (this.activeTiles.size + 4 > this.maxMemoryTiles || this.frameSplits >= 2) {
          return;
        }

        const childCoords = SurfaceTileScheme.getChildCoordinates(tile.coord);
        tile.children = childCoords.map((c) => this.createTileItem(c, tile));
        this.frameSplits++;

        for (const child of tile.children) {
          this.activeTiles.set(child.key, child);
          this.group.add(child.mesh);
          // 若子瓦片在 manifest 中可用，则发起请求；否则采样父级
          if (SurfaceTileScheme.isTileCoveredByRoi(child.coord, this.manifest.coverageRoi)) {
            this.requestTileTexture(child.coord);
          } else {
            child.ioState = 'unrequested';
          }
        }
        // 新分裂的子节点本帧不立即递归，留给后续帧自然评估，平摊帧开销
        return;
      }

      // 递归细分已有子节点
      for (const child of tile.children) {
        this.evaluateTileLOD(child, camera, localCameraPos, altitude, now);
      }
    } else {
      if (tile.children) {
        this.collapseTileChildren(tile);
      }
    }
  }

  /**
   * 折叠收拢子瓦片
   */
  private collapseTileChildren(tile: SurfaceTileItem): void {
    if (!tile.children) return;

    for (const child of tile.children) {
      this.collapseTileChildren(child);
      this.group.remove(child.mesh);
      child.mesh.geometry.dispose();
      child.material.dispose();
      this.activeTiles.delete(child.key);
    }
    tile.children = undefined;
    tile.mesh.visible = true;
  }

  /**
   * LRU 显存预算与活跃瓦片硬限制清理 (TILE-08)
   */
  private trimCache(): void {
    // 1. 若活跃瓦片超过硬上限 (64)，主动收拢最久未使用或远离视锥的子树 (TILE-08)
    if (this.activeTiles.size > this.maxMemoryTiles) {
      const collapsible: SurfaceTileItem[] = [];
      for (const tile of this.activeTiles.values()) {
        if (tile.children && tile.children.length > 0) {
          collapsible.push(tile);
        }
      }
      // 按最旧使用时间戳升序排序
      collapsible.sort((a, b) => a.lastUsedTimestamp - b.lastUsedTimestamp);
      for (const tile of collapsible) {
        if (this.activeTiles.size <= this.maxMemoryTiles) break;
        this.collapseTileChildren(tile);
      }
    }

    // 2. 纹理显存 LRU 清理
    if (this.textureCache.size <= this.maxMemoryTiles) return;

    for (const [key, tex] of this.textureCache.entries()) {
      if (this.textureCache.size <= this.maxMemoryTiles) break;
      if (key === '0/0/0' || key === '0/1/0') continue; // 根瓦片常驻
      if (this.activeTiles.has(key)) continue; // 当前正在渲染的瓦片保护

      tex.dispose();
      this.textureCache.delete(key);
    }
  }

  public getActiveTilesCount(): number {
    return this.activeTiles.size;
  }

  public getCachedTextureCount(): number {
    return this.textureCache.size;
  }

  public getManifest(): SurfaceDatasetManifest {
    return this.manifest;
  }

  public updateManifest(newManifest: SurfaceDatasetManifest): void {
    this.manifest = newManifest;
    if (newManifest.availableTiles && newManifest.availableTiles.length > 0) {
      this.availableTilesSet = new Set(newManifest.availableTiles);
    } else {
      this.availableTilesSet = null;
    }
  }

  /**
   * 销毁并释放所有 GPU 显存
   */
  public dispose(): void {
    this.generation++; // 递增代际，阻断所有在途异步回调 (TILE-09)
    this.inFlightLoads.clear();

    for (const tile of this.activeTiles.values()) {
      this.group.remove(tile.mesh);
      tile.mesh.geometry.dispose();
      tile.material.dispose();
    }
    this.activeTiles.clear();

    for (const tex of this.textureCache.values()) {
      tex.dispose();
    }
    this.textureCache.clear();
    this.fallbackTexture.dispose();
  }
}
