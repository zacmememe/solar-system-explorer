import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Recognisable module construction, in the existing simplified ISS model units.
 * Reference features: tapered end cones, narrow interfaces, outer shields,
 * EVA handrails, node side ports and Cupola's six side windows plus centre pane.
 * This is procedural illustration, not a surveyed station/configuration model.
 */
export function addISSModules(parent: THREE.Group): void {
  const materials = [
    new THREE.MeshStandardMaterial({ name: 'iss-module-blankets', color: 0xdbdfdc, metalness: .06, roughness: .78 }),
    new THREE.MeshStandardMaterial({ name: 'iss-module-shields', color: 0xeff0eb, metalness: .12, roughness: .62 }),
    new THREE.MeshStandardMaterial({ name: 'iss-interface-metal', color: 0x829099, metalness: .55, roughness: .4 }),
    new THREE.MeshStandardMaterial({ name: 'iss-interface-recess', color: 0x222b32, metalness: .15, roughness: .7 }),
    new THREE.MeshStandardMaterial({ name: 'iss-eva-handrails', color: 0xc6aa6d, metalness: .35, roughness: .55 }),
    new THREE.MeshStandardMaterial({ name: 'iss-cupola-windows', color: 0x0d202d, metalness: .2, roughness: .14 }),
  ];
  const batches: THREE.BufferGeometry[][] = materials.map(() => []);
  function add(g: THREE.BufferGeometry, material: number, transform = new THREE.Matrix4()) {
    g.applyMatrix4(transform);
    // All generated surfaces share the same indexed attribute layout before
    // merging. Six material batches avoid a draw call per small panel/rail.
    batches[material].push(g.index ? g.toNonIndexed() : g);
    if (g.index) g.dispose();
  }
  const transform = (position: THREE.Vector3, rotation = new THREE.Quaternion()) => new THREE.Matrix4().compose(position, rotation, new THREE.Vector3(1, 1, 1));
  const yToZ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  function tube(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: number, outer = new THREE.Matrix4()) {
    const d = b.clone().sub(a);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    add(new THREE.CylinderGeometry(radius, radius, d.length(), 8), material, outer.clone().multiply(transform(a.clone().add(b).multiplyScalar(.5), q)));
  }
  function cylinder(radius: number, length: number, z: number, material: number, outer: THREE.Matrix4) {
    add(new THREE.CylinderGeometry(radius, radius, length, 24), material, outer.clone().multiply(transform(new THREE.Vector3(0, 0, z), yToZ)));
  }
  function ring(radius: number, thickness: number, z: number, material: number, outer: THREE.Matrix4) {
    add(new THREE.TorusGeometry(radius, thickness, 6, 32), material, outer.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, z)));
  }
  function module(radius: number, length: number, position: THREE.Vector3, axis = new THREE.Quaternion()) {
    const outer = transform(position, axis), half = length / 2, neck = radius * .57;
    const profile = [[0,-half],[neck,-half],[neck,-half+.045],[radius-.02,-half+.16],[radius,-half+.19],[radius,half-.19],[radius-.02,half-.16],[neck,half-.045],[neck,half],[0,half]].map(([r,z]) => new THREE.Vector2(r,z));
    add(new THREE.LatheGeometry(profile, 32), 0, outer.clone().multiply(transform(new THREE.Vector3(), yToZ)));
    const barrel = length - .4, rows = length > 1.1 ? 3 : 2;
    for (let row = 0; row < rows; row++) for (let sector = 0; sector < 10; sector++) {
      // Curved shallow shield panels with real gaps; no oversized rivet noise.
      const panel = new THREE.CylinderGeometry(radius + .009, radius + .009, barrel / rows - .016, 4, 1, true, sector * Math.PI / 5 + .025, Math.PI / 5 - .05);
      const z = -barrel / 2 + (row + .5) * barrel / rows;
      add(panel, (row + sector) % 4 === 0 ? 0 : 1, outer.clone().multiply(transform(new THREE.Vector3(0, 0, z), yToZ)));
    }
    for (const sign of [-1, 1]) {
      ring(neck + .013, .022, sign * (half - .01), 2, outer);
      cylinder(neck * .9, .045, sign * (half + .0225), 2, outer);
      // Dark seal connects the hatch to its collar; it is visible around the
      // smaller white hatch instead of buried inside a solid metal cap.
      cylinder(neck * .74, .026, sign * (half + .049), 3, outer);
      // Keep the hatch clear of the collar cap even in the preview's wide
      // depth range; near-coplanar faces produced speckled end plates.
      cylinder(neck * .67, .028, sign * (half + .065), 1, outer);
      ring(radius - .008, .008, sign * (half - .195), 2, outer);
    }
    // A few raised EVA handholds and feet, on two accessible longitudinal runs.
    for (const theta of [.65, 2.4, 4.2]) for (const z of [-.19, .19]) {
      const radial = new THREE.Vector3(Math.cos(theta), Math.sin(theta), 0);
      const a = radial.clone().multiplyScalar(radius + .045); a.z = z - .095;
      const b = a.clone(); b.z = z + .095;
      tube(a, b, .009, 4, outer);
      for (const p of [a,b]) { const foot = radial.clone().multiplyScalar(radius + .012); foot.z = p.z; tube(foot, p, .008, 2, outer); }
    }
  }
  const axial: [number, number][] = [[.265,1.16],[.305,1.1],[.35,1.0],[.32,1.1],[.29,1.16]];
  axial.forEach(([radius,length], i) => module(radius, length, new THREE.Vector3(0,0,(i-2)*1.25)));
  for (let i = 0; i < 4; i++) cylinder(.145, .30, (i - 1.5) * 1.25, 2, new THREE.Matrix4());
  for (const sign of [-1,1]) {
    const axis = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), sign*Math.PI/2);
    const outer = transform(new THREE.Vector3(0,0,.65), axis);
    cylinder(.17, .45, .22, 2, outer);
    module(sign < 0 ? .285 : .25, sign < 0 ? 1.15 : .95, new THREE.Vector3(sign*.85,0,.65), axis);
  }
  // Cupola: opaque faceted hull, six inset side windows and a central end pane.
  add(new THREE.CylinderGeometry(.16,.25,.22,6), 1, new THREE.Matrix4().makeTranslation(0,-.42,.65));
  for (let i=0;i<6;i++) {
    const a=i*Math.PI/3, b=(i+1)*Math.PI/3;
    const corners = [new THREE.Vector3(.163*Math.sin(a),-.31,.65+.163*Math.cos(a)),new THREE.Vector3(.163*Math.sin(b),-.31,.65+.163*Math.cos(b)),new THREE.Vector3(.254*Math.sin(b),-.53,.65+.254*Math.cos(b)),new THREE.Vector3(.254*Math.sin(a),-.53,.65+.254*Math.cos(a))];
    const centre = corners.reduce((v,p)=>v.add(p),new THREE.Vector3()).multiplyScalar(.25);
    corners.forEach(p=>p.lerp(centre,.18));
    const g=new THREE.BufferGeometry().setFromPoints(corners); g.setIndex([0,2,1,0,3,2]); g.setAttribute('uv',new THREE.Float32BufferAttribute([0,1,1,1,1,0,0,0],2)); g.computeVertexNormals(); add(g,5);
  }
  const bottom = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), Math.PI/2);
  add(new THREE.CircleGeometry(.18,32),5,transform(new THREE.Vector3(0,-.532,.65),bottom));
  add(new THREE.TorusGeometry(.193,.012,6,32),2,transform(new THREE.Vector3(0,-.533,.65),bottom));
  batches.forEach((geometries,i) => {
    const geometry = mergeGeometries(geometries, false);
    geometries.forEach(g=>g.dispose());
    if (!geometry) throw new Error('ISS geometry merge failed');
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, materials[i]); mesh.name = materials[i].name; parent.add(mesh);
  });
}
