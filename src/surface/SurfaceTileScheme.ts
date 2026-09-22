/**
 * 地理经纬度双根四叉树数学方案 (Dual-Root Quadtree Tile Scheme)
 * 遵循主方案第 5.2 节规范：
 * - 经度 [-180, 180)，纬度 [-90, 90]；
 * - L=0 双根：西半球 (0,0,0) 与东半球 (0,1,0)；
 * - 第 L 层：横向 2^(L+1) 格，纵向 2^L 格；
 * - 瓦片行号 y 由北向南，列号 x 由西向东。
 */

import * as THREE from 'three';
import { TileCoordinate, TileBoundingBox } from '../contracts/surface';

export class SurfaceTileScheme {
  /**
   * 生成瓦片唯一标识符 key，格式如 "z/x/y"
   */
  public static tileKey(coord: TileCoordinate): string {
    return `${coord.z}/${coord.x}/${coord.y}`;
  }

  /**
   * 解析瓦片标识符
   */
  public static parseTileKey(key: string): TileCoordinate {
    const parts = key.split('/');
    if (parts.length !== 3) {
      throw new Error(`Invalid tile key format: ${key}`);
    }
    return {
      z: parseInt(parts[0], 10),
      x: parseInt(parts[1], 10),
      y: parseInt(parts[2], 10),
    };
  }

  /**
   * 检验瓦片坐标是否在合法网格范围内
   */
  public static isValidCoordinate(coord: TileCoordinate): boolean {
    if (coord.z < 0) return false;
    const maxX = Math.pow(2, coord.z + 1);
    const maxY = Math.pow(2, coord.z);
    return coord.x >= 0 && coord.x < maxX && coord.y >= 0 && coord.y < maxY;
  }

  /**
   * 获取指定瓦片的地理经纬度包围盒 (度)
   */
  public static getTileBoundingBox(coord: TileCoordinate): TileBoundingBox {
    const numCols = Math.pow(2, coord.z + 1);
    const numRows = Math.pow(2, coord.z);

    const deltaLon = 360.0 / numCols;
    const deltaLat = 180.0 / numRows;

    const lonMin = -180.0 + coord.x * deltaLon;
    const lonMax = lonMin + deltaLon;

    const latMax = 90.0 - coord.y * deltaLat;
    const latMin = latMax - deltaLat;

    return {
      lonMin,
      lonMax,
      latMin,
      latMax,
    };
  }

  /**
   * 获取父级瓦片坐标 (L=0 时返回 null)
   */
  public static getParentCoordinate(coord: TileCoordinate): TileCoordinate | null {
    if (coord.z <= 0) return null;
    return {
      z: coord.z - 1,
      x: Math.floor(coord.x / 2),
      y: Math.floor(coord.y / 2),
    };
  }

  /**
   * 获取 4 个四叉树子瓦片坐标
   */
  public static getChildCoordinates(coord: TileCoordinate): TileCoordinate[] {
    const nextZ = coord.z + 1;
    const baseCol = coord.x * 2;
    const baseRow = coord.y * 2;

    return [
      { z: nextZ, x: baseCol, y: baseRow },         // 西北 (North-West)
      { z: nextZ, x: baseCol + 1, y: baseRow },     // 东北 (North-East)
      { z: nextZ, x: baseCol, y: baseRow + 1 },     // 西南 (South-West)
      { z: nextZ, x: baseCol + 1, y: baseRow + 1 }, // 东南 (South-East)
    ];
  }

  /**
   * 地理经纬度转局部三维球体笛卡尔坐标
   * 遵循规范与 Three.js 原生 SphereGeometry 完全对齐：
   * - +Y 为地理北极；
   * - 全球 UV(0.5, 0.5) 映射在 +X 轴 (本初子午线经度 0°, 赤道 0°)；
   * - 东经 90° 映射在 -Z 轴；西经 90° 映射在 +Z 轴；
   * @param latDeg 纬度 (-90 到 +90)
   * @param lonDeg 经度 (-180 到 +180)
   * @param radius 球体物理半径
   */
  public static latLonToCartesian(
    latDeg: number,
    lonDeg: number,
    radius: number,
    target = new THREE.Vector3()
  ): THREE.Vector3 {
    const latRad = THREE.MathUtils.degToRad(latDeg);
    const lonRad = THREE.MathUtils.degToRad(lonDeg);

    const cosLat = Math.cos(latRad);
    target.x = radius * cosLat * Math.cos(lonRad);
    target.y = radius * Math.sin(latRad);
    target.z = -radius * cosLat * Math.sin(lonRad);

    return target;
  }

