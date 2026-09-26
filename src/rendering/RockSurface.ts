import * as THREE from 'three';

/** Subtle illustrative weathering only: no displacement, invented shadows or
 * claimed measured rock texture. Object-local metres keep it stable on rotation. */
export function installRockSurface(material: THREE.MeshStandardMaterial, metersToLocal: number): void {
 const previous=material.onBeforeCompile,previousKey=material.customProgramCacheKey.bind(material);
 const baseKey=previousKey();
 material.onBeforeCompile=(shader,renderer)=>{
  previous(shader,renderer);
  shader.uniforms.rockMetric={value:metersToLocal};
  shader.vertexShader=`uniform float rockMetric; varying vec3 rockMeters; varying float rockWorldMetric;\n`+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
    rockMeters=position*vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz))/rockMetric;
    rockWorldMetric=rockMetric*length(modelMatrix[0].xyz);`);
  shader.fragmentShader=`varying vec3 rockMeters; varying float rockWorldMetric;
    float rockHash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
    float rockNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
      return mix(mix(mix(rockHash(i),rockHash(i+vec3(1,0,0)),f.x),mix(rockHash(i+vec3(0,1,0)),rockHash(i+vec3(1,1,0)),f.x),f.y),
        mix(mix(rockHash(i+vec3(0,0,1)),rockHash(i+vec3(1,0,1)),f.x),mix(rockHash(i+vec3(0,1,1)),rockHash(i+vec3(1,1,1)),f.x),f.y),f.z)-0.5;
    }\n`+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
    float rockFootprint=max(length(dFdx(rockMeters)),length(dFdy(rockMeters)));
    float rockFine=rockNoise(rockMeters/0.018),rockBroad=rockNoise(rockMeters/0.11);
    float rockFineWeight=1.0-smoothstep(0.005,0.025,rockFootprint);
    float rockBroadWeight=1.0-smoothstep(0.04,0.14,rockFootprint);
    diffuseColor.rgb*=1.0+rockFine*rockFineWeight*0.08+rockBroad*rockBroadWeight*0.10;`);
  shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
    float rockDx=dFdx(rockFine)*0.00025*rockFineWeight*rockWorldMetric;
    float rockDy=dFdy(rockFine)*0.00025*rockFineWeight*rockWorldMetric;
    vec3 rockX=dFdx(-vViewPosition),rockY=dFdy(-vViewPosition);
    vec3 rockR1=cross(rockY,normal),rockR2=cross(normal,rockX);
    float rockDet=dot(rockX,rockR1);
    vec3 rockGrad=sign(rockDet)*(rockDx*rockR1+rockDy*rockR2)/max(abs(rockDet),1e-30);
    rockGrad*=min(1.0,0.055/max(length(rockGrad),0.000001));
    normal=normalize(normal-rockGrad);`);
 };
 material.customProgramCacheKey=()=>baseKey+'-rock-weathering-v1';
}
