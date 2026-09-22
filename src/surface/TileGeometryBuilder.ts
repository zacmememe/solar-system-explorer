/**
 * 地表瓦片曲面网格几何体构建器 (TileGeometryBuilder)
 * 依据经纬度包围盒与天体半径生成标准高精球面曲面网格 (Patch Geometry)
 */

import * as THREE from 'three';
import { TileBoundingBox } from '../contracts/surface';
import { SurfaceTileScheme } from './SurfaceTileScheme';

export class TileGeometryBuilder {
  /**
   * 构建单个瓦片的球面弧面网格几何体
   * @param bbox 瓦片经纬度范围
   * @param radius 星体物理/显示半径
   * @param segments 内部细分分辨率 (默认 16x16)
   */
  public static buildPatchGeometry(
    bbox: TileBoundingBox,
    radius: number,
    segments = 16
  ): THREE.BufferGeometry {
    const widthSegments = Math.max(4, segments);
    const heightSegments = Math.max(4, segments);

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const deltaLon = bbox.lonMax - bbox.lonMin;
    const deltaLat = bbox.latMax - bbox.latMin;

    const tempPos = new THREE.Vector3();

    // 生成网格顶点
    for (let j = 0; j <= heightSegments; j++) {
      // v 从 0 (南边缘) 到 1 (北边缘)
      const v = j / heightSegments;
      const lat = bbox.latMin + v * deltaLat;

      for (let i = 0; i <= widthSegments; i++) {
        // u 从 0 (西边缘) 到 1 (东边缘)
        const u = i / widthSegments;
        const lon = bbox.lonMin + u * deltaLon;

        SurfaceTileScheme.latLonToCartesian(lat, lon, radius, tempPos);

        positions.push(tempPos.x, tempPos.y, tempPos.z);

        // 球面法线从球心向外单位化
        const norm = tempPos.clone().normalize();
        normals.push(norm.x, norm.y, norm.z);

        // UV 坐标：u 沿经度，v 沿纬度
        uvs.push(u, v);
      }
    }

    // 生成三角形面索引 (网格拓扑)
    const rowStride = widthSegments + 1;
    for (let j = 0; j < heightSegments; j++) {
      for (let i = 0; i < widthSegments; i++) {
        const a = j * rowStride + i;
        const b = a + 1;
        const c = a + rowStride;
        const d = c + 1;

        // 逆时针朝外：三角形 (a, c, b) 与 (b, c, d)
        indices.push(a, c, b);
        indices.push(b, c, d);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);

    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    return geometry;
  }
}
