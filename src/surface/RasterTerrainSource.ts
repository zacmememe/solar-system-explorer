/**
 * 栅格地形数据源 RasterTerrainSource（P2）
 * 装载 pack-dem 语义打包的真实月面 DEM 窗口（float32 高程 + 有效掩码 + 正射 I/F），
 * 提供带溯源的高程采样与正射纹理。
 *
 * 诚实性约定：
 * - 采样 fail-closed：任一双线性贡献像元无效（NoData/掩码 0/越界）即返回 invalid，
 *   绝不把窗外隐式当作 0 米平原（0 米回退由 TerrainHeightProvider 显式标注 datum-sphere）；
 * - 溯源字段（来源/版本/垂直基准/精度）随样本返回，HUD/书签可如实展示；
 * - 装载时校验 SHA-256，哈希不符拒绝启用（缓存投毒防护）；
 * - admissionState 初始 requires-source-and-registration-review；实机三点数值+
 *   目视配准验收通过后由验收脚本写入 admission.json，运行时读取并在 HUD 如实标注。
 */

import * as THREE from 'three';
import { orthoP995 } from './orthoNormalizer';

export type TerrainFidelity = 'measured-dem' | 'datum-sphere';

export interface TerrainHeightSample {
  valid: boolean;
  heightM: number;
  fidelity: TerrainFidelity | null;
  sourceId: string | null;
  reason?: 'not-loaded' | 'outside' | 'nodata';
}

export interface RasterProvenance {
  sourceId: string;
  sourceVersion: string;
  sourceUrl: string;
  admissionState: string;
  verticalDatum: string;
  nativeSpacingMeters: number;
  fidelityClaim: string;
}

