import * as THREE from 'three';

export interface DepthSlice { near: number; far: number }

/**
 * F-VEHICLE-FOREGROUND-01：展示载具专属 layer。世界 pass 一律只渲染 layer 0，
 * 载具挂在 display layer；世界（含分段深度）完成后用独立展示 pass 绘制——
 * 只清深度保留世界颜色，模型自遮挡/光照/透明件在 pass 内正常，不被世界
 * near/far 分段与深度互相吞没。纯星球观察时载具 visible=false，pass 跳过。
 */
export const VEHICLE_DISPLAY_LAYER = 1;

/** Contiguous view-depth intervals; each fragment belongs to one interval. */
export function depthSlices(near: number, far: number): DepthSlice[] {
  if (!(near > 0 && far > near && Number.isFinite(far))) throw new Error('Invalid camera depth range');
  // Modest depth ranges need one projection. Astronomical and metric surface
  // views need bounded ratios; changing near while sharing depth is never valid.
  if (far / near <= 1e6) return [{ near, far }];
  const slices: DepthSlice[] = [];
  for (let lo = near; lo < far;) {
    const hi = Math.min(far, lo * 1e4);
    slices.push({ near: lo, far: hi });
    lo = hi;
  }
  return slices.reverse();
}

type Renderer = Pick<THREE.WebGLRenderer, 'autoClear' | 'clear' | 'clearDepth' | 'render'>;

export class DepthSliceRenderer {
  private readonly passCamera = new THREE.PerspectiveCamera();

  render(
    renderer: Renderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    options?: { displayLayer?: number }
  ): DepthSlice[] {
    const displayLayer = options?.displayLayer;
    const slices = depthSlices(camera.near, camera.far);
    // Same camera pose/FOV for every pass. Camera clipping splits geometry that
    // crosses a boundary, including rings/terrain; no body-id buckets.
    this.passCamera.copy(camera, false);
    camera.updateWorldMatrix(true, false);
    camera.matrixWorld.decompose(this.passCamera.position, this.passCamera.quaternion, this.passCamera.scale);
    // 世界 pass 只见 layer 0（display layer 由末段独立 pass 消费）。
    this.passCamera.layers.set(0);
    this.passCamera.updateProjectionMatrix();
    this.passCamera.updateMatrixWorld(true);
    const autoClear = renderer.autoClear;
    try {
      renderer.autoClear = false;
      renderer.clear(true, true, true);
      for (let i = 0; i < slices.length; i++) {
        if (i > 0) renderer.clearDepth();
        this.passCamera.near = slices[i].near;
        this.passCamera.far = slices[i].far;
        this.passCamera.updateProjectionMatrix();
        renderer.render(scene, this.passCamera);
      }
      if (displayLayer != null) {
        // 独立展示 pass：世界深度完成后只清深度；世界颜色不被清空，
        // 载具不被世界深度吞没，也不重复出现在世界 pass 中。
        renderer.clearDepth();
        this.passCamera.layers.set(displayLayer);
        renderer.render(scene, this.passCamera);
      }
    } finally {
      renderer.autoClear = autoClear;
      this.passCamera.layers.set(0);
    }
    return slices;
  }
}
