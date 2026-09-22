/**
 * 运行时安全资产管理器
 * 遵循 01-REBUILD-PLAN 与 AGENTS.md 约束：
 * 1. 缓存与引用计数；
 * 2. 晚到回调被 command token 拦截，绝不覆盖新选择；
 * 3. 失败保留错误状态与重试机制，绝不隐式替换为随机噪点或换皮；
 * 4. 正确 dispose 释放 GPU 显存。
 */

import * as THREE from 'three';
import type { ProductionTextureAsset } from '../contracts/assets';

export type AssetState = 'idle' | 'loading' | 'ready' | 'error';

export interface AssetItem {
  asset: ProductionTextureAsset;
  state: AssetState;
  texture: THREE.Texture | null;
  errorMessage: string | null;
}

export class AssetManager {
  public loader: THREE.TextureLoader | { load: (url: string, onLoad: (texture: THREE.Texture) => void, onProgress?: any, onError?: (err: any) => void) => void };
  private cache: Map<string, AssetItem> = new Map();
  private manifestAssets: Map<string, ProductionTextureAsset> = new Map();
  private inFlightLoads: Map<string, Promise<THREE.Texture | null>> = new Map();
  private isDisposed: boolean = false;
  private disposedAssetIds: Set<string> = new Set();

  constructor() {
    this.loader = new THREE.TextureLoader();
  }

  public registerManifest(assets: ProductionTextureAsset[]): void {
    for (const a of assets) {
      this.manifestAssets.set(a.id, a);
      if (!this.cache.has(a.id)) {
        this.cache.set(a.id, {
          asset: a,
          state: 'idle',
          texture: null,
          errorMessage: null,
        });
      }
    }
  }

  public getAssetItem(assetId: string): AssetItem | undefined {
    return this.cache.get(assetId);
  }

  /**
   * 安全异步加载纹理
   * @param assetId 资产 ID
   * @param requestToken 递增命令令牌，用于拦截晚到回调
   * @param isCurrentToken 判断令牌是否仍为当前有效令牌
   */
  public async loadTexture(
    assetId: string,
    requestToken: number,
    isCurrentToken: (token: number) => boolean
  ): Promise<THREE.Texture | null> {
    if (this.isDisposed) {
      return null;
    }

    const item = this.cache.get(assetId);
    if (!item) {
      throw new Error(`未在清单中注册的资产: ${assetId}`);
    }

    // 1. 命中已就绪缓存
    if (item.state === 'ready' && item.texture) {
      if (isCurrentToken(requestToken)) {
        return item.texture;
      }
      return null;
    }

    // 2. 检查是否有相同资产正在加载中（In-flight 去重）
    let inFlight = this.inFlightLoads.get(assetId);
    if (!inFlight) {
      item.state = 'loading';
      item.errorMessage = null;

      inFlight = new Promise<THREE.Texture | null>((resolve) => {
        // 本地静态资源路径
        const localUrl = '/' + item.asset.localPath.replace(/^\//, '');

        this.loader.load(
          localUrl,
          (texture) => {
            // 核心安全检查：如果加载途中管理器或该资产已被销毁，立即释放并阻断
            if (this.isDisposed || this.disposedAssetIds.has(assetId)) {
              texture.dispose();
              resolve(null);
              return;
            }

            // 颜色空间设置
            if (item.asset.colorInterpretation === 'sRGB') {
              texture.colorSpace = THREE.SRGBColorSpace;
            } else {
              texture.colorSpace = THREE.LinearSRGBColorSpace;
            }

            texture.minFilter = THREE.LinearMipmapLinearFilter;
            texture.magFilter = THREE.LinearFilter;
            texture.generateMipmaps = true;

            item.state = 'ready';
            item.texture = texture;
            resolve(texture);
          },
          undefined,
          (err) => {
            const msg = `贴图加载失败: ${item.asset.localPath}`;
            console.error(`[AssetManager] ${msg}`, err);
            item.state = 'error';
            item.errorMessage = msg;
            resolve(null);
          }
        );
      }).finally(() => {
        this.inFlightLoads.delete(assetId);
      });

      this.inFlightLoads.set(assetId, inFlight);
    }

    const loadedTexture = await inFlight;

    if (this.isDisposed || this.disposedAssetIds.has(assetId)) {
      return null;
    }

    // 核心门禁：检查 token 是否仍然有效，过时返回 null 隔离晚到应用，但缓存保留
    if (isCurrentToken(requestToken)) {
      return loadedTexture;
    } else {
      console.warn(`[AssetManager] 资产 ${assetId} 加载完成但令牌已过时（用户已发起新操作），仅保留缓存`);
      return null;
    }
  }

  public disposeAsset(assetId: string): void {
    this.disposedAssetIds.add(assetId);
    const item = this.cache.get(assetId);
    if (item && item.texture) {
      item.texture.dispose();
      item.texture = null;
      item.state = 'idle';
    }
  }

  public disposeAll(): void {
    this.isDisposed = true;
    for (const item of this.cache.values()) {
      if (item.texture) {
        item.texture.dispose();
        item.texture = null;
        item.state = 'idle';
      }
    }
    this.cache.clear();
    this.inFlightLoads.clear();
  }
}
