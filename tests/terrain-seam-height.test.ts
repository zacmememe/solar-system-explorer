import { afterEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as THREE from 'three';
import { JezeroTerrainSource } from '../src/surface/JezeroTerrainSource';
import { MolaRegionalSource } from '../src/surface/MolaRegionalSource';
import { renderedTerrainBounds, sampleRenderedTerrain } from '../src/surface/ProceduralRockField';

afterEach(() => vi.unstubAllGlobals());
it('Jezero skirt joins actual decimated edge without a zero-datum vertical wall', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(new Uint8Array(await readFile(path.join('public', url)))));
  const dtm=new JezeroTerrainSource(), mola=new MolaRegionalSource();
  await Promise.all([dtm.load(),mola.load()]);
  const geometry=dtm.buildDemWindowGeometry(1)!, bounds=renderedTerrainBounds(geometry);
  const wb=dtm.windowBounds!,mpd=dtm.datumRadius*Math.PI/180,cos=Math.cos(dtm.metaReady!.site.centerLat*Math.PI/180);
  // The previous callback returned invalid.heightM=0 on this source edge.
  expect(dtm.sampleHeight(dtm.windowBounds!.latMin,dtm.windowBounds!.lonMax).valid).toBe(false);
  const rim=mola.buildWindowRimSkirt(1,bounds,(lat,lon)=>{
    const point=sampleRenderedTerrain(geometry,lat,lon);
    expect(point).not.toBeNull();
    const height=(point!.length()-1)*dtm.datumRadius;
    expect(height).toBeLessThan(-2000);
    return height;
  },.15,10,96,(lat,lon)=>[(lon-wb.lonMin)*mpd*cos/dtm.uvSpanMeters.x,(wb.latMax-lat)*mpd/dtm.uvSpanMeters.y])!;
  // The first skirt edge must sample the same HiRISE row and endpoint UVs as
  // the actual decimated DTM, even though its global UV occupies a tiny interval.
  const imageUv=rim.getAttribute('aBoundaryUv'),dtmUv=geometry.getAttribute('uv');
  const maxU=dtmUv.getX(dtmUv.count-1),maxV=dtmUv.getY(dtmUv.count-1);
  for(let k=0;k<96;k++){
    expect(imageUv.getX(k)).toBeCloseTo(maxU*k/96,6);
    expect(imageUv.getY(k)).toBeCloseTo(maxV,6);
  }
  const positions=rim.getAttribute('position'), point=new THREE.Vector3();
  for(let i=0;i<positions.count;i++) {
    point.fromBufferAttribute(positions,i);
    expect(Number.isFinite(point.length())).toBe(true);
    if(i<384) expect((point.length()-1)*dtm.datumRadius).toBeLessThan(-2000);
  }
  expect(sampleRenderedTerrain(geometry,bounds.latMax+0.001,bounds.lonMin)).toBeNull();
  geometry.dispose();rim.dispose();
});
