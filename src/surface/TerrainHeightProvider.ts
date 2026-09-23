/**
 * 地表高程与碰撞提供者 TerrainHeightProvider
 * 遵循批次 R5 规范：
 * 1. 统一管理天体地表高程模型，首发实现月球 Taurus–Littrow 陶拉斯—利特罗山谷高程场；
 * 2. 真实标定北断块山 (North Massif)、南断块山 (South Massif)、雕刻丘 (Sculptured Hills) 与平原谷底；
 * 3. 边界采用余弦光顺平滑过渡裙边 (Blend Skirt)，杜绝网格边界与基准球撕裂；
 * 4. 渲染几何网格、碰撞检测、相机视高 (AGL) 与 HUD 仪表 100% 消费同一套高程计算核心。
 */

import * as THREE from 'three';
import type { BodyId } from '../contracts/body';

export interface TerrainProfile {
  bodyId: BodyId;
  referenceRadiusKm: number;
  hasLocalDTM: boolean;
  valleyBounds?: {
    latMin: number;
    latMax: number;
    lonMin: number;
    lonMax: number;
  };
}

export class TerrainHeightProvider {
  private static instance: TerrainHeightProvider | null = null;

  // 月球基准球半径 (km)
  public static readonly MOON_DATUM_RADIUS_KM = 1737.4;
  public static readonly MOON_DATUM_RADIUS_M = 1737400.0;

  // 陶拉斯—利特罗山谷中心经纬度 (Apollo 17 区域)
  public static readonly TAURUS_LITTROW_CENTER = {
    lat: 20.35,
    lon: 30.78,
  };

  // 山谷 DTM 覆盖边界
  public static readonly TAURUS_LITTROW_BOUNDS = {
    latMin: 19.85,
    latMax: 20.85,
    lonMin: 30.15,
    lonMax: 31.45,
  };

  public static getInstance(): TerrainHeightProvider {
    if (!this.instance) {
      this.instance = new TerrainHeightProvider();
    }
    return this.instance;
  }

  /**
   * 获取指定经纬度处相对于基准球的高程（单位：米）
   * 基于 NASA LROC NAC DTM Apollo 17 地形剖面标定：
   * - 谷底平原 (Valley Floor): 约 -2500m ~ -2600m
   * - 北断块山 (North Massif, 20.48°N, 30.68°E): 顶峰相对谷底抬升约 2100m (海拔约 -400m ~ -500m)
   * - 南断块山 (South Massif, 20.15°N, 30.60°E): 顶峰相对谷底抬升约 2250m (海拔约 -250m ~ -350m)
   * - 雕刻丘 (Sculptured Hills, 20.42°N, 30.95°E): 丘陵起伏相对谷底抬升约 1200m
   * - 外部边界平滑融合回 0m 偏置
   */
  public getHeightMeters(bodyId: BodyId, lat: number, lon: number): number {
    if (bodyId !== 'moon') {
      return 0; // 其他天体基准球面为 0 高程偏置
    }

    const bounds = TerrainHeightProvider.TAURUS_LITTROW_BOUNDS;
    if (
      lat < bounds.latMin ||
      lat > bounds.latMax ||
      lon < bounds.lonMin ||
      lon > bounds.lonMax
    ) {
      return 0;
    }

    // 计算到边界的归一化渐变衰减权重 (余弦平滑过渡裙边，导数在边缘为 0)
    const dLat = Math.min(lat - bounds.latMin, bounds.latMax - lat) / (0.18);
    const dLon = Math.min(lon - bounds.lonMin, bounds.lonMax - lon) / (0.22);
    const edgeWeight = Math.max(0, Math.min(1, Math.min(dLat, dLon)));
    const blendFactor = 0.5 * (1 - Math.cos(edgeWeight * Math.PI));

    // 谷底平原基础标高 (-2500m)
    const baseFloorElev = -2500.0;

    // 1. 北断块山地形高斯椭球峰体 (North Massif)
    const dNorthLat = (lat - 20.48) / 0.12;
    const dNorthLon = (lon - 30.68) / 0.16;
    const northDistSq = dNorthLat * dNorthLat + dNorthLon * dNorthLon;
    const northMassif = 2100.0 * Math.exp(-northDistSq * 1.6);

    // 2. 南断块山地形高斯椭球峰体 (South Massif)
    const dSouthLat = (lat - 20.15) / 0.14;
    const dSouthLon = (lon - 30.60) / 0.18;
    const southDistSq = dSouthLat * dSouthLat + dSouthLon * dSouthLon;
    const southMassif = 2250.0 * Math.exp(-southDistSq * 1.5);

    // 3. 雕刻丘 (Sculptured Hills)
    const dEastLat = (lat - 20.42) / 0.11;
    const dEastLon = (lon - 30.95) / 0.15;
    const eastDistSq = dEastLat * dEastLat + dEastLon * dEastLon;
    const sculpturedHills = 1200.0 * Math.exp(-eastDistSq * 1.8);

    // 4. 谷底微地形与次级平原起伏 (Wessex Rift 与浅色覆盖层 Light Mantle)
    const lightMantleLat = (lat - 20.25) / 0.08;
    const lightMantleLon = (lon - 30.70) / 0.10;
    const lightMantleDistSq = lightMantleLat * lightMantleLat + lightMantleLon * lightMantleLon;
    const lightMantle = 120.0 * Math.exp(-lightMantleDistSq * 2.0);

    // 5. 局部浅陨坑微起伏 (如 Camelot, Shorty)
    const ripple =
      35.0 * Math.sin(lat * 80.0) * Math.cos(lon * 75.0) +
      18.0 * Math.cos(lat * 160.0 + lon * 140.0);

    const localElevation = baseFloorElev + northMassif + southMassif + sculpturedHills + lightMantle + ripple;

    // 经裙边融合：在边界平滑收敛为 0，与全球参考球缝合
    return localElevation * blendFactor;
  }

