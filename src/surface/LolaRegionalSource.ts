/**
 * LOLA 区域 DEM 源（P3-T5，三层 LOD 阶梯第 2 步）
 *
 * L1 中间层：在 2K 全球图（L0）与 12km NAC DTM（L2, 5m）之间，用 LOLA GDR
 * LDEM_128（236.901 m/px，全球激光高度计，空隙由 GMT surface 张力填充）提供
 * 真实区域地形。12km 高精块外的"光滑球面"被真实地形替换——方块边缘从
 * "贴图 vs 空球"变为两级真实地形的 LOD 接缝（用户反馈 2026-09-24）。
 *
 * 数据：public/data/dem/lola-l1-taurus-v1/{height.i16, metadata.json}
 * 打包：D:\solar-evidence\pro-review\pack-lola-l1.mjs（离线裁窗 + NAC DTM 三点
 * 独立交叉验证，站点差 0.9 m）。height = int16 DN × 0.5 m（相对 1737.4 km 球）。
 * 坐标：简单圆柱（纬度线性），像素注册，128 ppd，东经正向。
 */
import * as THREE from 'three';

export interface LolaMeta {
  schemaVersion: number;
  admissionState: string;
  fidelityClaim: string;
  sourceUrl: string;
  sourceLabelUrl: string;
  sourceFile: string;
  sourceFileSha256: string;
  sourceVersion: string;
  licenseNote: string;
  verticalDatum: string;
  nativeSpacingMeters: number;
  width: number;
  height: number;
  projection: {
    type: string;
    coordinateSystem: string;
    positiveLongitude: string;
    referenceRadiusM: number;
    centerLatitudeDeg: number;
    centerLongitudeDeg: number;
    pixelsPerDegree: number;
  };
  window: { colStart: number; rowStart: number; width: number; height: number };
  minimumHeightM: number;
  maximumHeightM: number;
  heightSha256: string;
  encoding: { dtype: string; scaleMetersPerDn: number };
  crosscheckNacDtm: Array<{ name: string; lat: number; lon: number; lolaM: number; nacM: number; diffM: number }>;
}

export class LolaRegionalSource {
  public static readonly DEFAULT_BASE_URL = '/data/dem/lola-l1-taurus-v1';
  private static _instance: LolaRegionalSource | null = null;
  public static getInstance(): LolaRegionalSource {
    if (!this._instance) this._instance = new LolaRegionalSource();
    return this._instance;
  }

  private loadPromise: Promise<void> | null = null;
  private meta: LolaMeta | null = null;
  private dNs: Int16Array | null = null;
  private boundsCache: { latMin: number; latMax: number; lonMin: number; lonMax: number } | null = null;
  private loadError: string | null = null;

  public get isReady(): boolean {
    return !!(this.meta && this.dNs);
  }

  public get error(): string | null {
    return this.loadError;
  }

  public get metaReady(): LolaMeta | null {
    return this.meta;
  }

  /** 裁窗地理边界（由 LBL 像素注册公式反解） */
  public get windowBounds(): { latMin: number; latMax: number; lonMin: number; lonMax: number } | null {
    return this.boundsCache;
  }

