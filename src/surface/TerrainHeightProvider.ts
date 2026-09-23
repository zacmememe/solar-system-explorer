/**
 * 地表高程与碰撞提供者 TerrainHeightProvider
 * 批次演进：
 * - R5：解析高斯场示意地形（P2 起已删除，历史见 git；不得称为真实地形）；
 * - P2：统一入口改为真实栅格 DEM 后端（LROC NAC DTM APOLLO17，5 m/px，pack-dem 打包）。
 *   渲染几何网格、碰撞检测、相机视高 (AGL) 与 HUD 仪表 100% 消费同一套采样核心；
 *   窗外显式回退 datum-sphere（基准球 0 高程），不再以解析山体伪装真实地貌。
 */

import * as THREE from 'three';
import type { BodyId } from '../contracts/body';
import { RasterTerrainSource, type TerrainHeightSample } from './RasterTerrainSource';

export interface TerrainProfile {
  bodyId: BodyId;
  referenceRadiusKm: number;
  hasLocalDTM: boolean;
  demAdmissionState?: string;
}

export class TerrainHeightProvider {
  private static instance: TerrainHeightProvider | null = null;

  // 月球基准球半径 (km / m) —— 与 NAC DTM APOLLO17 垂直基准（球体 1737.4 km）一致
  public static readonly MOON_DATUM_RADIUS_KM = 1737.4;
  public static readonly MOON_DATUM_RADIUS_M = 1737400.0;

  private raster: RasterTerrainSource = RasterTerrainSource.getInstance();

  public static getInstance(): TerrainHeightProvider {
    if (!this.instance) {
      this.instance = new TerrainHeightProvider();
    }
    return this.instance;
  }

  /**
   * 指定经纬度相对基准球的高程（单位：米）。
   * 窗内返回真实 DEM 双线性值；窗外/未装载/NoData 返回 0（基准球）——
   * 调用方需区分两者时应使用 getHeightSample 获取 fidelity/溯源。
   */
  public getHeightMeters(bodyId: BodyId, lat: number, lon: number): number {
    if (bodyId !== 'moon') return 0; // 其他天体暂无本地 DTM
    return this.raster.sampleHeight(lat, lon).heightM;
  }

  /** 带溯源的高程采样：measured-dem（真实 DTM）或 datum-sphere（基准球回退） */
  public getHeightSample(bodyId: BodyId, lat: number, lon: number): TerrainHeightSample {
    if (bodyId !== 'moon') {
      return { valid: true, heightM: 0, fidelity: 'datum-sphere', sourceId: null };
    }
    const s = this.raster.sampleHeight(lat, lon);
    if (s.valid) return s;
    // 窗外/NoData：显式回退基准球（不是隐式 0 米平原——fidelity 标注 datum-sphere）
    if (s.reason === 'outside' || s.reason === 'nodata') {
      return { valid: true, heightM: 0, fidelity: 'datum-sphere', sourceId: null };
    }
    return s; // not-loaded
  }

  public get isRasterReady(): boolean {
    return this.raster.isReady;
  }

  public get rasterAdmissionState(): string {
    return this.raster.terrainAdmissionState;
  }

  /** 将高程（米）折算为场景单位渲染半径 */
  public getSceneSurfaceRadius(
    bodyId: BodyId,
    lat: number,
    lon: number,
    baseRadius: number
  ): number {
    const elevM = this.getHeightMeters(bodyId, lat, lon);
    const datumM =
      bodyId === 'moon'
        ? TerrainHeightProvider.MOON_DATUM_RADIUS_M
        : 6371000.0;
    const scaleFactor = baseRadius / datumM;
    return baseRadius + elevM * scaleFactor;
  }

  /**
   * 计算相机相对地表的净离地高度 (AGL - Above Ground Level, 单位：米)
   */
  public getAltitudeAGL(
    bodyId: BodyId,
    cameraPos: THREE.Vector3,
    bodyWorldPos: THREE.Vector3,
    baseRadius: number
  ): number {
    const relVec = new THREE.Vector3().subVectors(cameraPos, bodyWorldPos);
    const dist = relVec.length();
    if (dist < 1e-6) return 0;

    // 与渲染约定一致的球面坐标基：+X=0°经, +Y=北极, −Z=90°E
    const dir = relVec.clone().normalize();
    const lat = THREE.MathUtils.radToDeg(Math.asin(Math.max(-1, Math.min(1, dir.y))));
    const lon = THREE.MathUtils.radToDeg(Math.atan2(-dir.z, dir.x));

    const surfaceRadius = this.getSceneSurfaceRadius(bodyId, lat, lon, baseRadius);
    const datumM =
      bodyId === 'moon'
        ? TerrainHeightProvider.MOON_DATUM_RADIUS_M
        : 6371000.0;
    const sceneToMeter = datumM / baseRadius;

    const clearanceScene = Math.max(0, dist - surfaceRadius);
    return clearanceScene * sceneToMeter;
  }

