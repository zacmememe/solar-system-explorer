/**
 * 地表瓦片系统与多级细节 (LOD) 契约规范
 * 依据批次 B3 架构设计与 01-REBUILD-PLAN 第 5 节规范
 */

import * as THREE from 'three';

/**
 * 瓦片坐标索引 (z, x, y)
 * z: 层级 (Level of Detail), 0 起步
 * x: 经度列号, 西向东, 范围 [0, 2^(z+1) - 1]
 * y: 纬度行号, 北向南, 范围 [0, 2^z - 1]
 */
export interface TileCoordinate {
  z: number;
  x: number;
  y: number;
}

/**
 * 瓦片地理经纬度包围盒 (度)
 */
export interface TileBoundingBox {
  lonMin: number; // [-180, 180]
  lonMax: number; // [-180, 180]
  latMin: number; // [-90, 90]
  latMax: number; // [-90, 90]
}

/**
 * 瓦片加载与生命周期状态 (向后兼容)
 */
export type TileLoadState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'fading-in'
  | 'fading-out'
  | 'disposed';

/**
 * 瓦片 IO 资源请求状态 (解耦 IO 与平滑渐变混合)
 */
export type TileIOState =
  | 'unrequested'
  | 'queued'
  | 'loading'
  | 'ready'
  | 'failed';

/**
 * 地表瓦片数据集清单规范
 */
export interface SurfaceDatasetManifest {
  bodyId: string;
  datasetId: string;
  version: string;
  source: string;
  sourceDate: string;
  projection: 'equirectangular-dual-root';
  referenceRadiusKm: number;
  maxLevel: number;
  tileSizePixels: number;
  colorSpace: 'sRGB';
  tileRootPath: string; // 相对 public/ 目录
  coverageRoi?: Array<{
    name: string;
    lonMin: number;
    lonMax: number;
    latMin: number;
    latMax: number;
    targetLevel: number;
  }>;
}

/**
 * 瓦片运行时渲染项
 */
export interface SurfaceTileItem {
  coord: TileCoordinate;
  key: string;
  bbox: TileBoundingBox;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  loadState: TileLoadState;
  ioState: TileIOState;
  imageMix: number; // 0.0 ~ 1.0 纹理混合收敛进度 (收图后持续收敛至 1.0)
  fadeAlpha: number; // 0.0 ~ 1.0 兼容字段
  children?: SurfaceTileItem[];
  parent?: SurfaceTileItem;
  lastUsedTimestamp: number;
}
