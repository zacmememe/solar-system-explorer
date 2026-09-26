import { Box3, Euler, MathUtils, Vector3 } from 'three';

/** Camera-local presentation only. Physical dimensions and the world camera stay intact. */
export function formationFraming(
  box: Box3, maxDim: number, span: number, rotation: readonly [number, number, number],
  fov: number, aspect: number,
): { x: number; scale: number } {
  const depth = 2.1, y = -.34, bob = .012, margin = .92;
  const halfY = Math.tan(MathUtils.degToRad(fov / 2));
  const halfX = halfY * aspect;
  const x = Math.min(.48, halfX * depth * .55);
  const limitX = margin * halfX, limitY = margin * halfY;
  let scale = span / maxDim;
  const attitude = new Euler(...rotation);
  const corner = new Vector3();
  // Each constraint is linear in presentation scale, including perspective depth.
  // Bounding every corner also bounds the whole convex box and the bob envelope.
  const constrain = (slope: number, room: number) => {
    if (slope > 0) scale = Math.min(scale, room / slope);
  };
  for (const px of [box.min.x, box.max.x]) for (const py of [box.min.y, box.max.y]) for (const pz of [box.min.z, box.max.z]) {
    corner.set(px, py, pz).applyEuler(attitude);
    constrain(corner.x + limitX * corner.z, limitX * depth - x);
    constrain(-corner.x + limitX * corner.z, limitX * depth + x);
    constrain(corner.y + limitY * corner.z, limitY * depth - y - bob);
    constrain(-corner.y + limitY * corner.z, limitY * depth + y - bob);
    constrain(corner.z, depth - .1);
  }
  return { x, scale };
}
