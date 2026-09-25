import * as THREE from 'three';

/** One linear physical frame for local terrain AND distant bodies. In particular,
 * do not clamp each distant body to a sky shell: that loses relative depth and
 * can place a small foreground planet behind the larger solar disc in a transit.
 * DepthSliceRenderer handles the resulting large depth range.
 */
export function projectDistantBody(
  bodyKm: readonly number[], radiusKm: number,
  referenceKm: readonly number[], referenceScene: THREE.Vector3,
  sceneUnitsPerKm: number,
): { position: THREE.Vector3; radius: number } {
  const delta = new THREE.Vector3(
    bodyKm[0] - referenceKm[0],
    bodyKm[1] - referenceKm[1],
    bodyKm[2] - referenceKm[2],
  ).multiplyScalar(sceneUnitsPerKm);
  return { position: referenceScene.clone().add(delta), radius: radiusKm * sceneUnitsPerKm };
}