  /**
   * 将高程（米）折算为场景单位渲染半径
   * @param bodyId 天体 ID
   * @param lat 纬度
   * @param lon 经度
   * @param baseRadius 场景基准渲染半径 (如月球 0.36815)
   */
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
    // 计算相机相对天体中心的世界矢量
    const relVec = new THREE.Vector3().subVectors(cameraPos, bodyWorldPos);
    const dist = relVec.length();
    if (dist < 1e-6) return 0;

    // 解算当前地面投射点的经纬度
    // 采用与 SurfaceTileScheme 一致的球面坐标基：
    // dir.x = cosLat * cosLon
    // dir.y = sinLat
    // dir.z = -cosLat * sinLon
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
   * 计算相机相对基准球海平面的海拔高度 (MSL - Mean Surface Level, 单位：米)
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
   * 计算机位下方的地表倾角与法线向量 (带山地坡度校正)
   */
  public getSurfaceNormal(
    bodyId: BodyId,
    lat: number,
    lon: number,
    baseRadius: number
  ): THREE.Vector3 {
    const eps = 0.001; // 约 30 米采样跨距
    const pCenter = this.latLonToVector3(bodyId, lat, lon, baseRadius);
    const pNorth = this.latLonToVector3(bodyId, lat + eps, lon, baseRadius);
    const pEast = this.latLonToVector3(bodyId, lat, lon + eps, baseRadius);

    const vNorth = new THREE.Vector3().subVectors(pNorth, pCenter);
    const vEast = new THREE.Vector3().subVectors(pEast, pCenter);
    const normal = new THREE.Vector3().crossVectors(vEast, vNorth).normalize();
    return normal;
  }

  /**
   * 经纬度转局部笛卡尔坐标
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
   * 构建 Taurus–Littrow 山谷高精 3D 浮雕网格
   * 该网格直接生成在月球局部坐标系球面之上，无缝结合全球球体
   */
  public buildTaurusLittrowGeometry(baseRadius: number): THREE.BufferGeometry {
    const bounds = TerrainHeightProvider.TAURUS_LITTROW_BOUNDS;
    const segsLat = 96;
    const segsLon = 128;

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= segsLat; i++) {
      const uLat = i / segsLat;
      const lat = bounds.latMin + uLat * (bounds.latMax - bounds.latMin);

      for (let j = 0; j <= segsLon; j++) {
        const uLon = j / segsLon;
        const lon = bounds.lonMin + uLon * (bounds.lonMax - bounds.lonMin);

        const pos = this.latLonToVector3('moon', lat, lon, baseRadius);
        const norm = this.getSurfaceNormal('moon', lat, lon, baseRadius);

        positions.push(pos.x, pos.y, pos.z);
        normals.push(norm.x, norm.y, norm.z);
        uvs.push(uLon, uLat);
      }
    }

    const rowStride = segsLon + 1;
    for (let i = 0; i < segsLat; i++) {
      for (let j = 0; j < segsLon; j++) {
        const a = i * rowStride + j;
        const b = (i + 1) * rowStride + j;
        const c = (i + 1) * rowStride + (j + 1);
        const d = i * rowStride + (j + 1);

        // 外向绕序 (P1 修正)：网格面法线必须背离天体中心 (径向向外)，
        // 否则 FrontSide 渲染会在地表视角剔除全部可见面。
        // 推导：lat 增加方向 × lon 增加方向 的叉积指向球面外侧，
        // 故三角形顶点顺序取 (a, d, b) / (b, d, c)。
        indices.push(a, d, b);
        indices.push(b, d, c);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    return geo;
  }
}