  public async load(baseUrl: string = LolaRegionalSource.DEFAULT_BASE_URL): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.doLoad(baseUrl).catch((err: unknown) => {
      this.loadError = err instanceof Error ? err.message : String(err);
      throw err;
    });
    return this.loadPromise;
  }

  private async doLoad(baseUrl: string): Promise<void> {
    const meta: LolaMeta = await (await fetch(`${baseUrl}/metadata.json`)).json();
    if (meta.encoding?.dtype !== 'int16-le') throw new Error(`LOLA L1 编码不支持: ${meta.encoding?.dtype}`);
    const buf = await (await fetch(`${baseUrl}/height.i16`)).arrayBuffer();
    const expect = meta.width * meta.height * 2;
    if (buf.byteLength !== expect) {
      throw new Error(`LOLA L1 高度场字节数不符: ${buf.byteLength} ≠ ${expect}`);
    }
    this.dNs = new Int16Array(buf);
    this.meta = meta;
    // LBL 像素注册：col = 23039.5+(lon-180)*128, row = 11519.5-lat*128（窗口首末样本中心）
    const ppd = meta.projection.pixelsPerDegree;
    this.boundsCache = {
      lonMin: (meta.window.colStart + 0.5 - 23039.5) / ppd + 180,
      lonMax: (meta.window.colStart + meta.window.width - 0.5 - 23039.5) / ppd + 180,
      latMax: 90 - (meta.window.rowStart + 0.5) / ppd,
      latMin: 90 - (meta.window.rowStart + meta.window.height - 0.5) / ppd,
    };
  }

  /** 双线性高程（米，相对 1737.4km 球）。窗外返回 null（fail-closed，不隐式 0） */
  public sampleHeight(latDeg: number, lonDeg: number): { heightM: number } | null {
    if (!this.meta || !this.dNs) return null;
    const ppd = this.meta.projection.pixelsPerDegree;
    const fc = 23039.5 + (lonDeg - 180) * ppd - this.meta.window.colStart;
    const fr = 11519.5 - latDeg * ppd - this.meta.window.rowStart;
    const c0 = Math.floor(fc), r0 = Math.floor(fr);
    if (c0 < 0 || r0 < 0 || c0 >= this.meta.width - 1 || r0 >= this.meta.height - 1) return null;
    const tc = fc - c0, tr = fr - r0;
    const W = this.meta.width;
    const v = (r: number, c: number) => this.dNs![r * W + c];
    const dn =
      v(r0, c0) * (1 - tc) * (1 - tr) + v(r0, c0 + 1) * tc * (1 - tr) +
      v(r0 + 1, c0) * (1 - tc) * tr + v(r0 + 1, c0 + 1) * tc * tr;
    return { heightM: dn * this.meta.encoding.scaleMetersPerDn };
  }

  /**
   * L1 区域网格：覆盖整个裁窗（无孔——L1 是该区域唯一有效不透明表面，
   * Pro 260924 方向），高程=LOLA，UV=全球等距圆柱（2K 全球图直接可用，
   * WAC collar 纹理以同一 UV 裁剪交换换装）。
   * decimate：网格抽取（1=原生 2152×1025；2=1076×513 …）。原生 220 万顶点
   * 过重，默认 2（~55 万顶点，中景 237m/px 已足）。
   */
  public buildRegionalGeometry(baseRadius: number, decimate = 2): THREE.BufferGeometry | null {
    if (!this.meta || !this.dNs) return null;
    const m = this.meta;
    const step = Math.max(1, Math.floor(decimate));
    const cols = Math.floor((m.width - 1) / step) + 1;
    const rows = Math.floor((m.height - 1) / step) + 1;
    const ppd = m.projection.pixelsPerDegree;
    const positions = new Float32Array(cols * rows * 3);
    const uvs = new Float32Array(cols * rows * 2);
    const scale = baseRadius / m.projection.referenceRadiusM;
    let p = 0, u = 0;
    for (let j = 0; j < rows; j++) {
      const rIdx = j * step;
      const lat = 90 - (m.window.rowStart + rIdx + 0.5) / ppd;
      const latRad = THREE.MathUtils.degToRad(lat);
      for (let i = 0; i < cols; i++) {
        const cIdx = i * step;
        const lon = (m.window.colStart + cIdx + 0.5 - 23039.5) / ppd + 180;
        const hM = this.dNs[rIdx * m.width + cIdx] * m.encoding.scaleMetersPerDn;
        const rr = baseRadius + hM * scale;
        const lonRad = THREE.MathUtils.degToRad(lon);
        const cosLat = Math.cos(latRad);
        positions[p++] = rr * cosLat * Math.cos(lonRad);
        positions[p++] = rr * Math.sin(latRad);
        positions[p++] = -rr * cosLat * Math.sin(lonRad);
        uvs[u++] = (lon - 180 + 360) / 360;
        uvs[u++] = (lat + 90) / 180;
      }
    }
    const indices: number[] = [];
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = j * cols + i;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        indices.push(a, c, b);
        indices.push(b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * 边界裙边：裁窗边（LOLA 边缘高程）→ 球面孔边界（高程 0），smoothstep 过渡。
   * 与 P3-T2 裙边同构（内缘真实高程、外缘落回球面格线，共顶点由孔边界对齐保证）。
   */
  public buildBoundarySkirt(
    baseRadius: number,
    holeBounds: { latMin: number; latMax: number; lonMin: number; lonMax: number },
    rings = 12,
    edgeSegs = 128
  ): THREE.BufferGeometry | null {
    const wb = this.windowBounds;
    if (!wb || !this.meta) return null;
    const perimeter = 4 * edgeSegs;
    const innerAt = (k: number): { lat: number; lon: number } => {
      const s = k % perimeter;
      const e = s / edgeSegs;
      if (e < 1) return { lat: wb.latMin, lon: wb.lonMin + (e % 1) * (wb.lonMax - wb.lonMin) };
      if (e < 2) return { lat: wb.latMin + (e % 1) * (wb.latMax - wb.latMin), lon: wb.lonMax };
      if (e < 3) return { lat: wb.latMax, lon: wb.lonMax - (e % 1) * (wb.lonMax - wb.lonMin) };
      return { lat: wb.latMax - (e % 1) * (wb.latMax - wb.latMin), lon: wb.lonMin };
    };
    const cLat = (wb.latMin + wb.latMax) / 2;
    const cLon = (wb.lonMin + wb.lonMax) / 2;
    const outerAt = (k: number): { lat: number; lon: number } => {
      const pnt = innerAt(k);
      const dLat = pnt.lat - cLat;
      const dLon = pnt.lon - cLon;
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
    const scale = baseRadius / this.meta.projection.referenceRadiusM;
    const edgeH = (lat: number, lon: number): number => {
      const cl = Math.max(wb.latMin, Math.min(wb.latMax, lat));
      const co = Math.max(wb.lonMin, Math.min(wb.lonMax, lon));
      return this.sampleHeight(cl, co)?.heightM ?? 0;
    };
    for (let r = 0; r <= rings; r++) {
      const tR = r / rings;
      const w = tR * tR * (3 - 2 * tR);
      for (let k = 0; k < perimeter; k++) {
        const a = innerAt(k);
        const b = outerAt(k);
        const lat = a.lat + (b.lat - a.lat) * tR;
        const lon = a.lon + (b.lon - a.lon) * tR;
        const hM = edgeH(a.lat, a.lon) * (1 - w);
        const rr = baseRadius + hM * scale;
        const latRad = THREE.MathUtils.degToRad(lat);
        const lonRad = THREE.MathUtils.degToRad(lon);
        const cosLat = Math.cos(latRad);
        positions.push(rr * cosLat * Math.cos(lonRad), rr * Math.sin(latRad), -rr * cosLat * Math.sin(lonRad));
        uvs.push((lon + 180) / 360, (lat + 90) / 180);
      }
    }
    for (let r = 0; r < rings; r++) {
      for (let k = 0; k < perimeter; k++) {
        const kNext = (k + 1) % perimeter;
        const a = r * perimeter + k;
        const d = r * perimeter + kNext;
        const b = (r + 1) * perimeter + k;
        const c = (r + 1) * perimeter + kNext;
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
