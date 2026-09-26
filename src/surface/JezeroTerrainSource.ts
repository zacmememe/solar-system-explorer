/**
 * 火星 HiRISE 地形/影像源（P3-S4b 耶泽罗首站；S5-6 参数化多站）
 *
 * 数据：public/data/dem/{jezero|victoria|gale}-hirise-v1/（离线打包自
 * MRO-M-HIRISE-5-DTM-V1.0 受控立体 DTM+正射；见 metadata.json 全溯源）。
 * 网格：站点居中局部米制（4×5.5km @2m，正射 1m）。
 * 高程：Mars 2000 areoid（米）；datum 球半径 = 产品等距圆柱局部球
 * （jezero 3394839.8m/CLAT15；S5-6 两站 3396190m/CLAT0）——装载时从
 * metadata.projection.referenceRadiusM 读取，勿跨站混用。
 */
import * as THREE from 'three';
import { computeTerrainNormals } from './TerrainBoundary';

interface JezeroMeta {
  schemaVersion: number;
  admissionState: string;
  sourceUrl: string;
  orthoSourceUrl: string;
  sourceVersion: string;
  licenseNote: string;
  verticalDatum: string;
  projection?: { referenceRadiusM?: number };
  width: number;
  height: number;
  windowSizeM: [number, number];
  stepMeters: number;
  site: { centerLat: number; centerLon: number; elevationM: number; distToPerseveranceM: number };
  minimumHeightM: number;
  maximumHeightM: number;
  heightSha256: string;
  validSha256: string;
  orthoSha256: string;
  orthoEncoding: { stepMeters: number };
  anchors: Array<{ name: string; lat: number; lon: number; hM: number }>;
}

export class JezeroTerrainSource {
  public static readonly BASE_URL = '/data/dem/jezero-hirise-v1';
  public static readonly DATUM_RADIUS_M = 3394839.8133163;
  private static _instance: JezeroTerrainSource | null = null;

  /** S5-6：多站实例（默认站 jezero 用单例；其他站 new 出独立实例） */
  constructor(public readonly siteId: string = 'jezero', public readonly sourceId: string = 'jezero-hirise-v1') {}

  public static getInstance(): JezeroTerrainSource {
    if (!this._instance) this._instance = new JezeroTerrainSource();
    return this._instance;
  }

  /** 本站 datum 球半径（米）——装载前为 jezero 默认，装载后取 metadata 投影值 */
  private datumRadiusM: number = JezeroTerrainSource.DATUM_RADIUS_M;
  public get datumRadius(): number {
    return this.datumRadiusM;
  }

  private loadPromise: Promise<void> | null = null;
  private meta: JezeroMeta | null = null;
  private heights: Float32Array | null = null;
  private valid: Uint8Array | null = null;
  private orthoUrl: string | null = null;
  private loadError: string | null = null;
  // S5-1：验收准入记录（admission.json 由验收脚本写入；缺失则维持 metadata 状态）
  private admissionStateValue: string | null = null;

  public get isReady(): boolean {
    return !!(this.meta && this.heights && this.valid);
  }

  public get error(): string | null {
    return this.loadError;
  }

  public get metaReady(): JezeroMeta | null {
    return this.meta;
  }

  /** 准入状态：admission.json（admitted-*）覆盖 metadata 基线，未装载为 not-loaded */
  public get admissionState(): string {
    if (this.admissionStateValue) return this.admissionStateValue;
    return this.meta?.admissionState ?? 'not-loaded';
  }

  public get windowBounds(): { latMin: number; latMax: number; lonMin: number; lonMax: number } | null {
    if (!this.meta) return null;
    const { centerLat, centerLon } = this.meta.site;
    const mPerDeg = this.datumRadiusM * Math.PI / 180;
    const cosLat = Math.cos((centerLat * Math.PI) / 180);
    return {
      latMin: centerLat - (this.meta.windowSizeM[1] / 2) / mPerDeg,
      latMax: centerLat + (this.meta.windowSizeM[1] / 2) / mPerDeg,
      lonMin: centerLon - (this.meta.windowSizeM[0] / 2) / (mPerDeg * cosLat),
      lonMax: centerLon + (this.meta.windowSizeM[0] / 2) / (mPerDeg * cosLat),
    };
  }

