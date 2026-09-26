import * as THREE from 'three';
import {installMarsFog, MARS_REGOLITH_TINT} from './MarsAtmosphere';
import {MARS_ORBITAL_RADIANCE} from './MarsMaterial';

/** Local ground uses the same direct/ambient light as HiRISE. Beyond the regional
 * view, continuously return to the globe's display model, without a material swap.
 * The boundary image extension is explicitly a transition, not new observations. */
export class MarsRegionalMaterial extends THREE.MeshStandardMaterial {
  readonly uniforms: {
    sunDirection: THREE.IUniform<THREE.Vector3>;
    teachingLight: THREE.IUniform<number>;
  };

  constructor(air: THREE.Color, sunVisibility: THREE.IUniform<number>, metersToLocal: number,
    boundary?: {texture: THREE.Texture; spanM: THREE.Vector2}) {
    super({roughness:0.95,metalness:0.02});
    this.uniforms = {sunDirection:{value:new THREE.Vector3(1,0,0)},teachingLight:{value:0}};
    installMarsFog(this,air,undefined,sunVisibility);
    const fogCompile = this.onBeforeCompile;
    this.onBeforeCompile = (shader,renderer) => {
      fogCompile(shader,renderer);
      Object.assign(shader.uniforms,this.uniforms,{
        regionalMetric:{value:metersToLocal}, regolithTint:{value:MARS_REGOLITH_TINT},
        ...(boundary ? {boundaryTexture:{value:boundary.texture},boundarySpanM:{value:boundary.spanM}} : {}),
      });
      shader.vertexShader = `varying vec2 regionalUv; varying vec3 regionalNormal;
        varying float regionalScale; uniform float regionalMetric;
        ${boundary ? 'attribute float aGrayMix; varying float boundaryMix; attribute vec2 aBoundaryUv; varying vec2 boundaryUv;' : ''}\n`+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        regionalUv=uv; regionalNormal=normalize(mat3(modelMatrix)*normal);
        regionalScale=regionalMetric*length(modelMatrix[0].xyz);
        ${boundary ? 'boundaryMix=aGrayMix; boundaryUv=aBoundaryUv;' : ''}`);
      shader.fragmentShader = `uniform vec3 sunDirection,regolithTint; uniform float teachingLight;
        varying vec2 regionalUv; varying vec3 regionalNormal; varying float regionalScale;
        ${boundary ? 'uniform sampler2D boundaryTexture; uniform vec2 boundarySpanM; varying vec2 boundaryUv; varying float boundaryMix;' : ''}
        ${MARS_ORBITAL_RADIANCE}\n`+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        vec3 regionalGlobalColor=diffuseColor.rgb;
        // Linear-light grayscale recoloring is illustrative, not true-color HiRISE.
        vec3 regionalGroundColor=vec3(dot(regionalGlobalColor,vec3(0.2126,0.7152,0.0722)))*regolithTint;
        ${boundary ? `
          // Local HiRISE UV was calculated on CPU in double precision.
          vec2 edgeUv=clamp(boundaryUv,vec2(0),vec2(1));
          vec2 imageSize=vec2(textureSize(boundaryTexture,0));
          float extensionM=length((boundaryUv-edgeUv)*boundarySpanM);
          vec2 pixelsPerMeter=imageSize/boundarySpanM;
          float footprint=max(length(dFdx(boundaryUv)*imageSize),length(dFdy(boundaryUv)*imageSize));
          // Never extrude a sharp image row into kilometre-long stripes. Low-pass
          // increases with distance outside measured coverage, retaining its edge.
          float edgeLod=log2(max(1.0,max(footprint,extensionM*0.5*max(pixelsPerMeter.x,pixelsPerMeter.y))));
          vec3 edgeColor=textureLod(boundaryTexture,edgeUv,edgeLod).rgb*regolithTint;
          regionalGroundColor=mix(edgeColor,regionalGroundColor,smoothstep(0.0,2500.0,extensionM));
        ` : ''}
        diffuseColor.rgb=regionalGroundColor;
      `);
      shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>', `
        // Fragment distance avoids global state or camera ownership changes. This
        // display transition is 40–160 km, outside nearby terrain observation.
        float regionalFar=smoothstep(40000.0,160000.0,length(vViewPosition)/regionalScale);
        vec3 regionalView=inverseTransformDirection(normalize(vViewPosition),viewMatrix);
        vec3 orbitalColor=marsOrbitalRadiance(regionalGlobalColor,regionalUv,
          normalize(regionalNormal),normalize(sunDirection),regionalView,teachingLight,marsSunVisibility);
        outgoingLight=mix(outgoingLight,orbitalColor,regionalFar);
        #include <opaque_fragment>`);
    };
    this.customProgramCacheKey=()=>`mars-regional-linear-v1-${boundary ? 'boundary' : 'global'}`;
  }
}
