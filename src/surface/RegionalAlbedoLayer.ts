/**
 * 区域反照率层 RegionalAlbedoLayer（P3b-C，Pro C 批第 2/5 条）
 *
 * 职责：在 NAC DTM 窗口（内圈）之外、直到 WAC 裁窗边界的范围内，把月面从
 * 2K 全球图升级为 WAC EMP 643nm 实测反照率（99.75 m/px）。
 *
 * 设计（Pro §6.3/6.4）：
 * - 环形网格：外缘 = WAC 裁窗边界（半径渐落回球面，几何无缝），内缘 = 挖孔球面
 *   孔边界（与裙边外缘共圈；裙边材质随后也换 WAC——同源影像、同照明模型）；
 * - 同一不透明表面混合：加载完成后 0.35s 时间域淡入；缺层时父级（全球图）兜底，
 *   不挖黑洞、不加透明壳；
 * - 显示口径由离线打包统一（增益匹配 NAC 正射、外缘羽化回底图）——运行时不做
 *   逐瓦片拉伸；
 * - SSE 门控用实际 drawingBuffer 与 FOV（见 screenSpaceMetrics），有迟滞。
 */
import * as THREE from 'three';
import { imageryLayerGate } from '../world-support/screenSpaceMetrics';

export interface AlbedoLayerMeta {
  schemaVersion: number;
  layerId: string;
  fidelityClaim: string;
  sourceProduct: string;
  band: string;
  pixelsPerDegree: number;
  nativeSpacingMeters: number;
  width: number;
  height: number;
  bounds: { lonMin: number; lonMax: number; latMin: number; latMax: number };
  coordinateSystem: string;
  albedoSha256: string;
  displayTransform: { gain: number };
}

const FADE_SEC = 0.35;

export class RegionalAlbedoLayer {
  private readonly baseRadius: number;
  private readonly holeBounds: { latMin: number; latMax: number; lonMin: number; lonMax: number };
  private mesh: THREE.Mesh | null = null;
  private material: THREE.MeshStandardMaterial | null = null;
  private texture: THREE.Texture | null = null;
  /** 供裙边材质换装的全球等距圆柱 UV 变换纹理（与 overlay 共享图像，独立 UV 变换） */
  private collarTexture: THREE.Texture | null = null;
  private meta: AlbedoLayerMeta | null = null;
  private loadError: string | null = null;
  private visibleNow = false;
  private fadeT = 0;
  private lastGate: { layerTexelPx: number; baseTexelPx: number } | null = null;

  /** 父级（全球图）采样密度：2K 等距圆柱 ≈ 2πR/2048 = 5331 m/texel（纬向，保守值） */
  public static readonly BASE_TEXEL_M = 5331;

  constructor(
    baseRadius: number,
    holeBounds: { latMin: number; latMax: number; lonMin: number; lonMax: number }
  ) {
    this.baseRadius = baseRadius;
    this.holeBounds = holeBounds;
  }

  public get isReady(): boolean {
    return !!this.texture && !!this.mesh;
  }

  public get error(): string | null {
    return this.loadError;
  }

  public get provenance(): AlbedoLayerMeta | null {
    return this.meta;
  }

  /** 最近一次 SSE 门控诊断（HUD/验收脚本） */
  public get lastGateDiagnostics(): { layerTexelPx: number; baseTexelPx: number; visible: boolean } | null {
    return this.lastGate ? { ...this.lastGate, visible: this.visibleNow } : null;
  }

