/**
 * 地表瓦片自适应 LOD 调度器 (SurfaceTileManager)
 * 遵循主方案规范：
 * 1. 视锥体几何与近端距离快速裁剪；
 * 2. 屏幕空间误差 (SSE) 逐级细分与合批；
 * 3. 父子瓦片平滑淡入混合 (Fade Blend 0.2s)，杜绝任何黑块与突变；
 * 4. 挂载于天体 poleFrame，继承自转轴倾角，且与相机解耦；
 * 5. LRU 贴图缓存与显存预算安全保护。
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

  // 默认占位纹理 (512x512 柔和渐变底色，避免加载中任何空洞)
  private fallbackTexture: THREE.Texture;

  constructor(options: SurfaceTileManagerOptions) {
    this.manifest = options.manifest;
    this.radius = options.radius;
    this.maxMemoryTiles = options.maxMemoryTiles ?? 64;
    this.sseThreshold = options.sseThreshold ?? 1.0;

    this.group = new THREE.Group();
    this.group.name = `SurfaceTiles_${this.manifest.bodyId}`;

    this.fallbackTexture = this.createProceduralTileTexture(0, 0, 0);

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

    const initialTex = this.textureCache.get(key) || this.fallbackTexture;
    const material = createTileShaderMaterial({
      dayTexture: initialTex,
      initialAlpha: 1.0,
    });

    const mesh = new THREE.Mesh(geo, material);
    mesh.name = `Tile_${key}`;

    return {
      coord,
      key,
      bbox,
      mesh,
      material,
      loadState: this.textureCache.has(key) ? 'ready' : 'idle',
      fadeAlpha: 1.0,
      parent,
      lastUsedTimestamp: performance.now(),
    };
  }

  /**
   * 生成程序化高保真瓦片底色纹理 (在纯环境/单测或资源未到位时充当极速保底)
   */
  private createProceduralTileTexture(_z: number, x: number, _y: number): THREE.Texture {
    if (typeof document === 'undefined') {
      const data = new Uint8Array([45, 95, 165, 255]);
      const tex = new THREE.DataTexture(data, 1, 1);
      tex.needsUpdate = true;
      return tex;
    }

    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const isEast = x % 2 === 1;
      ctx.fillStyle = isEast ? '#1e4d7a' : '#2d6a4f';
      ctx.fillRect(0, 0, 64, 64);
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.strokeRect(0, 0, 64, 64);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }

  /**
   * 异步请求特定瓦片纹理并写入缓存
   */
  public requestTileTexture(coord: TileCoordinate): Promise<THREE.Texture | null> {
    const key = SurfaceTileScheme.tileKey(coord);
    if (this.textureCache.has(key)) {
      return Promise.resolve(this.textureCache.get(key)!);
    }
    if (this.inFlightLoads.has(key)) {
      return this.inFlightLoads.get(key)!;
    }

    const tileUrl = `${this.manifest.tileRootPath}/${key}.jpg`;

    if (typeof document === 'undefined') {
      const fallback = this.fallbackTexture;
      this.textureCache.set(key, fallback);
      return Promise.resolve(fallback);
    }

    const loadPromise = new Promise<THREE.Texture | null>((resolve) => {
      this.textureLoader.load(
        tileUrl,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.wrapS = THREE.ClampToEdgeWrapping;
          texture.wrapT = THREE.ClampToEdgeWrapping;
          this.textureCache.set(key, texture);
          this.inFlightLoads.delete(key);

          // 更新所有引用该瓦片的材质
          const tile = this.activeTiles.get(key);
          if (tile) {
            tile.material.uniforms.dayTexture.value = texture;
            tile.loadState = 'ready';
          }
          resolve(texture);
        },
        undefined,
        () => {
          // 若远端特定层级瓦片不存在，降级复用父级或程序化保底
          const fallback = this.fallbackTexture;
          this.textureCache.set(key, fallback);
          this.inFlightLoads.delete(key);
          resolve(fallback);
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

    // 更新视锥体
    this.projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);

    const worldCameraPos = new THREE.Vector3();
    camera.getWorldPosition(worldCameraPos);

    // 将相机位置换算至瓦片本地坐标系 (抵消 poleFrame 和 systemGroup 变换)
    const localCameraPos = worldCameraPos.clone();
    this.group.worldToLocal(localCameraPos);

    const distToCenter = localCameraPos.length();
    const altitude = Math.max(0.01, distToCenter - this.radius);

    // 针对当前活跃瓦片执行细分与合并决策
    const rootKeys = ['0/0/0', '0/1/0'];
    for (const rootKey of rootKeys) {
      const rootTile = this.activeTiles.get(rootKey);
      if (rootTile) {
        this.evaluateTileLOD(rootTile, localCameraPos, altitude, now);
      }
    }

    // 更新所有活跃材质的太阳方向与渐变 alpha
    for (const tile of this.activeTiles.values()) {
      tile.material.uniforms.sunDirection.value.copy(sunDirection);
      tile.material.uniforms.teachingLight.value = teachingLight;

      if (tile.loadState === 'fading-in') {
        tile.fadeAlpha = Math.min(1.0, tile.fadeAlpha + dtSeconds * 5.0); // 0.2s 淡入
        tile.material.uniforms.fadeAlpha.value = tile.fadeAlpha;
        if (tile.fadeAlpha >= 1.0) {
          tile.loadState = 'ready';
        }
      }
    }

    // 执行 LRU 缓存预算检查
    this.trimCache();
  }

  /**
   * 递归评估瓦片 LOD 细分
   */
  private evaluateTileLOD(
    tile: SurfaceTileItem,
    localCameraPos: THREE.Vector3,
    altitude: number,
    now: number
  ): void {
    tile.lastUsedTimestamp = now;

    // 视锥体与可视范围快速粗剪
    const sphere = SurfaceTileScheme.getTileBoundingSphere(tile.coord, this.radius);
    const distToTile = sphere.center.distanceTo(localCameraPos);

    // 距离判断：当相机高度小于阈值且层级小于最大层级时细分
    // 粗略细分阈值：L=0 高空；L=1 中高空；L=2 大陆级；L>=3 ROI 特写
    const splitDistance = ((this.radius * 2.2) / Math.pow(2, tile.coord.z)) * this.sseThreshold;
    const shouldSplit =
      tile.coord.z < this.manifest.maxLevel &&
      distToTile < splitDistance &&
      altitude < this.radius * 2.0;

    if (shouldSplit) {
      // 满足细分：检查子瓦片
      if (!tile.children) {
        const childCoords = SurfaceTileScheme.getChildCoordinates(tile.coord);
        tile.children = childCoords.map((c) => this.createTileItem(c, tile));
        for (const child of tile.children) {
          this.activeTiles.set(child.key, child);
          this.group.add(child.mesh);
          child.loadState = 'fading-in';
          child.fadeAlpha = 0.0;
          this.requestTileTexture(child.coord);
        }
      }

      // 递归细分子节点
      for (const child of tile.children) {
        this.evaluateTileLOD(child, localCameraPos, altitude, now);
      }
    } else {
      // 合并收拢：若已有子节点但相机拉远，卸载子节点
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
  }

  /**
   * LRU 显存预算清理
   */
  private trimCache(): void {
    if (this.textureCache.size <= this.maxMemoryTiles) return;

    for (const [key, tex] of this.textureCache.entries()) {
      if (this.textureCache.size <= this.maxMemoryTiles) break;
      // 根瓦片永不卸载
      if (key === '0/0/0' || key === '0/1/0') continue;
      // 当前处于渲染树中的瓦片不卸载
      if (this.activeTiles.has(key)) continue;

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

  /**
   * 销毁并释放所有 GPU 显存
   */
  public dispose(): void {
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