  /**
   * 计算子瓦片在祖先瓦片纹理中的对应 UV 坐标
   * y 瓦片由北向南递增，纹理 v 由南向北递增
   */
  public static ancestorUv(
    child: TileCoordinate,
    ancestor: TileCoordinate,
    u: number,
    v: number
  ): [number, number] {
    if (ancestor.z > child.z) {
      throw new RangeError('Ancestor level cannot be greater than child level');
    }
    const n = Math.pow(2, child.z - ancestor.z);
    if (Math.floor(child.x / n) !== ancestor.x || Math.floor(child.y / n) !== ancestor.y) {
      throw new RangeError('Provided ancestor tile does not cover child tile');
    }
    const ox = child.x - ancestor.x * n;
    const oy = child.y - ancestor.y * n;
    return [(ox + u) / n, (n - 1 - oy + v) / n];
  }

  /**
   * 计算子瓦片采样祖先纹理的仿射变换 offset 与 scale
   * coarseUv = offset + childUv * scale
   */
  public static getAncestorUvTransform(
    child: TileCoordinate,
    ancestor: TileCoordinate
  ): { offset: THREE.Vector2; scale: THREE.Vector2 } {
    if (ancestor.z > child.z) {
      throw new RangeError('Ancestor level cannot be greater than child level');
    }
    const n = Math.pow(2, child.z - ancestor.z);
    if (Math.floor(child.x / n) !== ancestor.x || Math.floor(child.y / n) !== ancestor.y) {
      throw new RangeError('Provided ancestor tile does not cover child tile');
    }
    const ox = child.x - ancestor.x * n;
    const oy = child.y - ancestor.y * n;
    return {
      offset: new THREE.Vector2(ox / n, (n - 1 - oy) / n),
      scale: new THREE.Vector2(1 / n, 1 / n),
    };
  }

  /**
   * 屏幕空间像素误差 (Screen Space Error, SSE) 计算
   * @param errorWorld 世界空间几何误差 (与 distanceWorld 同单位)
   * @param distanceWorld 相机到瓦片的视距
   * @param viewportHeightPixels 视口高度 (像素)
   * @param fovDegrees 垂直视场角 (度)
   */
  public static screenSpaceError(
    errorWorld: number,
    distanceWorld: number,
    viewportHeightPixels: number,
    fovDegrees: number
  ): number {
    if (distanceWorld <= 0 || viewportHeightPixels <= 0 || fovDegrees <= 0 || fovDegrees >= 179) {
      return 0;
    }
    const focalPixels = viewportHeightPixels / (2 * Math.tan((fovDegrees * Math.PI) / 360));
    return (errorWorld * focalPixels) / distanceWorld;
  }

  /**
   * 检查特定瓦片是否在数据集覆盖范围或 ROI 范围内
   */
  public static isTileCoveredByRoi(
    coord: TileCoordinate,
    rois?: Array<{ lonMin: number; lonMax: number; latMin: number; latMax: number; targetLevel: number }>
  ): boolean {
    // L0, L1, L2 是全球全覆盖金字塔
    if (coord.z <= 2) return true;
    if (!rois || rois.length === 0) return false;

    const bbox = this.getTileBoundingBox(coord);
    for (const roi of rois) {
      if (coord.z <= roi.targetLevel) {
        // 包围盒相交测试
        const lonOverlap = !(bbox.lonMax < roi.lonMin || bbox.lonMin > roi.lonMax);
        const latOverlap = !(bbox.latMax < roi.latMin || bbox.latMin > roi.latMax);
        if (lonOverlap && latOverlap) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 获取瓦片中心点三维空间坐标
   */
  public static getTileCenter(coord: TileCoordinate, radius: number, target = new THREE.Vector3()): THREE.Vector3 {
    const bbox = this.getTileBoundingBox(coord);
    const centerLon = (bbox.lonMin + bbox.lonMax) * 0.5;
    const centerLat = (bbox.latMin + bbox.latMax) * 0.5;
    return this.latLonToCartesian(centerLat, centerLon, radius, target);
  }

  /**
   * 计算瓦片的外接包围球 (用于视锥体快速相交测试)
   */
  public static getTileBoundingSphere(coord: TileCoordinate, radius: number): THREE.Sphere {
    const bbox = this.getTileBoundingBox(coord);
    const center = this.getTileCenter(coord, radius);

    // 选取 4 个角点测量最大外接欧式距离
    const p1 = this.latLonToCartesian(bbox.latMin, bbox.lonMin, radius);
    const p2 = this.latLonToCartesian(bbox.latMax, bbox.lonMax, radius);
    const p3 = this.latLonToCartesian(bbox.latMin, bbox.lonMax, radius);
    const p4 = this.latLonToCartesian(bbox.latMax, bbox.lonMin, radius);
    const maxDist = Math.max(
      center.distanceTo(p1),
      center.distanceTo(p2),
      center.distanceTo(p3),
      center.distanceTo(p4)
    );

    return new THREE.Sphere(center, maxDist * 1.05); // 附带 5% 安全边界
  }
}
