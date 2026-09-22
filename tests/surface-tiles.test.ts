/**
 * 批次 B3 地表地理四叉树瓦片数学与渲染调度单元测试
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SurfaceTileScheme } from '../src/surface/SurfaceTileScheme';
import { TileGeometryBuilder } from '../src/surface/TileGeometryBuilder';
import { SurfaceTileManager } from '../src/surface/SurfaceTileManager';
import { SurfaceDatasetManifest } from '../src/contracts/surface';

describe('批次 B3 地表四叉树瓦片金字塔规范测试 (Surface Tiles Tests)', () => {
  it('TILE-01: 验证双根经纬四叉树数学方案完整性与边界闭合', () => {
    // 1. 验证 L=0 双根瓦片
    const westRoot = { z: 0, x: 0, y: 0 };
    const eastRoot = { z: 0, x: 1, y: 0 };

    const westBbox = SurfaceTileScheme.getTileBoundingBox(westRoot);
    const eastBbox = SurfaceTileScheme.getTileBoundingBox(eastRoot);

    expect(westBbox.lonMin).toBe(-180);
    expect(westBbox.lonMax).toBe(0);
    expect(westBbox.latMin).toBe(-90);
    expect(westBbox.latMax).toBe(90);

    expect(eastBbox.lonMin).toBe(0);
    expect(eastBbox.lonMax).toBe(180);
    expect(eastBbox.latMin).toBe(-90);
    expect(eastBbox.latMax).toBe(90);

    // 2. 验证子父节点互转对称性
    const children = SurfaceTileScheme.getChildCoordinates(westRoot);
    expect(children).toHaveLength(4);
    for (const child of children) {
      expect(child.z).toBe(1);
      const parent = SurfaceTileScheme.getParentCoordinate(child);
      expect(parent).toEqual(westRoot);
    }

    // 3. 验证深层网格跨度 (L=3: 16列 x 8行)
    const deepCoord = { z: 3, x: 13, y: 3 };
    const deepBbox = SurfaceTileScheme.getTileBoundingBox(deepCoord);
    const deltaLon = deepBbox.lonMax - deepBbox.lonMin;
    const deltaLat = deepBbox.latMax - deepBbox.latMin;
    expect(deltaLon).toBeCloseTo(360 / 16, 5);
    expect(deltaLat).toBeCloseTo(180 / 8, 5);
  });

  it('TILE-02: 验证球面弧面几何体生成质量与经度接缝缝合', () => {
    const R = 63.71; // 示意半径
    const westBbox = SurfaceTileScheme.getTileBoundingBox({ z: 0, x: 0, y: 0 });
    const eastBbox = SurfaceTileScheme.getTileBoundingBox({ z: 0, x: 1, y: 0 });

    const westGeo = TileGeometryBuilder.buildPatchGeometry(westBbox, R, 8);
    const eastGeo = TileGeometryBuilder.buildPatchGeometry(eastBbox, R, 8);

    const westPos = westGeo.attributes.position;
    const eastPos = eastGeo.attributes.position;

    // 1. 验证所有顶点严格落在半径为 R 的球面上
    for (let i = 0; i < westPos.count; i++) {
      const v = new THREE.Vector3(westPos.getX(i), westPos.getY(i), westPos.getZ(i));
      expect(v.length()).toBeCloseTo(R, 4);
    }

    // 2. 验证中央子午线 (lon = 0) 接缝处东、西半球对应顶点的贴合度
    // 西半球东边缘 (u=1, lon=0) 与 东半球西边缘 (u=0, lon=0)
    // 在相同纬度采样下，坐标必须严格相等
    const rowStride = 9; // segments=8 -> 9 顶点每行
    for (let j = 0; j <= 8; j++) {
      const westEastBorderIdx = j * rowStride + 8; // u=1 (东边界)
      const eastWestBorderIdx = j * rowStride + 0; // u=0 (西边界)

      const pWest = new THREE.Vector3(
        westPos.getX(westEastBorderIdx),
        westPos.getY(westEastBorderIdx),
        westPos.getZ(westEastBorderIdx)
      );
      const pEast = new THREE.Vector3(
        eastPos.getX(eastWestBorderIdx),
        eastPos.getY(eastWestBorderIdx),
        eastPos.getZ(eastWestBorderIdx)
      );

      expect(pWest.distanceTo(pEast)).toBeLessThan(1e-5);
    }

    // 3. 验证北极点法线
    const northPoleIdx = 8 * rowStride + 4; // 顶行中间
    const normY = westGeo.attributes.normal.getY(northPoleIdx);
    expect(normY).toBeGreaterThan(0.99);
  });

  it('TILE-03: 验证外接包围球与屏幕空间误差评定可靠性', () => {
    const R = 100.0;
    const coord = { z: 1, x: 2, y: 1 };
    const sphere = SurfaceTileScheme.getTileBoundingSphere(coord, R);

    // 包围球半径必须大于 0 且球心在球面内部
    expect(sphere.radius).toBeGreaterThan(0);
    expect(sphere.center.length()).toBeLessThanOrEqual(R);

    // 验证包围球容纳瓦片四个角点
    const bbox = SurfaceTileScheme.getTileBoundingBox(coord);
    const corners = [
      SurfaceTileScheme.latLonToCartesian(bbox.latMin, bbox.lonMin, R),
      SurfaceTileScheme.latLonToCartesian(bbox.latMin, bbox.lonMax, R),
      SurfaceTileScheme.latLonToCartesian(bbox.latMax, bbox.lonMin, R),
      SurfaceTileScheme.latLonToCartesian(bbox.latMax, bbox.lonMax, R),
    ];

    for (const pt of corners) {
      expect(sphere.containsPoint(pt)).toBe(true);
    }
  });

  it('TILE-04: 验证 SurfaceTileManager 节点管理与生命周期释放', () => {
    const manifest: SurfaceDatasetManifest = {
      bodyId: 'earth',
      datasetId: 'test-dataset',
      version: '1.0.0',
      source: 'NASA test',
      sourceDate: '2026-09',
      projection: 'equirectangular-dual-root',
      referenceRadiusKm: 6371,
      maxLevel: 2,
      tileSizePixels: 512,
      colorSpace: 'sRGB',
      tileRootPath: '/assets/tiles/earth',
    };

    const manager = new SurfaceTileManager({
      manifest,
      radius: 10,
      maxMemoryTiles: 8,
    });

    // 初始必须包含 2 个根瓦片
    expect(manager.group.children).toHaveLength(2);

    // 模拟相机更新
    const camera = new THREE.PerspectiveCamera(45, 1.0, 0.1, 1000);
    camera.position.set(0, 0, 50);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);

    const sunDir = new THREE.Vector3(1, 0, 0);
    manager.update(camera, sunDir, 0.0, 0.016);

    // 验证能够平稳运行而不崩溃
    expect(manager.group.children.length).toBeGreaterThanOrEqual(2);

    // 验证销毁
    manager.dispose();
    expect(manager.group.children).toHaveLength(0);
  });
});
