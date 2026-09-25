import * as THREE from 'three';

export interface DepthSlice { near: number; far: number }

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

  render(renderer: Renderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): DepthSlice[] {
    const slices = depthSlices(camera.near, camera.far);
    if (slices.length === 1) {
      renderer.render(scene, camera);
      return slices;
    }
    // Same camera pose/FOV for every pass. Camera clipping splits geometry that
    // crosses a boundary, including rings/terrain/vehicles; no body-id buckets.
    this.passCamera.copy(camera, false);
    camera.updateWorldMatrix(true, false);
    camera.matrixWorld.decompose(this.passCamera.position, this.passCamera.quaternion, this.passCamera.scale);
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
    } finally {
      renderer.autoClear = autoClear;
    }
    return slices;
  }
}
