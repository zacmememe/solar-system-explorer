/**
 * 屏幕空间误差（SSE）纯函数（P3b-C，Pro §6.1/6.4）
 *
 * 三个量严格分离（Pro 铁律）：
 * - 影像采样密度 g（m/px）：决定图像能提供多少地理信息；
 * - DEM 格点间距：不是垂直精度；
 * - 网格几何误差 ε：不是影像像素尺寸。
 * 本模块只做影像层级判定的数学；几何 SSE（误差界）归地形层（P3-T5 LOLA），
 * 不在此处用高度单值冒充。
 *
 * 正下视、小平面、中心像素近似：f_px = H/(2·tan(f/2))，projected = g·f_px/viewDepth。
 * 斜视的保守做法是用视锥内最大 viewDepth（而非 AGL 单值）；地平线掠射极端像素
 * 不应驱动全月最高精度——由阈值上限与迟滞共同约束。
 */

/** 焦距（像素）：drawingBuffer 高度与垂直 FOV → 像素焦距 */
export function focalPixelsPx(drawingBufferHeightPx: number, vFovRad: number): number {
  if (!(drawingBufferHeightPx > 0) || !(vFovRad > 0) || !(vFovRad < Math.PI)) {
    throw new RangeError('Invalid focal length input');
  }
  return drawingBufferHeightPx / (2 * Math.tan(vFovRad / 2));
}

/** 正下视中心近似：源像元投影到屏幕的尺寸（px） */
export function projectedTexelPx(texelMeters: number, focalPx: number, viewDepthM: number): number {
  if (!(texelMeters > 0) || !(focalPx > 0) || !(viewDepthM > 0)) {
    throw new RangeError('Invalid projected texel input');
  }
  return (texelMeters * focalPx) / viewDepthM;
}

export interface ImageryLayerGateInput {
  /** 候选层采样密度（m/px），如 WAC 99.75 */
  layerTexelM: number;
  /** 父级（兜底）层采样密度（m/px），如 2K 全球图 ~5331 */
  baseTexelM: number;
  focalPx: number;
  /** 相机到目标区地表的视深（米）——斜视时用视锥内最大深度，非 AGL 单值 */
  viewDepthM: number;
  /** 当前是否已显示（迟滞） */
  currentlyVisible: boolean;
}

export interface ImageryLayerGateResult {
  visible: boolean;
  /** 诊断量（HUD/验收用）：本帧候选层与父级投影像元尺寸 */
  layerTexelPx: number;
  baseTexelPx: number;
}

/** 进入阈值：候选层 ≥0.30 px/源像元 且父级已模糊到 ≥2 px/源像元（换层确有收益） */
export const IMAGERY_LAYER_ENTER_TEXEL_PX = 0.3;
/** 退出阈值（迟滞下限）：候选层 <0.22 px 才隐藏，避免阈值附近闪烁 */
export const IMAGERY_LAYER_EXIT_TEXEL_PX = 0.22;
/** 父级模糊门槛：父级 <2 px/源像元 时换层无肉眼收益 */
export const IMAGERY_BASE_BLUR_TEXEL_PX = 2.0;

/**
 * 影像层可见性判定（带迟滞）。
 * 进入需同时满足"候选层可用"与"父级明显更糊"；退出仅看候选层下限。
 */
export function imageryLayerGate(input: ImageryLayerGateInput): ImageryLayerGateResult {
  const layerTexelPx = projectedTexelPx(input.layerTexelM, input.focalPx, input.viewDepthM);
  const baseTexelPx = projectedTexelPx(input.baseTexelM, input.focalPx, input.viewDepthM);
  const floorPx = input.currentlyVisible ? IMAGERY_LAYER_EXIT_TEXEL_PX : IMAGERY_LAYER_ENTER_TEXEL_PX;
  const visible = layerTexelPx >= floorPx && (input.currentlyVisible || baseTexelPx >= IMAGERY_BASE_BLUR_TEXEL_PX);
  return { visible, layerTexelPx, baseTexelPx };
}

/**
 * 地形块距离渐显（P3b-E，用户反馈 2026-09-24：远看闪烁小光点 + 方块突现）。
 *
 * DTM 窗口块是场景中唯一被物理照亮的几何，且此前无距离门控——远看是月盘中心
 * 的亚像素亮点（走样闪烁），接近到几十像素时又"啪"地显出方块形状。此处按块
 * 的屏幕张角（px）做 smoothstep 渐显：
 * - 下限 8px：以下完全隐藏（亚像素走样区，纹理再真也只是噪声闪烁）；
 * - 上限 36px：块在 WAC 影像门控开启距离处的张角（窗口 12000m / WAC 像元
 *   99.75m × 进入阈值 0.30px ≈ 36px）——几何与影像在门控开启时同步就位，
 *   此前几何先于影像逐渐显形。两个量同随焦距缩放，阈值与视口无关。
 */
export const TERRAIN_REVEAL_MIN_PX = 8;
export const TERRAIN_REVEAL_FULL_PX = 36;

export function terrainRevealOpacity(blockPx: number): number {
  if (!Number.isFinite(blockPx) || blockPx <= 0) return 0;
  const s = Math.min(
    1,
    Math.max(0, (blockPx - TERRAIN_REVEAL_MIN_PX) / (TERRAIN_REVEAL_FULL_PX - TERRAIN_REVEAL_MIN_PX))
  );
  return s * s * (3 - 2 * s);
}