  /**
   * 计算相机相对基准球海平面的海拔高度 (MSL, 单位：米)
   */
  public getAltitudeMSL(
    bodyId: BodyId,
    cameraPos: THREE.Vector3,
    bodyWorldPos: THREE.Vector3,
    baseRadius: number
  ): number {
    const dist = cameraPos.distanceTo(bodyWorldPos);
    const datumM =
      bodyId === 'moon'
        ? TerrainHeightProvider.MOON_DATUM_RADIUS_M
        : 6371000.0;
    const sceneToMeter = datumM / baseRadius;
    return (dist - baseRadius) * sceneToMeter;
  }

  /**
   * 计算机位下方的地表倾角与法线向量 (按真实 DEM 梯度)
   */
  public getSurfaceNormal(
    bodyId: BodyId,
    lat: number,
    lon: number,
    baseRadius: number
  ): THREE.Vector3 {
    const eps = 0.00005; // 约 1.5 米采样跨距（接近 5m 像元的亚像元梯度）
    const pCenter = this.latLonToVector3(bodyId, lat, lon, baseRadius);
    const pNorth = this.latLonToVector3(bodyId, lat + eps, lon, baseRadius);
    const pEast = this.latLonToVector3(bodyId, lat, lon + eps, baseRadius);

    const vNorth = new THREE.Vector3().subVectors(pNorth, pCenter);
    const vEast = new THREE.Vector3().subVectors(pEast, pCenter);
    const normal = new THREE.Vector3().crossVectors(vEast, vNorth).normalize();
    return normal;
  }

  /**
   * 经纬度转局部笛卡尔坐标（+X=0°经, +Y=北极, −Z=90°E 渲染约定）
   */
  public latLonToVector3(
    bodyId: BodyId,
    lat: number,
    lon: number,
    baseRadius: number
  ): THREE.Vector3 {
    const r = this.getSceneSurfaceRadius(bodyId, lat, lon, baseRadius);
    const latRad = THREE.MathUtils.degToRad(lat);
    const lonRad = THREE.MathUtils.degToRad(lon);
    const cosLat = Math.cos(latRad);
    return new THREE.Vector3(
      r * cosLat * Math.cos(lonRad),
      r * Math.sin(latRad),
      -r * cosLat * Math.sin(lonRad)
    );
  }

  /**
   * 构建真实 DTM 地表网格（P2：由 RasterTerrainSource 的 DEM 窗口驱动）。
   * 必须在栅格装载完成后调用；返回 null 表示数据未就绪（调用方不得伪造地形）。
   * 几何覆盖 DEM 窗口全部范围；UV 与正射 ortho.u16 网格一一对应（v=0 = 北）。
   */
  public buildDemWindowGeometry(baseRadius: number, maxSegments = 400): THREE.BufferGeometry | null {
    if (!this.raster.isReady) return null;
    const bounds = this.raster.windowBounds;
    if (!bounds) return null;

    const segsLat = maxSegments;
    const segsLon = maxSegments;
    const dLat = (bounds.latMax - bounds.latMin) / segsLat;
    const dLon = (bounds.lonMax - bounds.lonMin) / segsLon;

    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= segsLat; i++) {
      const lat = bounds.latMin + i * dLat; // 南 → 北
      const v = 1 - i / segsLat; // v=1 = 南（ortho 行末），v=0 = 北（ortho 行 0）

      for (let j = 0; j <= segsLon; j++) {
        const lon = bounds.lonMin + j * dLon;
        const u = j / segsLon;

        const pos = this.latLonToVector3('moon', lat, lon, baseRadius);
        positions.push(pos.x, pos.y, pos.z);
        uvs.push(u, v);
      }
    }

    const rowStride = segsLon + 1;
    for (let i = 0; i < segsLat; i++) {
      for (let j = 0; j < segsLon; j++) {
        const a = i * rowStride + j; // (lat_i, lon_j) 偏南
        const b = (i + 1) * rowStride + j; // 偏北
        const c = (i + 1) * rowStride + (j + 1);
        const d = i * rowStride + (j + 1);

        // 外向绕序 (P1 勘误结论)：lat 增 × lon 增 叉积指向球面外侧，
        // FrontSide 只画外向面；DoubleSide 不是绕序修复。
        indices.push(a, d, b);
        indices.push(b, d, c);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }
}