interface DemMeta {
  schemaVersion: number;
  admissionState: string;
  fidelityClaim: string;
  sourceUrl: string;
  sourceFile?: string; // S5-3：溯源标签派生（多站点 NAC_DTM_*）
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
  };
  pixelCornerAffine: { x0: number; y0: number; dx: number; dy: number };
  window: { colStart: number; rowStart: number; width: number; height: number };
  sourceNoDataValue: number;
  minimumHeightM: number;
  maximumHeightM: number;
  heightSha256: string;
  validSha256: string;
  orthoSha256: string;
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export class RasterTerrainSource {
  public static readonly DEFAULT_BASE_URL = '/data/dem/apollo17-v1';

  private static instance: RasterTerrainSource | null = null;

  public static getInstance(): RasterTerrainSource {
    if (!RasterTerrainSource.instance) {
      RasterTerrainSource.instance = new RasterTerrainSource();
    }
    return RasterTerrainSource.instance;
  }

  private meta: DemMeta | null = null;
  private heights: Float32Array | null = null;
  private validMask: Uint8Array | null = null;
  private orthoU16: Uint16Array | null = null;
  private admissionState = 'not-loaded';
  private loadPromise: Promise<void> | null = null;
  private loadError: string | null = null;
  // S5-3：溯源标签按实例数据源派生（多站点：NAC_DTM_APOLLO17 / NAC_DTM_APOLLO15…）
  private sourceTag = 'NAC_DTM_APOLLO17';
  private orthoTexture: THREE.DataTexture | null = null;

  /** 窗口地理边界（像元中心口径） */
  private boundsCache: { latMin: number; latMax: number; lonMin: number; lonMax: number } | null = null;

  public get state(): 'idle' | 'loading' | 'ready' | 'failed' {
    if (this.loadError) return 'failed';
    if (this.heights && this.validMask && this.meta) return 'ready';
    if (this.loadPromise) return 'loading';
    return 'idle';
  }

  public get error(): string | null {
    return this.loadError;
  }

  public get isReady(): boolean {
    return this.state === 'ready';
  }

  /** 站点准入状态：requires-source-and-registration-review 或验收后的 admitted-* */
  public get terrainAdmissionState(): string {
    return this.isReady ? this.admissionState : 'not-loaded';
  }

  public get provenance(): RasterProvenance | null {
    if (!this.meta) return null;
    return {
      sourceId: this.sourceTag,
      sourceVersion: this.meta.sourceVersion,
      sourceUrl: this.meta.sourceUrl,
      admissionState: this.terrainAdmissionState,
      verticalDatum: this.meta.verticalDatum,
      nativeSpacingMeters: this.meta.nativeSpacingMeters,
      fidelityClaim: this.meta.fidelityClaim,
    };
  }

  public get windowBounds(): { latMin: number; latMax: number; lonMin: number; lonMax: number } | null {
    if (!this.meta || !this.boundsCache) return null;
    return this.boundsCache;
  }

  /** P3b-E：DTM 窗口边长（米，取宽高较大者）——地形块距离渐显的物理尺寸来源 */
  public get demWindowMeters(): number | null {
    if (!this.meta) return null;
    return Math.max(this.meta.window.width, this.meta.window.height) * this.meta.nativeSpacingMeters;
  }

  public async load(baseUrl: string = RasterTerrainSource.DEFAULT_BASE_URL): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.doLoad(baseUrl).catch((err: unknown) => {
      this.loadError = String(err instanceof Error ? err.message : err);
      throw err;
    });
    return this.loadPromise;
  }

  /**
   * 测试/准入工具专用注入：绕过 HTTP 直接装配（Node 环境无相对 URL fetch）。
   * 哈希与尺寸校验与网络装载一致；仅用于单测与验收脚本，产品运行不走此路径。
   */
  public async injectBuffers(metaJson: unknown, heightBuf: ArrayBuffer, validBuf: ArrayBuffer, orthoBuf: ArrayBuffer): Promise<void> {
    const meta = metaJson as DemMeta;
    const n = meta.width * meta.height;
    if (heightBuf.byteLength !== n * 4 || validBuf.byteLength !== n || orthoBuf.byteLength !== n * 2) {
      throw new Error('注入失败：数据尺寸与 metadata 不符');
    }
    const [hHash, vHash, oHash] = await Promise.all([sha256Hex(heightBuf), sha256Hex(validBuf), sha256Hex(orthoBuf)]);
    if (hHash !== meta.heightSha256 || vHash !== meta.validSha256 || oHash !== meta.orthoSha256) {
      throw new Error('注入失败：SHA-256 校验不符');
    }
    this.meta = meta;
    this.heights = new Float32Array(heightBuf);
    this.validMask = new Uint8Array(validBuf);
    this.orthoU16 = new Uint16Array(orthoBuf);
    this.admissionState = meta.admissionState;
    this.sourceTag = meta.sourceFile?.replace(/\.[A-Za-z0-9]+$/, '') ?? this.sourceTag;
    const tl = this.windowPixelToLatLon(0, 0);
    const br = this.windowPixelToLatLon(meta.width - 1, meta.height - 1);
    this.boundsCache = {
      latMin: Math.min(tl.latDeg, br.latDeg),
      latMax: Math.max(tl.latDeg, br.latDeg),
      lonMin: Math.min(tl.lonDeg, br.lonDeg),
      lonMax: Math.max(tl.lonDeg, br.lonDeg),
    };
    this.loadPromise = Promise.resolve();
  }

  private async doLoad(baseUrl: string): Promise<void> {
    const [metaRes, heightRes, validRes, orthoRes] = await Promise.all([
      fetch(`${baseUrl}/metadata.json`),
      fetch(`${baseUrl}/height.f32`),
      fetch(`${baseUrl}/valid.u8`),
      fetch(`${baseUrl}/ortho.u16`),
    ]);
    for (const [name, res] of (
      [
        ['metadata.json', metaRes],
        ['height.f32', heightRes],
        ['valid.u8', validRes],
        ['ortho.u16', orthoRes],
      ] as const
    )) {
      if (!res.ok) throw new Error(`DEM 装载失败：${name} HTTP ${res.status}`);
    }

    const meta = (await metaRes.json()) as DemMeta;
    const [heightBuf, validBuf, orthoBuf] = (
      await Promise.all([heightRes.arrayBuffer(), validRes.arrayBuffer(), orthoRes.arrayBuffer()])
    );

    // 完整性：哈希 + 尺寸（不符即拒绝启用，防止缓存投毒/半包）
    const n = meta.width * meta.height;
    if (heightBuf.byteLength !== n * 4 || validBuf.byteLength !== n || orthoBuf.byteLength !== n * 2) {
      throw new Error('DEM 装载失败：数据尺寸与 metadata 不符');
    }
    const [hHash, vHash, oHash] = await Promise.all([
      sha256Hex(heightBuf),
      sha256Hex(validBuf),
      sha256Hex(orthoBuf),
    ]);
    if (hHash !== meta.heightSha256 || vHash !== meta.validSha256 || oHash !== meta.orthoSha256) {
      throw new Error('DEM 装载失败：SHA-256 校验不符');
    }

    this.meta = meta;
    this.heights = new Float32Array(heightBuf);
    this.validMask = new Uint8Array(validBuf);
    this.orthoU16 = new Uint16Array(orthoBuf);
    this.admissionState = meta.admissionState;
    this.sourceTag = meta.sourceFile?.replace(/\.[A-Za-z0-9]+$/, '') ?? this.sourceTag;

    // 窗口地理边界（首/末像元中心）
    const tl = this.windowPixelToLatLon(0, 0);
    const br = this.windowPixelToLatLon(meta.width - 1, meta.height - 1);
    this.boundsCache = {
      latMin: Math.min(tl.latDeg, br.latDeg),
      latMax: Math.max(tl.latDeg, br.latDeg),
      lonMin: Math.min(tl.lonDeg, br.lonDeg),
      lonMax: Math.max(tl.lonDeg, br.lonDeg),
    };

    // 验收通过的准入记录（admission.json 由验收脚本写入；缺失则维持 requires-review）
    try {
      const admRes = await fetch(`${baseUrl}/admission.json`);
      if (admRes.ok) {
        const adm = (await admRes.json()) as { state?: string };
        if (adm.state && adm.state.startsWith('admitted')) {
          this.admissionState = adm.state;
        }
      }
    } catch {
      /* 保持 metadata 的准入状态 */
    }
  }

  /** 地理（度，行星中心坐标，东经正）→ 源图连续像元坐标（全幅口径，0 = 首像元中心） */
  public latLonToSourcePixel(latDeg: number, lonDeg: number): { col: number; row: number } {
    const m = this.meta!;
    const rad = Math.PI / 180;
    const xM =
      m.projection.referenceRadiusM *
      Math.cos((m.projection.centerLatitudeDeg * Math.PI) / 180) *
      (lonDeg - m.projection.centerLongitudeDeg) *
      rad;
    const yM = m.projection.referenceRadiusM * latDeg * rad;
    const a = m.pixelCornerAffine;
    return { col: (xM - a.x0) / a.dx - 0.5, row: (yM - a.y0) / a.dy - 0.5 };
  }

  /** 窗口像元（0..w-1, 0..h-1，像元中心口径）→ 地理度 */
  public windowPixelToLatLon(col: number, row: number): { latDeg: number; lonDeg: number } {
    const m = this.meta!;
    const a = m.pixelCornerAffine;
    const rad = Math.PI / 180;
    const xM = a.x0 + (m.window.colStart + col + 0.5) * a.dx;
    const yM = a.y0 + (m.window.rowStart + row + 0.5) * a.dy;
    return {
      lonDeg:
        m.projection.centerLongitudeDeg +
        xM / (m.projection.referenceRadiusM * Math.cos((m.projection.centerLatitudeDeg * Math.PI) / 180)) / rad,
      latDeg: yM / m.projection.referenceRadiusM / rad,
    };
  }

  /**
   * 双线性高程采样（fail-closed：任一贡献像元无效即 invalid）。
   * 双线性插值不是亚像元观测分辨率——观测分辨率 = nativeSpacingMeters。
   */
  public sampleHeight(latDeg: number, lonDeg: number): TerrainHeightSample {
    if (!this.isReady || !this.meta || !this.heights || !this.validMask) {
      return { valid: false, heightM: 0, fidelity: null, sourceId: null, reason: 'not-loaded' };
    }
    if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) {
      return { valid: false, heightM: 0, fidelity: null, sourceId: this.sourceTag, reason: 'outside' };
    }
    const m = this.meta;
    const src = this.latLonToSourcePixel(latDeg, lonDeg);
    const wc = src.col - m.window.colStart;
    const wr = src.row - m.window.rowStart;
    if (wc < 0 || wr < 0 || wc > m.width - 1 || wr > m.height - 1) {
      return { valid: false, heightM: 0, fidelity: null, sourceId: this.sourceTag, reason: 'outside' };
    }
    const x0 = Math.min(m.width - 2, Math.floor(wc));
    const y0 = Math.min(m.height - 2, Math.floor(wr));
    const fx = wc - x0;
    const fy = wr - y0;
    const wts: Array<[number, number, number]> = [
      [x0, y0, (1 - fx) * (1 - fy)],
      [x0 + 1, y0, fx * (1 - fy)],
      [x0, y0 + 1, (1 - fx) * fy],
      [x0 + 1, y0 + 1, fx * fy],
    ];
    let h = 0;
    for (const [xx, yy, w] of wts) {
      if (w === 0) continue;
      const idx = yy * m.width + xx;
      const v = this.heights[idx];
      if (!Number.isFinite(v) || this.validMask[idx] === 0) {
        return { valid: false, heightM: 0, fidelity: null, sourceId: this.sourceTag, reason: 'nodata' };
      }
      h += w * v;
    }
    return { valid: true, heightM: h, fidelity: 'measured-dem', sourceId: this.sourceTag };
  }

  /** 正射 I/F 纹理（8-bit 归一化灰度，RGBA 灰阶复制；归一化分母记录于纹理 userData） */
  public buildOrthoTexture(): THREE.DataTexture | null {
    if (!this.orthoU16 || !this.meta) return null;
    if (this.orthoTexture) return this.orthoTexture;
    const m = this.meta;
    const n = m.width * m.height;
    // 归一化：按全部打包样本 99.5 分位亮度拉伸到 0..255（I/F 原值保存在 ortho.u16，
    // 此纹理仅作地表反照率显示；分母写入 userData 供溯源）
    const p995 = orthoP995(this.orthoU16);
    const denom = Math.max(1, p995 / 255);
    // P3-T3：RedFormat 单通道作 map 会渲染成 (r,0,0) 纯红灰度（P2 录像的"火星"偏色根因），
    // 改为 RGBAFormat 把灰度复制进 RGB 三通道。
    const rgba = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const v = this.validMask ? (this.validMask[i] ? Math.min(255, Math.round(this.orthoU16[i] / denom)) : 0) : Math.min(255, Math.round(this.orthoU16[i] / denom));
      rgba[i * 4] = v;
      rgba[i * 4 + 1] = v;
      rgba[i * 4 + 2] = v;
      rgba[i * 4 + 3] = 255;
    }
    const tex = new THREE.DataTexture(rgba, m.width, m.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 8; // 地表停驻为掠射视角：各向异性过滤显著降低斜视糊感（WAC 层同设 4）
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.flipY = false; // 窗口行 0 = 北；UV v 直接按行号方向（见网格构建）
    tex.needsUpdate = true;
    tex.userData = { normalizerDenominator: denom, note: 'LROC NAC 正射 I/F 16-bit → 8-bit 显示拉伸' };
    this.orthoTexture = tex;
    return tex;
  }
}
