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
import { JezeroTerrainSource } from './JezeroTerrainSource';

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

  // 火星基准球半径 (m) —— Jezero HiRISE DTM 产品的等距圆柱局部球（15°N 局部半径，
  // 与 DTM 高程的 Mars 2000 areoid 垂直基准配套使用；见 metadata.json）
  public static readonly MARS_DATUM_RADIUS_M = JezeroTerrainSource.DATUM_RADIUS_M;

  private raster: RasterTerrainSource = RasterTerrainSource.getInstance();
  private jezero: JezeroTerrainSource = JezeroTerrainSource.getInstance();

  // S5-3：月面多站点栅格注册表（siteId → RasterTerrainSource；默认站 taurus-littrow
  // 即单例）。查询路由到激活站的栅格——窗外 fail-closed 语义不变。
  private moonRasters: Map<string, RasterTerrainSource> = new Map([['taurus-littrow', this.raster]]);
  private activeMoonSiteId = 'taurus-littrow';

  // S5-6：火星多站点栅格注册表（镜像月面；默认站 jezero 即单例）
  private marsRasters: Map<string, JezeroTerrainSource> = new Map([['jezero', this.jezero]]);
  private activeMarsSiteId = 'jezero';

  /** S5-3：登记月面站点的栅格源（引擎建栈时调用；可同时设为激活站） */
  public registerMoonRaster(siteId: string, raster: RasterTerrainSource, makeActive = false): void {
    this.moonRasters.set(siteId, raster);
    if (makeActive) this.activeMoonSiteId = siteId;
  }

  /** S5-3：切换激活月面站（高程查询/准入态/几何构建路由目标） */
  public setActiveMoonSite(siteId: string): void {
    if (this.moonRasters.has(siteId)) this.activeMoonSiteId = siteId;
  }

  private activeMoonRaster(): RasterTerrainSource {
    return this.moonRasters.get(this.activeMoonSiteId) ?? this.raster;
  }

  /** S5-6：登记火星站点的栅格源（引擎建栈时调用；可同时设为激活站） */
  public registerMarsRaster(siteId: string, dtm: JezeroTerrainSource, makeActive = false): void {
    this.marsRasters.set(siteId, dtm);
    if (makeActive) this.activeMarsSiteId = siteId;
  }

  /** S5-6：切换激活火星站（高程查询/准入态/collar 几何构建路由目标） */
  public setActiveMarsSite(siteId: string): void {
    if (this.marsRasters.has(siteId)) this.activeMarsSiteId = siteId;
  }

  public activeMarsRaster(): JezeroTerrainSource {
    return this.marsRasters.get(this.activeMarsSiteId) ?? this.jezero;
  }

  /** 天体的基准球半径（米）——高程→场景单位的换算分母 */
  private datumRadiusMFor(bodyId: BodyId): number {
    if (bodyId === 'moon') return TerrainHeightProvider.MOON_DATUM_RADIUS_M;
    if (bodyId === 'mars') return this.activeMarsRaster().datumRadius; // S5-6：按激活站产品局部球
    return 6371000.0;
  }

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
    if (bodyId === 'mars') return this.activeMarsRaster().sampleHeight(lat, lon).heightM; // S5-6：按激活站路由
    if (bodyId !== 'moon') return 0; // 其他天体暂无本地 DTM
    return this.activeMoonRaster().sampleHeight(lat, lon).heightM;
  }

  /** 带溯源的高程采样：measured-dem（真实 DTM）或 datum-sphere（基准球回退） */
  public getHeightSample(bodyId: BodyId, lat: number, lon: number): TerrainHeightSample {
    if (bodyId === 'mars') {
      const dtm = this.activeMarsRaster();
      const s = dtm.sampleHeight(lat, lon);
      if (s.valid) {
        return { valid: true, heightM: s.heightM, fidelity: 'measured-dem', sourceId: dtm.sourceId };
      }
      if (s.reason === 'not-loaded') {
        return { valid: false, heightM: 0, fidelity: null, sourceId: null, reason: 'not-loaded' };
      }
      return { valid: true, heightM: 0, fidelity: 'datum-sphere', sourceId: null };
    }
    if (bodyId !== 'moon') {
      return { valid: true, heightM: 0, fidelity: 'datum-sphere', sourceId: null };
    }
    const s = this.activeMoonRaster().sampleHeight(lat, lon);
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

  /** S4c：按天体路由的地形准入态（HUD 遥测如实标注；非落地天体报 unavailable） */
  public getAdmissionState(bodyId: BodyId): string {
    if (bodyId === 'moon') return this.activeMoonRaster().terrainAdmissionState;
    if (bodyId === 'mars') {
      const dtm = this.activeMarsRaster(); // S5-6：按激活站路由
      return dtm.metaReady ? dtm.admissionState : 'unavailable';
    }
    return 'unavailable';
  }

  /** 将高程（米）折算为场景单位渲染半径 */
  public getSceneSurfaceRadius(
    bodyId: BodyId,
    lat: number,
    lon: number,
    baseRadius: number
  ): number {
    const elevM = this.getHeightMeters(bodyId, lat, lon);
    const datumM = this.datumRadiusMFor(bodyId);
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
    const datumM = this.datumRadiusMFor(bodyId);
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
    const datumM = this.datumRadiusMFor(bodyId);
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
    const raster = this.activeMoonRaster();
    if (!raster.isReady) return null;
    const bounds = raster.windowBounds;
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
    geo.userData.surfaceGrid = { cols:segsLon+1, rows:segsLat+1,
      lat0:bounds.latMin, lon0:bounds.lonMin, dLat, dLon };
    return geo;
  }

  /**
   * P3-T2：月面挖孔球面。孔 = 包含 DTM 窗口+裙带的整格经纬带（边界落在网格线上），
   * 由 buildCollarGeometry 的外环沿同一批格线无缝填补。
   * 背景：DTM 高程为负（谷底在基准球之下），原 32×24 粗球面靠面片下垂的缝隙"碰巧"
   * 让谷地透出——可见性是偶然的；本方法把可见性变成设计。
   */
  public buildHoledMoonSphereGeometry(
    baseRadius: number,
    widthSegs = 128,
    heightSegs = 64,
    holeBoundsOverride?: { latMin: number; latMax: number; lonMin: number; lonMax: number }
  ): {
    geometry: THREE.BufferGeometry;
    holeBounds: { latMin: number; latMax: number; lonMin: number; lonMax: number };
  } | null {
    // S4b：holeBoundsOverride（火星等非月球天体）不依赖月球栅格就绪——
    // 孔边界显式给出时无需 raster（moon 默认路径仍要求栅格装载完成）
    const raster = this.activeMoonRaster();
    if (!holeBoundsOverride && !raster.isReady) return null;
    const wb = holeBoundsOverride ?? raster.windowBounds;
    if (!wb) return null;

    const PAD_DEG = 0.35; // 裙带外扩（窗口边缘→孔边界的缓冲）
    const dLon = 360 / widthSegs;
    const dLat = 180 / heightSegs;
    const j0 = Math.floor((wb.lonMin - PAD_DEG + 180) / dLon);
    const j1 = Math.ceil((wb.lonMax + PAD_DEG + 180) / dLon);
    // THREE.SphereGeometry rows run north -> south (latitude = 90 - iy*dLat).
    const i0 = Math.max(0, Math.floor((90 - wb.latMax - PAD_DEG) / dLat));
    const i1 = Math.min(heightSegs, Math.ceil((90 - wb.latMin + PAD_DEG) / dLat));
    const holeBounds = {
      lonMin: -180 + j0 * dLon,
      lonMax: -180 + j1 * dLon,
      latMin: 90 - i1 * dLat,
      latMax: 90 - i0 * dLat,
    };

    // SphereGeometry 顶点为行主序网格：vertex(ix, iy) = iy*(widthSegs+1)+ix
    const sphere = new THREE.SphereGeometry(baseRadius, widthSegs, heightSegs);
    const index = sphere.getIndex()!;
    const src = index.array as ArrayLike<number>;
    const kept: number[] = [];
    const stride = widthSegs + 1;
    for (let f = 0; f < src.length; f += 3) {
      let inHole = true;
      for (let k = 0; k < 3; k++) {
        const vi = src[f + k];
        const iy = Math.floor(vi / stride);
        const ix = vi - iy * stride;
        // Datasets may use 0..360 longitude (e.g. Victoria 354.5 E).
        // Unwrap the mesh column into the same interval, including the seam.
        const unwrappedIx = ix + widthSegs * Math.round(((j0 + j1) / 2 - ix) / widthSegs);
        if (iy < i0 || iy > i1 || unwrappedIx < j0 || unwrappedIx > j1) {
          inHole = false;
          break;
        }
      }
      if (!inHole) kept.push(src[f], src[f + 1], src[f + 2]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', sphere.getAttribute('position').clone());
    geo.setAttribute('normal', sphere.getAttribute('normal').clone());
    geo.setAttribute('uv', sphere.getAttribute('uv').clone());
    geo.setIndex(kept);
    sphere.dispose();
    return { geometry: geo, holeBounds };
  }

  /**
   * F-LUNAR-LIMB-01：挖孔补片——保留被 buildHoledMoonSphereGeometry 剔除的
   * 三角形（三顶点全部落在孔界格线内），与挖孔球共同构成原球面的不重不漏分区。
   * 用途：L1/裙边/DTM 被距离渐显门控隐藏的时段，以原球面（datum 0m，全球纹理
   * 同 UV）填补孔洞，消除斜视/球缘处的矩形缺口；孔底盖板继续作为深层兜底。
   * holeBounds 传 buildHoledMoonSphereGeometry 返回值（格线取整），格线索引
   * 由边界反解，保证两网格谓词严格互补。
   */
  public buildSphereHolePatchGeometry(
    baseRadius: number,
    widthSegs = 128,
    heightSegs = 64,
    holeBounds: { latMin: number; latMax: number; lonMin: number; lonMax: number }
  ): THREE.BufferGeometry | null {
    const dLon = 360 / widthSegs;
    const dLat = 180 / heightSegs;
    const j0 = Math.round((holeBounds.lonMin + 180) / dLon);
    const j1 = Math.round((holeBounds.lonMax + 180) / dLon);
    const i0 = Math.max(0, Math.round((90 - holeBounds.latMax) / dLat));
    const i1 = Math.min(heightSegs, Math.round((90 - holeBounds.latMin) / dLat));
    if (j1 <= j0 || i1 <= i0) return null;

    const sphere = new THREE.SphereGeometry(baseRadius, widthSegs, heightSegs);
    const index = sphere.getIndex()!;
    const src = index.array as ArrayLike<number>;
    const kept: number[] = [];
    const stride = widthSegs + 1;
    for (let f = 0; f < src.length; f += 3) {
      let inHole = true;
      for (let k = 0; k < 3; k++) {
        const vi = src[f + k];
        const iy = Math.floor(vi / stride);
        const ix = vi - iy * stride;
        // 与挖孔同款经度解缠（孔可跨 ±180° 接缝）
        const unwrappedIx = ix + widthSegs * Math.round(((j0 + j1) / 2 - ix) / widthSegs);
        if (iy < i0 || iy > i1 || unwrappedIx < j0 || unwrappedIx > j1) {
          inHole = false;
          break;
        }
      }
      if (inHole) kept.push(src[f], src[f + 1], src[f + 2]);
    }
    if (!kept.length) {
      sphere.dispose();
      return null;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', sphere.getAttribute('position').clone());
    geo.setAttribute('normal', sphere.getAttribute('normal').clone());
    geo.setAttribute('uv', sphere.getAttribute('uv').clone());
    geo.setIndex(kept);
    sphere.dispose();
    return geo;
  }

  /**
   * P3-T2：裙边环网格。内缘 = DTM 窗口边界（同采样核心，与窗口网格沿同曲线无缝相接），
   * 高度从窗口边缘真实高程向外 smoothstep 归零；外缘 = 挖孔边界格线（高程 0 = 球面，
   * 与挖孔球面共顶点）。着色用全球月面纹理（UV 与 SphereGeometry 等距圆柱约定一致：
   * u=(lon+180)/360, v=(lat+90)/180）。
   */
  public buildCollarGeometry(
    baseRadius: number,
    holeBounds: { latMin: number; latMax: number; lonMin: number; lonMax: number },
    rings = 10,
    edgeSegs = 96,
    bodyId: BodyId = 'moon'
  ): THREE.BufferGeometry | null {
    const raster = this.activeMoonRaster();
    const wb =
      bodyId === 'mars'
        ? this.activeMarsRaster().windowBounds // S5-6：按激活站（mars collar 走本站 DTM 窗）
        : raster.isReady
          ? raster.windowBounds
          : null;
    if (!wb) return null;

    // 环形参数化：周向 k ∈ [0,4*edgeSegs)（四边顺时针），径向 r ∈ [0,rings]（0=内缘窗口边）
    const perimeter = 4 * edgeSegs;
    const innerAt = (k: number): { lat: number; lon: number } => {
      const s = k % perimeter;
      const e = s / edgeSegs; // 0..4：S→E→N→W
      if (e < 1) return { lat: wb.latMin, lon: wb.lonMin + (e % 1) * (wb.lonMax - wb.lonMin) };
      if (e < 2) return { lat: wb.latMin + (e % 1) * (wb.latMax - wb.latMin), lon: wb.lonMax };
      if (e < 3) return { lat: wb.latMax, lon: wb.lonMax - (e % 1) * (wb.lonMax - wb.lonMin) };
      return { lat: wb.latMax - (e % 1) * (wb.latMax - wb.latMin), lon: wb.lonMin };
    };
    // 外环：从窗口中心过内点方向的射线与孔边界矩形的交点（内点本身在孔内，
    // 直接 clamp 会退化为内点本身——裙边零宽度）
    const cLat = (wb.latMin + wb.latMax) / 2;
    const cLon = (wb.lonMin + wb.lonMax) / 2;
    const outerAt = (k: number): { lat: number; lon: number } => {
      const p = innerAt(k);
      const dLat = p.lat - cLat;
      const dLon = p.lon - cLon;
      let tMax = Infinity;
      if (dLat > 1e-12) tMax = Math.min(tMax, (holeBounds.latMax - cLat) / dLat);
      else if (dLat < -1e-12) tMax = Math.min(tMax, (holeBounds.latMin - cLat) / dLat);
      if (dLon > 1e-12) tMax = Math.min(tMax, (holeBounds.lonMax - cLon) / dLon);
      else if (dLon < -1e-12) tMax = Math.min(tMax, (holeBounds.lonMin - cLon) / dLon);
      if (!Number.isFinite(tMax) || tMax < 1) tMax = 1;
      return { lat: cLat + dLat * tMax, lon: cLon + dLon * tMax };
    };

    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const heightAt = (lat: number, lon: number): number => {
      const cLat = THREE.MathUtils.clamp(lat, wb.latMin, wb.latMax);
      const cLon = THREE.MathUtils.clamp(lon, wb.lonMin, wb.lonMax);
      return this.getHeightMeters(bodyId, cLat, cLon);
    };

    for (let r = 0; r <= rings; r++) {
      const tR = r / rings;
      const w = tR * tR * (3 - 2 * tR); // smoothstep：内缘 0 → 外缘 1
      for (let k = 0; k < perimeter; k++) {
        const a = innerAt(k);
        const b = outerAt(k);
        const lat = a.lat + (b.lat - a.lat) * tR;
        const lon = a.lon + (b.lon - a.lon) * tR;
        const hM = heightAt(a.lat, a.lon) * (1 - w); // 内缘=DTM 边缘高程，外缘=0（球面）
        // 半径公式与窗口网格/球面一致：baseRadius + hM*(baseRadius/datumM)
        const rr = baseRadius + hM * (baseRadius / this.datumRadiusMFor(bodyId));
        const latRad = THREE.MathUtils.degToRad(lat);
        const lonRad = THREE.MathUtils.degToRad(lon);
        const cosLat = Math.cos(latRad);
        positions.push(rr * cosLat * Math.cos(lonRad), rr * Math.sin(latRad), -rr * cosLat * Math.sin(lonRad));
        uvs.push((lon + 180) / 360, (lat + 90) / 180);
      }
    }
    const rowStride = perimeter;
    for (let r = 0; r < rings; r++) {
      for (let k = 0; k < perimeter; k++) {
        const kNext = (k + 1) % perimeter;
        const a = r * rowStride + k;
        const d = r * rowStride + kNext;
        const b = (r + 1) * rowStride + k;
        const c = (r + 1) * rowStride + kNext;
        indices.push(a, b, d);
        indices.push(b, c, d);
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