  /**
   * 装载裁窗影像并构建环形网格。就绪前不向场景添加任何对象（父级全球图兜底）；
   * 失败只记录错误——不影响已有地形与正射链路。
   */
  public async load(baseUrl = '/data/imagery/wac-emp-taurus-v1'): Promise<void> {
    try {
      const [metaRes, imgRes] = await Promise.all([
        fetch(`${baseUrl}/metadata.json`),
        fetch(`${baseUrl}/albedo.jpg`),
      ]);
      if (!metaRes.ok || !imgRes.ok) throw new Error(`HTTP ${metaRes.status}/${imgRes.status}`);
      const meta = (await metaRes.json()) as AlbedoLayerMeta;
      const blob = await imgRes.blob();
      // 完整性：SHA-256 与打包 metadata 一致（与 DEM 管线同一防投毒口径）
      const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
      const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
      if (hash !== meta.albedoSha256) throw new Error('SHA-256 校验不符');

      const tex = await new THREE.TextureLoader().loadAsync(URL.createObjectURL(blob));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;

      this.texture = tex;
      this.meta = meta;
      this.material = new THREE.MeshStandardMaterial({
        map: tex,
        color: 0xffffff,
        roughness: 0.95,
        metalness: 0.05,
        side: THREE.FrontSide,
        // 压过基准球面防 z-fighting（ε 半径 + 窗口空间偏移双保险）
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      this.mesh = new THREE.Mesh(this.buildAnnulusGeometry(meta.bounds), this.material);
      this.mesh.name = 'wac-emp-regional-albedo';
      this.mesh.visible = false;
      this.mesh.receiveShadow = true;

      // 裙边换装纹理：与 overlay 同图像，按全球等距圆柱 UV 逆映射取样
      // （裙边 u_g∈[u0,u0+du] → 裁影像元 [0,1]：repeat=1/du, offset=−u0/du）
      const collarTex = tex.clone();
      const du = (meta.bounds.lonMax - meta.bounds.lonMin) / 360;
      const dv = (meta.bounds.latMax - meta.bounds.latMin) / 180;
      const u0 = (meta.bounds.lonMin + 180) / 360;
      const v0 = (meta.bounds.latMin + 90) / 180;
      collarTex.wrapS = THREE.ClampToEdgeWrapping;
      collarTex.wrapT = THREE.ClampToEdgeWrapping;
      collarTex.repeat.set(1 / du, 1 / dv);
      collarTex.offset.set(-u0 / du, -v0 / dv);
      collarTex.needsUpdate = true;
      this.collarTexture = collarTex;
    } catch (err) {
      this.loadError = err instanceof Error ? err.message : String(err);
    }
  }

  /** 就绪后调用：把网格挂到月面（body-fixed 局部系），返回裙边换装纹理 */
  public attach(parent: THREE.Object3D): THREE.Texture | null {
    if (!this.isReady || !this.mesh) return null;
    parent.add(this.mesh);
    return this.collarTexture;
  }

  /**
   * 每帧 SSE 门控 + 淡入（Pro §6.4：时间域渐变，HOLD 时也能完成已就绪的提升）。
   * drawingBufferHeightPx 与 vFovRad 必须来自实际渲染目标与相机。
   */
  public update(
    surfaceDistM: number,
    drawingBufferHeightPx: number,
    vFovRad: number,
    deltaSec: number
  ): void {
    if (!this.isReady || !this.mesh || !this.material) return;
    const layerTexelM = this.meta?.nativeSpacingMeters ?? 99.75;
    const gate = imageryLayerGate({
      layerTexelM,
      baseTexelM: RegionalAlbedoLayer.BASE_TEXEL_M,
      focalPx: drawingBufferHeightPx / (2 * Math.tan(vFovRad / 2)),
      viewDepthM: surfaceDistM,
      currentlyVisible: this.visibleNow,
    });
    this.lastGate = { layerTexelPx: gate.layerTexelPx, baseTexelPx: gate.baseTexelPx };

    if (gate.visible) {
      if (!this.visibleNow) {
        this.visibleNow = true;
        this.fadeT = 0;
        this.material.transparent = true;
        this.material.opacity = 0;
      }
      if (this.fadeT < 1) {
        this.fadeT = Math.min(1, this.fadeT + deltaSec / FADE_SEC);
        this.material.opacity = this.fadeT;
        if (this.fadeT >= 1) {
          // 淡入完成回到不透明（Pro：同一不透明表面上混合）
          this.material.transparent = false;
          this.material.opacity = 1;
          this.material.needsUpdate = true;
        }
      }
      this.mesh.visible = true;
    } else {
      this.visibleNow = false;
      this.mesh.visible = false;
    }
  }

  /**
   * 矩形环网格：内缘 = 挖孔边界，外缘 = 裁窗边界。
   * 半径 = baseRadius·(1 + EPS·taper)：内部恒定微抬，外缘 0.3° 内 smoothstep
   * 渐落回球面（与父级几何无缝）。UV 为裁窗等距圆柱局部坐标。
   */
  private buildAnnulusGeometry(
    outer: { latMin: number; latMax: number; lonMin: number; lonMax: number }
  ): THREE.BufferGeometry {
    const hole = this.holeBounds;
    const EPS = 1e-5 * 3; // ~50 m 物理高度，配合 polygonOffset 防斗面
    const TAPER_DEG = 0.3;

    // 环形参数化：周向 k ∈ [0, 4·edgeSegs)，内外矩形按同一周长分数对应
    //（S→E→N→W 各边按比例）。两个同向轴对齐矩形的边-边对应不会切角——
    // 径向射线映射（裙边同款数学）在孔角处会切进孔内，此处不采用。
    const edgeSegs = 160;
    const rings = 16;
    const perimeter = 4 * edgeSegs;
    const rectAt = (
      k: number,
      b: { latMin: number; latMax: number; lonMin: number; lonMax: number }
    ): { lat: number; lon: number } => {
      const s = k % perimeter;
      const e = Math.floor(s / edgeSegs);
      const f = (s % edgeSegs) / edgeSegs;
      if (e === 0) return { lat: b.latMin, lon: b.lonMin + f * (b.lonMax - b.lonMin) };
      if (e === 1) return { lat: b.latMin + f * (b.latMax - b.latMin), lon: b.lonMax };
      if (e === 2) return { lat: b.latMax, lon: b.lonMax - f * (b.lonMax - b.lonMin) };
      return { lat: b.latMax - f * (b.latMax - b.latMin), lon: b.lonMin };
    };
    const innerAt = (k: number) => rectAt(k, hole);
    const outerAt = (k: number) => rectAt(k, outer);

    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const smoothstep = (t: number) => {
      const c = Math.max(0, Math.min(1, t));
      return c * c * (3 - 2 * c);
    };
    for (let r = 0; r <= rings; r++) {
      const tR = r / rings;
      for (let k = 0; k < perimeter; k++) {
        const a = innerAt(k);
        const b = outerAt(k);
        const lat = a.lat + (b.lat - a.lat) * tR;
        const lon = a.lon + (b.lon - a.lon) * tR;
        // 外缘渐落：距外边界 <TAPER_DEG 时半径平滑回到球面
        const dEdge = Math.min(
          outer.latMax - lat, lat - outer.latMin, outer.lonMax - lon, lon - outer.lonMin
        );
        const taper = smoothstep(dEdge / TAPER_DEG);
        const rr = this.baseRadius * (1 + EPS * taper);
        const latRad = THREE.MathUtils.degToRad(lat);
        const lonRad = THREE.MathUtils.degToRad(lon);
        const cosLat = Math.cos(latRad);
        positions.push(rr * cosLat * Math.cos(lonRad), rr * Math.sin(latRad), -rr * cosLat * Math.sin(lonRad));
        uvs.push(
          (lon - outer.lonMin) / (outer.lonMax - outer.lonMin),
          (lat - outer.latMin) / (outer.latMax - outer.latMin)
        );
      }
    }
    const stride = perimeter;
    for (let r = 0; r < rings; r++) {
      for (let k = 0; k < perimeter; k++) {
        const kNext = (k + 1) % perimeter;
        const a = r * stride + k;
        const d = r * stride + kNext;
        const b = (r + 1) * stride + k;
        const c = (r + 1) * stride + kNext;
        // 与窗口网格一致的外向绕序（lat 增 × lon 增 叉积指向球面外侧）
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
