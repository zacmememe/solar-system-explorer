import * as THREE from 'three';

/** Hide a label only when its entire apparent disc lies behind an opaque body. */
export function discIsOccluded(observer: THREE.Vector3, target: {pos:THREE.Vector3;surfaceRadius:number}, blocker: {pos:THREE.Vector3;surfaceRadius:number}): boolean {
  const a=target.pos.clone().sub(observer), b=blocker.pos.clone().sub(observer);
  const da=a.length(), db=b.length();
  if (db<=blocker.surfaceRadius || da<=target.surfaceRadius || db+blocker.surfaceRadius>=da-target.surfaceRadius) return false;
  const separation=a.angleTo(b);
  return separation+Math.asin(Math.min(1,target.surfaceRadius/da)) < Math.asin(Math.min(1,blocker.surfaceRadius/db));
}

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
