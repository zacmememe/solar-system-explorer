import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {marsAtmosphereState,installMarsFog} from '../src/rendering/MarsAtmosphere';
import {getUranusRingTexture,getNeptuneRingTexture} from '../src/rendering/RingMaterial';
import {generateRockPlacements} from '../src/surface/ProceduralRockField';
import {decodeImageMetadata} from '../scripts/verify-assets';
import manifest from '../sources/production-assets.json';

describe('surface realism contracts',()=>{
 it('night removes illumination, not the atmosphere; altitude thins it continuously',()=>{
   const day=marsAtmosphereState(1.7,.8,true),night=marsAtmosphereState(1.7,-.8,true);
   expect(day.density).toBeCloseTo(night.density,12);
   expect(day.brightness).toBeGreaterThan(.8); expect(night.brightness).toBe(0); expect(night.sunVisibility).toBe(0); expect(day.sunVisibility).toBe(1);
   expect(marsAtmosphereState(10800,.8,true).density).toBeCloseTo(Math.exp(-1));
   expect(marsAtmosphereState(100000,.8,true).density).toBeLessThan(.001);
   expect(marsAtmosphereState(0,.8,false).density).toBe(0);
   expect(marsAtmosphereState(-100,.8,true).density).toBe(1);
 });
 it('blue twilight is limited to horizon times, with finite values throughout a day',()=>{
   expect(marsAtmosphereState(0,0,true).twilight).toBe(1);
   expect(marsAtmosphereState(0,1,true).twilight).toBe(0);
   expect(marsAtmosphereState(0,-1,true).twilight).toBe(0);
   for(let h=-1;h<=1;h+=.01) for(const v of Object.values(marsAtmosphereState(0,h,true))) {
     expect(v).toBeGreaterThanOrEqual(0);expect(v).toBeLessThanOrEqual(1);
   }
 });
 it('terrain and sky share live linear air radiance even after light changes',()=>{
   const air=new THREE.Color(),mat=new THREE.MeshStandardMaterial();installMarsFog(mat,air);
   const shader={uniforms:{},vertexShader:'',fragmentShader:THREE.ShaderLib.standard.fragmentShader};
   mat.onBeforeCompile(shader as any,null as any);
   air.setRGB(.1,.2,.3);
   expect((shader.uniforms as any).marsAirColor.value).toBe(air);
   expect(shader.fragmentShader.indexOf('float dustFactor')).toBeLessThan(shader.fragmentShader.indexOf('#include <tonemapping_fragment>'));
   expect(shader.fragmentShader).not.toContain('#include <fog_fragment>');mat.dispose();
 });
 it('Mars rock sizes are mostly small debris rather than a population clamped at maximum',()=>{
   const rocks=generateRockPlacements({siteLat:18,siteLon:77,radiusM:450,count:5000,clearZoneM:3,sizeMinM:.04,sizeMaxM:2,maxSlopeDeg:19,slopeWeight:0,sampleHeight:()=>({heightM:0}),seed:7,datumRadiusM:3390000});
   const sizes=rocks.map(r=>Math.max(...r.scaleM)).sort((a,b)=>a-b);
   expect(sizes.length).toBe(5000);expect(sizes[Math.floor(sizes.length*.5)]).toBeLessThan(.15);
   expect(sizes[Math.floor(sizes.length*.95)]).toBeLessThan(.8);
   expect(sizes.at(-1)).toBeLessThan(2.6);
 });
 it('outer-planet rings remain narrow, dark and present at sub-texel widths',()=>{
   for(const tex of [getUranusRingTexture(),getNeptuneRingTexture()] as THREE.DataTexture[]){
     const data=tex.image.data as Uint8Array;let nonzero=0,total=0;
     for(let i=3;i<data.length;i+=4){if(data[i])nonzero++;total+=data[i]/255;}
     expect(nonzero).toBeGreaterThan(0);expect(nonzero/tex.image.width).toBeLessThan(.015);
     expect(total/tex.image.width).toBeLessThan(.005);expect(tex.colorSpace).toBe(THREE.SRGBColorSpace);tex.dispose();
   }
 });
 for(const id of ['io-usgs-galileo-1k','mimas-cassini-pia17214-4k','enceladus-cassini-pia18435-4k'])it(id+' bytes, dimensions and source match the catalog',()=>{
   const a=manifest.assets.find(a=>a.id===id)!;
   const bytes=readFileSync('public/'+a.localPath),meta=decodeImageMetadata(bytes);
   expect(createHash('sha256').update(bytes).digest('hex')).toBe(a.derivedSha256);
   expect(meta.width).toBe(a.derivedWidth);expect(meta.height).toBe(a.derivedHeight);
   expect(a.sourcePage).toMatch(/^https:/);expect(a.credit.length).toBeGreaterThan(10);
   expect(a.provenanceClass).not.toBe('raw-observation');
 });
});