  public async load(baseUrl: string = JezeroTerrainSource.BASE_URL): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.doLoad(baseUrl).catch((err: unknown) => {
      this.loadError = err instanceof Error ? err.message : String(err);
      throw err;
    });
    return this.loadPromise;
  }

  private async doLoad(baseUrl: string): Promise<void> {
    const meta: JezeroMeta = await (await fetch(`${baseUrl}/metadata.json`)).json();
    const hBuf = await (await fetch(`${baseUrl}/height.f32`)).arrayBuffer();
    const vBuf = await (await fetch(`${baseUrl}/valid.u8`)).arrayBuffer();
    if (hBuf.byteLength !== meta.width * meta.height * 4) throw new Error('height.f32 尺寸不符');
    if (vBuf.byteLength !== meta.width * meta.height) throw new Error('valid.u8 尺寸不符');
    this.meta = meta;
    // S5-6：datum 球半径按站取（CLAT0 产品 3396190 ≠ jezero CLAT15 局部球）；
    // 缺失时维持 jezero 默认（旧包兼容）
    this.datumRadiusM = meta.projection?.referenceRadiusM ?? this.datumRadiusM;
    this.heights = new Float32Array(hBuf);
    this.valid = new Uint8Array(vBuf);
    this.orthoUrl = `${baseUrl}/ortho.jpg`;
    this.admissionStateValue = meta.admissionState;

    // 验收通过的准入记录（同 RasterTerrainSource：admission.json 由验收脚本
    // 写入——S5-1 MOLA 独立交叉校验通过后升级；缺失则维持 requires-review）
    try {
      const admRes = await fetch(`${baseUrl}/admission.json`);
      if (admRes.ok) {
        const adm = (await admRes.json()) as { state?: string };
        if (adm.state && adm.state.startsWith('admitted')) {
          this.admissionStateValue = adm.state;
        }
      }
    } catch {
      /* 保持 metadata 的准入状态 */
    }
  }

  /** 窗口网格双线性（行 0 = 北缘；列 0 = 西缘；像素中心=边界内缩半步）。窗外 invalid */
  public sampleHeight(latDeg: number, lonDeg: number): { valid: boolean; heightM: number; reason?: string } {
    if (!this.meta || !this.heights || !this.valid) return { valid: false, heightM: 0, reason: 'not-loaded' };
    const { centerLat, centerLon } = this.meta.site;
    const mPerDeg = this.datumRadiusM * Math.PI / 180;
    const cosLat = Math.cos((centerLat * Math.PI) / 180);
    const step = this.meta.stepMeters;
    const fx = ((lonDeg - centerLon) * mPerDeg * cosLat + this.meta.windowSizeM[0] / 2) / step;
    const fy = ((centerLat - latDeg) * mPerDeg + this.meta.windowSizeM[1] / 2) / step;
    const c0 = Math.floor(fx), r0 = Math.floor(fy);
    if (c0 < 0 || r0 < 0 || c0 >= this.meta.width - 1 || r0 >= this.meta.height - 1) {
      return { valid: false, heightM: 0, reason: 'outside' };
    }
    const tx = fx - c0, ty = fy - r0;
    const W = this.meta.width;
    const ok = (r: number, c: number) => this.valid![r * W + c] === 1;
    if (!ok(r0, c0) || !ok(r0, c0 + 1) || !ok(r0 + 1, c0) || !ok(r0 + 1, c0 + 1)) {
      return { valid: false, heightM: 0, reason: 'invalid-quad' };
    }
    const h = this.heights!;
    const v = h[r0 * W + c0] * (1 - tx) * (1 - ty) + h[r0 * W + c0 + 1] * tx * (1 - ty) +
      h[(r0 + 1) * W + c0] * (1 - tx) * ty + h[(r0 + 1) * W + c0 + 1] * tx * ty;
    return { valid: true, heightM: v };
  }

  /** Physical span of UV [0,1], including pixel-center convention. */
  public get uvSpanMeters(): THREE.Vector2 {
    return new THREE.Vector2((this.meta!.width-1)*this.meta!.stepMeters,(this.meta!.height-1)*this.meta!.stepMeters);
  }

  /** 地表网格（与月球 buildDemWindowGeometry 同构；datum=Mars2000 局部球） */
  public buildDemWindowGeometry(baseRadius: number, maxSegments = 512): THREE.BufferGeometry | null {
    if (!this.meta || !this.heights) return null;
    const { centerLat, centerLon } = this.meta.site;
    const mPerDeg = this.datumRadiusM * Math.PI / 180;
    const cosLat = Math.cos((centerLat * Math.PI) / 180);
    const W = this.meta.width, H = this.meta.height;
    const stepI = Math.max(1, Math.ceil(W / maxSegments));
    const stepJ = Math.max(1, Math.ceil(H / maxSegments));
    const cols = Math.floor((W - 1) / stepI) + 1;
    const rows = Math.floor((H - 1) / stepJ) + 1;
    const scale = baseRadius / this.datumRadiusM;
    const positions = new Float64Array(cols * rows * 3);
    const uvs = new Float32Array(cols * rows * 2);
    let p = 0, u = 0;
    for (let j = 0; j < rows; j++) {
      const rIdx = j * stepJ;
      const northM = this.meta.windowSizeM[1] / 2 - rIdx * this.meta.stepMeters;
      const lat = centerLat + northM / mPerDeg;
      const latRad = THREE.MathUtils.degToRad(lat);
      for (let i = 0; i < cols; i++) {
        const cIdx = i * stepI;
        const eastM = cIdx * this.meta.stepMeters - this.meta.windowSizeM[0] / 2;
        const lon = centerLon + eastM / (mPerDeg * cosLat);
        const hM = this.heights[rIdx * W + cIdx];
        const rr = baseRadius + hM * scale;
        const lonRad = THREE.MathUtils.degToRad(lon);
        const cl = Math.cos(latRad);
        positions[p++] = rr * cl * Math.cos(lonRad);
        positions[p++] = rr * Math.sin(latRad);
        positions[p++] = -rr * cl * Math.sin(lonRad);
        uvs[u++] = cIdx / (W - 1);
        uvs[u++] = rIdx / (H - 1);
      }
    }
    const indices: number[] = [];
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
        indices.push(a, c, b);
        indices.push(b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(positions), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    computeTerrainNormals(geo, positions);
    geo.userData.surfaceGrid = {cols,rows,
      lat0:centerLat+this.meta.windowSizeM[1]/2/mPerDeg,
      lon0:centerLon-this.meta.windowSizeM[0]/2/(mPerDeg*cosLat),
      dLat:-stepJ*this.meta.stepMeters/mPerDeg, dLon:stepI*this.meta.stepMeters/(mPerDeg*cosLat)};
    return geo;
  }

  /** 正射纹理（JPEG 灰度；UV 与网格一致：行 0=北，flipY 关闭——同月面约定） */
  public buildOrthoTexture(): THREE.Texture | null {
    if (!this.orthoUrl) return null;
    const tex = new THREE.TextureLoader().load(this.orthoUrl);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8; // 掠射视角抗糊（同月面 ortho）
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.flipY = false; // 窗口行 0 = 北；UV v 按行号方向（默认 true 会南北镜像）
    return tex;
  }
}
