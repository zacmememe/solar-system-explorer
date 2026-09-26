import {expect,it} from 'vitest';
import * as THREE from 'three';
import {MarsRegionalMaterial} from '../src/rendering/MarsRegionalMaterial';
import {createMarsMaterial,MARS_ORBITAL_RADIANCE} from '../src/rendering/MarsMaterial';

it('boundary and outer regional material retain live fog/night lighting and the exact orbital response',()=>{
 const air=new THREE.Color(),sun={value:1},texture=new THREE.Texture();
 for(const boundary of [undefined,texture]){
  const mat=new MarsRegionalMaterial(air,sun,1e-7,boundary ? {texture:boundary,spanM:new THREE.Vector2(4000,6000)} : undefined);
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
  mat.onBeforeCompile(shader as any,null as any);
  expect((shader.uniforms as any).marsAirColor.value).toBe(air);
  expect((shader.uniforms as any).marsSunVisibility).toBe(sun);
  expect((shader.uniforms as any).sunDirection).toBe(mat.uniforms.sunDirection);
  expect(shader.fragmentShader).toContain(MARS_ORBITAL_RADIANCE);
  expect(shader.fragmentShader.indexOf('float dustFactor')).toBeLessThan(shader.fragmentShader.indexOf('#include <tonemapping_fragment>'));
  expect(shader.fragmentShader).not.toContain('#include <fog_fragment>');
  if(boundary)expect((shader.uniforms as any).boundaryTexture.value).toBe(texture);
  mat.dispose();
 }
 const orbital=createMarsMaterial(null);expect(orbital.fragmentShader).toContain(MARS_ORBITAL_RADIANCE);orbital.dispose();texture.dispose();
});
