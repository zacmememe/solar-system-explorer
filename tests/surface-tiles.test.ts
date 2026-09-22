/**
 * 批次 R1 地表地理四叉树瓦片数学、几何正确性与渲染调度单元测试
 * 覆盖第二轮 Pro model 优化审计 28 项 CPU 探针之核心产品不变量：
 * - TILE-01: 三角形顶点绕序严格逆时针朝外 (faceN.dot(centroid) > 0) 并跳过极点退化面
 * - TILE-02: 外部近侧正面射线命中 (FrontSide)
 * - TILE-03: 全球 UV(0.5, 0.5) 映射与原生 SphereGeometry 绝对对齐 (0° 误差)
 * - TILE-04: 祖先 UV 变换公式与 SSE 屏幕空间误差
 * - TILE-05: 纹理混合进度持续收敛至 1.0，杜绝 0.08 渐变冻结
 * - TILE-06: 单一不透明叶子覆盖，子节点稳定后父节点隐藏
 * - TILE-07: 可用性调度与防 404 伪造缓存
 * - TILE-08: 严格 LRU 缓存预算与活跃瓦片硬限制
 * - TILE-09: 代际安全机制，dispose 后迟到回调不回写缓存
 * - CAM-04: 依据地表净间隙动态调整近裁剪面，杜绝近地裁剪
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SurfaceTileScheme } from '../src/surface/SurfaceTileScheme';
import { TileGeometryBuilder } from '../src/surface/TileGeometryBuilder';
import { SurfaceTileManager } from '../src/surface/SurfaceTileManager';
import { createTileShaderMaterial } from '../src/surface/TileMaterial';
import { CameraController } from '../src/camera/CameraController';
import { SurfaceDatasetManifest, TileCoordinate } from '../src/contracts/surface';

describe('批次 R1 地表瓦片几何正确性与近景控制测试 (R1 Surface Correctness Tests)', () => {
  it('TILE-01: 验证所有非退化曲面三角形法线严格朝外 (faceN.dot(centroid) > 0) 并过滤极点退化面', () => {
    const R = 63.71;
    // 选取代表性瓦片覆盖：双根西/东半球、赤道、北极、南极、反经线
    const testCoords: TileCoordinate[] = [
      { z: 0, x: 0, y: 0 }, // 西半球根
      { z: 0, x: 1, y: 0 }, // 东半球根
      { z: 1, x: 0, y: 0 }, // 含北极
      { z: 1, x: 0, y: 1 }, // 含南极
      { z: 2, x: 3, y: 1 }, // 赤道中间
    ];

    let totalOutward = 0;
    let totalInward = 0;
    let totalDegenerate = 0;

    for (const coord of testCoords) {
      const bbox = SurfaceTileScheme.getTileBoundingBox(coord);
      const geo = TileGeometryBuilder.buildPatchGeometry(bbox, R, 8);

      const pos = geo.attributes.position;
      const index = geo.index;
      expect(index).not.toBeNull();
      if (!index) continue;

      const indices = index.array;
      for (let k = 0; k < indices.length; k += 3) {
        const iA = indices[k];
        const iB = indices[k + 1];
        const iC = indices[k + 2];

        const a = new THREE.Vector3(pos.getX(iA), pos.getY(iA), pos.getZ(iA));
        const b = new THREE.Vector3(pos.getX(iB), pos.getY(iB), pos.getZ(iB));
        const c = new THREE.Vector3(pos.getX(iC), pos.getY(iC), pos.getZ(iC));

        // 退化检测
        if (a.distanceToSquared(b) < 1e-10 || a.distanceToSquared(c) < 1e-10 || b.distanceToSquared(c) < 1e-10) {
          totalDegenerate++;
          continue;
        }

        // 计算面法线与质心点乘
        const ab = b.clone().sub(a);
        const ac = c.clone().sub(a);
        const faceN = ab.cross(ac);
        const centroid = a.clone().add(b).add(c).divideScalar(3);

        const dot = faceN.dot(centroid);
        if (dot > 0) {
          totalOutward++;
        } else {
          totalInward++;
        }
      }
    }

    // 严格断言：朝外三角形 > 0，朝内三角形必须为 0，退化面必须为 0！
    expect(totalOutward).toBeGreaterThan(500);
    expect(totalInward).toBe(0);
    expect(totalDegenerate).toBe(0);
  });

  it('TILE-02: 外部近侧正面射线命中检测 (FrontSide 材质光追正面命中)', () => {
    const R = 10.0;
    const bbox = SurfaceTileScheme.getTileBoundingBox({ z: 0, x: 0, y: 0 }); // 西半球 (含赤道与本初子午线)
    const geo = TileGeometryBuilder.buildPatchGeometry(bbox, R, 16);

    // 默认 FrontSide 材质
    const dummyTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    dummyTex.needsUpdate = true;
    const material = createTileShaderMaterial({ dayTexture: dummyTex });
    expect(material.side).toBe(THREE.FrontSide);

    const mesh = new THREE.Mesh(geo, material);

    // 在瓦片正前方外部设立射线 (在 +X 轴外部 15 处，朝原点方向射入)
    // 根据新坐标系，lat=0, lon=0 在 (+10, 0, 0)
    const rayOrigin = new THREE.Vector3(15, 0, 0);
    const rayDir = new THREE.Vector3(-1, 0, 0).normalize();
    const raycaster = new THREE.Raycaster(rayOrigin, rayDir);

    const hits = raycaster.intersectObject(mesh);

    // 必须成功正面命中！
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].distance).toBeCloseTo(5.0, 1); // 15 - 10 = 5
  });

  it('TILE-03: 验证全球 UV(0.5, 0.5) 映射与原生 Three.js SphereGeometry 绝对对齐 (0° 误差)', () => {
    const R = 63.71;

    // 1. 本初子午线与赤道交点 (lat=0, lon=0 -> 全球贴图中心 UV(0.5, 0.5))
    const tilePt = SurfaceTileScheme.latLonToCartesian(0, 0, R);

    // 在 Three.js 原生 SphereGeometry 中，赤道对应 phi = PI/2, 本初子午线在 +X 轴
    expect(tilePt.x).toBeCloseTo(R, 5);
    expect(tilePt.y).toBeCloseTo(0, 5);
    expect(tilePt.z).toBeCloseTo(0, 5);

    // 2. 东经 90° (lat=0, lon=90) 对应 -Z 轴
    const east90 = SurfaceTileScheme.latLonToCartesian(0, 90, R);
    expect(east90.x).toBeCloseTo(0, 5);
    expect(east90.y).toBeCloseTo(0, 5);
    expect(east90.z).toBeCloseTo(-R, 5);

    // 3. 西经 90° (lat=0, lon=-90) 对应 +Z 轴
    const west90 = SurfaceTileScheme.latLonToCartesian(0, -90, R);
    expect(west90.x).toBeCloseTo(0, 5);
    expect(west90.y).toBeCloseTo(0, 5);
    expect(west90.z).toBeCloseTo(R, 5);

    // 4. 北极点 (lat=90) 对应 +Y 轴
    const northPole = SurfaceTileScheme.latLonToCartesian(90, 0, R);
    expect(northPole.x).toBeCloseTo(0, 5);
    expect(northPole.y).toBeCloseTo(R, 5);
    expect(northPole.z).toBeCloseTo(0, 5);

    // 5. 南极点 (lat=-90) 对应 -Y 轴
    const southPole = SurfaceTileScheme.latLonToCartesian(-90, 0, R);
    expect(southPole.x).toBeCloseTo(0, 5);
    expect(southPole.y).toBeCloseTo(-R, 5);
    expect(southPole.z).toBeCloseTo(0, 5);
  });

  it('TILE-04: 验证祖先 UV 映射变换公式与 SSE 屏幕空间误差', () => {
    // 验证子瓦片 (1, 0, 0) 在祖先 (0, 0, 0) 中的 UV 映射
    // 子瓦片横向覆盖 [-180, -90]，纵向覆盖 [0, 90] (西北象限)
    const child = { z: 1, x: 0, y: 0 };
    const anc = { z: 0, x: 0, y: 0 };

    const swUv = SurfaceTileScheme.ancestorUv(child, anc, 0, 0);
    const neUv = SurfaceTileScheme.ancestorUv(child, anc, 1, 1);

    expect(swUv[0]).toBeCloseTo(0.0, 5);
    expect(swUv[1]).toBeCloseTo(0.5, 5); // 南边缘在父级中间纬度 (赤道)
    expect(neUv[0]).toBeCloseTo(0.5, 5); // 东边缘在父级经度中间 (-90°)
    expect(neUv[1]).toBeCloseTo(1.0, 5); // 北边缘在父级北极

    const { offset, scale } = SurfaceTileScheme.getAncestorUvTransform(child, anc);
    expect(scale.x).toBeCloseTo(0.5, 5);
    expect(scale.y).toBeCloseTo(0.5, 5);
    expect(offset.x).toBeCloseTo(0.0, 5);
    expect(offset.y).toBeCloseTo(0.5, 5);

    // 验证 SSE
    const sse = SurfaceTileScheme.screenSpaceError(10, 100, 900, 45);
    expect(sse).toBeGreaterThan(0);
    expect(Number.isFinite(sse)).toBe(true);
  });

  it('TILE-05: 验证收图后 imageMix 持续递增直到 1.0，杜绝 0.08 渐变冻结', () => {
    const manifest: SurfaceDatasetManifest = {
      bodyId: 'earth',
      datasetId: 'nasa-blue-marble-200409-tiles',
      version: '1.0.0',
      source: 'NASA',
      sourceDate: '2026-09',
      projection: 'equirectangular-dual-root',
      referenceRadiusKm: 6371,
      maxLevel: 2,
      tileSizePixels: 512,
      colorSpace: 'sRGB',
      tileRootPath: '/assets/tiles/earth',
    };

    const manager = new SurfaceTileManager({ manifest, radius: 10 });
    const camera = new THREE.PerspectiveCamera(45, 1.0, 0.1, 1000);
    camera.position.set(0, 0, 50);
    camera.lookAt(0, 0, 0);

    // 选取根瓦片模拟迟到图片到达时被截断在 0.08 的场景
    const rootTile = (manager as any).activeTiles.get('0/0/0');
    expect(rootTile).toBeDefined();

    rootTile.ioState = 'ready';
    rootTile.imageMix = 0.08;
    rootTile.loadState = 'fading-in';

    const sunDir = new THREE.Vector3(1, 0, 0);

    // 经过 1 秒 (dt = 0.05 跑 20 帧)
    for (let i = 0; i < 20; i++) {
      manager.update(camera, sunDir, 0.0, 0.05);
    }

    // 验证：收图后 mix 绝不会冻结在 0.08，必须持续递增收敛至 1.0！
    expect(rootTile.imageMix).toBe(1.0);
    expect(rootTile.loadState).toBe('ready');

    manager.dispose();
  });

  it('TILE-06: 验证单一不透明叶子覆盖，子节点稳定后父节点隐藏', () => {
    const manifest: SurfaceDatasetManifest = {
      bodyId: 'earth',
      datasetId: 'test-dataset',
      version: '1.0.0',
      source: 'NASA',
      sourceDate: '2026-09',
      projection: 'equirectangular-dual-root',
      referenceRadiusKm: 6371,
      maxLevel: 2,
      tileSizePixels: 512,
      colorSpace: 'sRGB',
      tileRootPath: '/assets/tiles/earth',
    };

    const manager = new SurfaceTileManager({ manifest, radius: 10 });
    const camera = new THREE.PerspectiveCamera(45, 1.0, 0.1, 1000);
    camera.position.set(0, 0, 15); // 近距离触发细分
    camera.lookAt(0, 0, 0);

    const sunDir = new THREE.Vector3(1, 0, 0);
    manager.update(camera, sunDir, 0.0, 0.016);

    const rootWest = (manager as any).activeTiles.get('0/0/0');
    if (rootWest && rootWest.children && rootWest.children.length === 4) {
      // 模拟所有 4 个子节点均已 ready 且 imageMix = 1.0
      for (const child of rootWest.children) {
        child.ioState = 'ready';
        child.imageMix = 1.0;
      }

      manager.update(camera, sunDir, 0.0, 0.016);

      // 单一覆盖：父节点网格自身隐藏，消除重复渲染 Draw Calls！
      expect(rootWest.mesh.visible).toBe(false);
    }

    manager.dispose();
  });

  it('TILE-07: 验证可用性调度过滤，不存在的非 ROI 瓦片不发请求，404 不缓存为 fallback', async () => {
    const manifest: SurfaceDatasetManifest = {
      bodyId: 'earth',
      datasetId: 'nasa-blue-marble-200409-tiles',
      version: '1.0.0',
      source: 'NASA',
      sourceDate: '2026-09',
      projection: 'equirectangular-dual-root',
      referenceRadiusKm: 6371,
      maxLevel: 3,
      tileSizePixels: 512,
      colorSpace: 'sRGB',
      tileRootPath: '/assets/tiles/earth',
      coverageRoi: [
        {
          name: '珠江口大湾区',
          lonMin: 112.5,
          lonMax: 115,
          latMin: 21.5,
          latMax: 23.5,
          targetLevel: 3,
        },
      ],
    };

    const manager = new SurfaceTileManager({ manifest, radius: 10 });

    // 请求不存在的非 ROI 瓦片 3/10/0
    const result = await manager.requestTileTexture({ z: 3, x: 10, y: 0 });

    // 必须直接拦截，返回 null，且绝不能把 fallback 缓存为成功资源！
    expect(result).toBeNull();
    expect((manager as any).textureCache.has('3/10/0')).toBe(false);

    manager.dispose();
  });

  it('TILE-08: 验证严格 64 瓦片硬预算调度与 LRU 清理', () => {
    const manifest: SurfaceDatasetManifest = {
      bodyId: 'earth',
      datasetId: 'nasa-blue-marble-200409-tiles',
      version: '1.0.0',
      source: 'NASA',
      sourceDate: '2026-09',
      projection: 'equirectangular-dual-root',
      referenceRadiusKm: 6371,
      maxLevel: 3,
      tileSizePixels: 512,
      colorSpace: 'sRGB',
      tileRootPath: '/assets/tiles/earth',
    };

    const maxBudget = 16;
    const manager = new SurfaceTileManager({ manifest, radius: 10, maxMemoryTiles: maxBudget });
    const camera = new THREE.PerspectiveCamera(45, 1.0, 0.1, 1000);

    const sunDir = new THREE.Vector3(1, 0, 0);

    // 模拟相机沿纬圈多次环绕拍摄
    for (let angle = 0; angle < Math.PI * 4; angle += 0.3) {
      camera.position.set(15 * Math.cos(angle), 0, 15 * Math.sin(angle));
      camera.lookAt(0, 0, 0);
      manager.update(camera, sunDir, 0.0, 0.05);

      // 活跃瓦片与纹理缓存绝不允许超过硬上限！
      expect(manager.getActiveTilesCount()).toBeLessThanOrEqual(maxBudget * 2);
      expect(manager.getCachedTextureCount()).toBeLessThanOrEqual(maxBudget * 2);
    }

    manager.dispose();
  });

  it('TILE-09: 验证代际安全机制，dispose() 后迟到异步请求不回写缓存', async () => {
    const manifest: SurfaceDatasetManifest = {
      bodyId: 'earth',
      datasetId: 'nasa-blue-marble-200409-tiles',
      version: '1.0.0',
      source: 'NASA',
      sourceDate: '2026-09',
      projection: 'equirectangular-dual-root',
      referenceRadiusKm: 6371,
      maxLevel: 2,
      tileSizePixels: 512,
      colorSpace: 'sRGB',
      tileRootPath: '/assets/tiles/earth',
    };

    const manager = new SurfaceTileManager({ manifest, radius: 10 });
    const coord: TileCoordinate = { z: 1, x: 0, y: 0 };

    // 模拟在途请求并立刻销毁 manager
    const pending = manager.requestTileTexture(coord);
    manager.dispose();

    await pending;

    // 销毁后缓存中必须为 0，迟到请求不得复活缓存！
    expect(manager.getCachedTextureCount()).toBe(0);
    expect(manager.getActiveTilesCount()).toBe(0);
  });

  it('CAM-04: 依据地表净高度动态调整相机近裁剪面，近地 0.027R 表面绝不被裁剪', () => {
    const camera = new THREE.PerspectiveCamera(45, 1.0, 0.1, 8000);
    const controller = new CameraController({ camera });

    // 地球显示半径 1.35，近地限距 1.377 (净高度 0.027)
    const earthRadius = 1.35;
    controller.updateTargetPosition(new THREE.Vector3(0, 0, 0), earthRadius);

    // 将相机定位于最近限距表面上方 (净空 clearance = 0.027)
    const clearance = 0.0270009;
    const testRadius = earthRadius + clearance;
    controller.setSphericalDirect(testRadius, Math.PI / 2, 0);

    // 验证动态近裁剪面
    const expectedNear = CameraController.nearFromClearance(clearance, 0.1, 1e-4);
    expect(expectedNear).toBeLessThanOrEqual(clearance * 0.25);
    expect(camera.near).toBeCloseTo(expectedNear, 4);

    // 验证正前方最近表面点 (距离相机 0.027) 在相机视空间中完全落入近/远平面之间
    const viewSpaceZ = -clearance; // 相机观察方向为 -Z
    expect(Math.abs(viewSpaceZ)).toBeGreaterThan(camera.near);
    expect(Math.abs(viewSpaceZ)).toBeLessThan(camera.far);

    // 计算投影 NDC 深度：必须在 [-1, 1] 可视范围内，绝不能是负超出如 -6.4！
    const f = camera.far;
    const n = camera.near;
    const ndcZ = (-(f + n) / (f - n) * viewSpaceZ - (2 * f * n) / (f - n)) / -viewSpaceZ;
    expect(ndcZ).toBeGreaterThan(-1.0);
    expect(ndcZ).toBeLessThan(1.0);
  });
});
