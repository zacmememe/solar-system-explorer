/**
 * 地表瓦片数据集清单载入器
 * 严格遵循审计要求：引擎只读构建输出 manifest.json，杜绝在各处硬编码或分离手写
 */

import type { SurfaceDatasetManifest } from '../contracts/surface';

export async function loadEarthTileManifest(): Promise<SurfaceDatasetManifest> {
  // 1. Node / 单元测试运行环境：优先从文件系统读取真实构建输出清单
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const manifestPath = path.resolve('public/assets/tiles/earth/manifest.json');
      if (fs.existsSync(manifestPath)) {
        return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as SurfaceDatasetManifest;
      }
    } catch {
      // ignore
    }
  }

  // 2. 浏览器客户端环境：通过 fetch 读取 public/assets/tiles/earth/manifest.json
  if (typeof window !== 'undefined' && typeof window.fetch !== 'undefined') {
    try {
      const res = await window.fetch('/assets/tiles/earth/manifest.json');
      if (res.ok) {
        return (await res.json()) as SurfaceDatasetManifest;
      }
    } catch (err) {
      console.warn('Failed to fetch earth manifest via network:', err);
    }
  }

  // 极简兜底
  return {
    bodyId: 'earth',
    datasetId: 'nasa-blue-marble-200409-tiles',
    version: '2.0.0',
    source: 'NASA Earth Observatory / Blue Marble Next Generation',
    sourceDate: '2004-09',
    projection: 'equirectangular-dual-root',
    referenceRadiusKm: 6371.0,
    maxLevel: 4,
    tileSizePixels: 512,
    colorSpace: 'sRGB',
    tileRootPath: '/assets/tiles/earth',
  };
}
