import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { TerrainHeightProvider } from '../src/surface/TerrainHeightProvider';
import { LolaRegionalSource } from '../src/surface/LolaRegionalSource';
import { MolaRegionalSource } from '../src/surface/MolaRegionalSource';
import { RasterTerrainSource } from '../src/surface/RasterTerrainSource';
import { LANDING_SITES } from '../src/contracts/landing';

const terrain = TerrainHeightProvider.getInstance();
const lola = new LolaRegionalSource();
const mola = new MolaRegionalSource();
beforeAll(async () => {
  vi.stubGlobal('fetch', async (url: string) => {
    const buf = await readFile(path.join('public', url));
    return new Response(new Uint8Array(buf));
  });
  await Promise.all([lola.load(), mola.load()]);
  const dir = 'public/data/dem/apollo17-v1';
  const read = async (name: string) => new Uint8Array(await readFile(`${dir}/${name}`)).buffer;
  await RasterTerrainSource.getInstance().injectBuffers(
    JSON.parse(await readFile(`${dir}/metadata.json`, 'utf8')),
    await read('height.f32'), await read('valid.u8'), await read('ortho.u16'),
  );
});
afterAll(() => vi.unstubAllGlobals());

function direction(lat: number, lon: number) {
  const a = THREE.MathUtils.degToRad(lat), b = THREE.MathUtils.degToRad(lon);
  return new THREE.Vector3(Math.cos(a) * Math.cos(b), Math.sin(a), -Math.cos(a) * Math.sin(b));
}
function hits(mesh: THREE.Mesh, lat: number, lon: number) {
  const d = direction(lat, lon);
  return new THREE.Raycaster(d.clone().multiplyScalar(2), d.negate(), 0, 1.5).intersectObject(mesh).length;
}
function assertOutward(geometry: THREE.BufferGeometry | null) {
  expect(geometry).not.toBeNull();
  const pos = geometry!.getAttribute('position'), idx = geometry!.getIndex()!;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let inward = 0, counted = 0;
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(pos, idx.getX(i));
    b.fromBufferAttribute(pos, idx.getX(i + 1)).sub(a);
    c.fromBufferAttribute(pos, idx.getX(i + 2)).sub(a);
    const n = b.cross(c);
    if (n.lengthSq() < 1e-22) continue;
    counted++;
    if (n.dot(a) < 0) inward++;
  }
  geometry!.dispose();
  expect(counted).toBeGreaterThan(100);
  expect(inward, 'terrain front faces must point into the sky').toBe(0);
}

describe('terrain replaces the correct part of the globe', () => {
  for (const site of Object.values(LANDING_SITES)) {
    it(`opens the actual site, preserving the opposite latitude: ${site.id}`, () => {
      const { centerLat: lat, centerLon: lon } = site;
      const result = terrain.buildHoledMoonSphereGeometry(1, 128, 64, {
        latMin: lat - 0.1, latMax: lat + 0.1, lonMin: lon - 0.1, lonMax: lon + 0.1,
      })!;
      const mat = new THREE.MeshBasicMaterial();
      const mesh = new THREE.Mesh(result.geometry, mat);
      mesh.updateMatrixWorld(true);
      expect(hits(mesh, lat, lon), 'coarse globe still covers landing site').toBe(0);
      expect(hits(mesh, Math.abs(lat) > 5 ? -lat : -30, lon)).toBeGreaterThan(0);
      result.geometry.dispose(); mat.dispose();
    });
  }
  it('LOLA regional-to-globe skirt faces outward', () => {
    const bounds = terrain.buildHoledMoonSphereGeometry(1, 128, 64, lola.windowBounds!)!.holeBounds;
    assertOutward(lola.buildBoundarySkirt(1, bounds));
  });
  it('LOLA high-resolution rim faces outward', () => {
    const raster = RasterTerrainSource.getInstance();
    assertOutward(lola.buildWindowRimSkirt(1, raster.windowBounds!, (lat, lon) => raster.sampleHeight(lat, lon).heightM));
  });
  it('MOLA regional-to-globe skirt faces outward', () => {
    const bounds = terrain.buildHoledMoonSphereGeometry(1, 128, 64, mola.windowBounds!)!.holeBounds;
    assertOutward(mola.buildBoundarySkirt(1, bounds));
  });
  it('MOLA high-resolution rim faces outward', () => {
    const b = mola.windowBounds!;
    const lat = (b.latMin + b.latMax) / 2, lon = (b.lonMin + b.lonMax) / 2;
    assertOutward(mola.buildWindowRimSkirt(1, {latMin:lat-0.1,latMax:lat+0.1,lonMin:lon-0.1,lonMax:lon+0.1}, () => -2000));
  });
  it('fallback DEM-to-globe collar faces outward', () => {
    const bounds = terrain.buildHoledMoonSphereGeometry(1)!.holeBounds;
    assertOutward(terrain.buildCollarGeometry(1, bounds));
  });
});
