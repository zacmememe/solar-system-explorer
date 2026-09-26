import { MathUtils } from 'three';

/** Rotation-invariant fit: the model can turn freely without the camera pumping. */
export function previewDistance(radius: number, fov: number, aspect: number): number {
  const halfAngle = Math.atan(Math.tan(MathUtils.degToRad(fov / 2)) * Math.min(1, aspect) * .9);
  return radius / Math.sin(halfAngle);
}
