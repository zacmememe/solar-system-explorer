import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {orthoP995} from '../src/surface/orthoNormalizer';
import {RasterTerrainSource} from '../src/surface/RasterTerrainSource';

it('retains the existing zero fallback, extrema and rank rounding',()=>{
 for(const values of [[],[0],[65535],Array(100).fill(0),Array.from({length:200},(_,i)=>i),Array.from({length:201},(_,i)=>i),Array.from({length:1300},(_,i)=>(i*41773)%65536)]){
   const data=Uint16Array.from(values),sorted=[...data].sort((a,b)=>a-b);
   expect(orthoP995(data)).toBe(sorted[Math.floor((data.length-1)*.995)]||4096);
 }
});
it('preserves the full real Apollo17 RGBA texture byte for byte',()=>{
 const root='public/data/dem/apollo17-v1/',meta=JSON.parse(readFileSync(root+'metadata.json','utf8'));
 const bytes=readFileSync(root+'ortho.u16'),orthoU16=new Uint16Array(bytes.buffer,bytes.byteOffset,bytes.length/2);
 const source=new RasterTerrainSource();Object.assign(source,{meta,orthoU16,validMask:new Uint8Array(readFileSync(root+'valid.u8'))});
 const tex=source.buildOrthoTexture()!;
 expect(tex.userData.normalizerDenominator).toBe(834/255);
 expect(createHash('sha256').update(tex.image.data as Uint8Array).digest('hex')).toBe('875082e5516ec68189b7bf0cb7666bf669589fa4d85922812890b08aceaadced');
 tex.dispose();
});
it('keeps masked high samples in the statistic but black in the displayed texture',()=>{
 const data=Uint16Array.from([...Array(198).fill(10),60000,60000]),mask=new Uint8Array(200).fill(1);mask[198]=mask[199]=0;
 const source=new RasterTerrainSource();Object.assign(source,{meta:{width:200,height:1},orthoU16:data,validMask:mask});
 const tex=source.buildOrthoTexture()!;
 expect(tex.userData.normalizerDenominator).toBe(60000/255);
 expect([...tex.image.data.slice(198*4,199*4)]).toEqual([0,0,0,255]);tex.dispose();
});
