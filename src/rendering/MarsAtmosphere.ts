import * as THREE from 'three';

/** Dusty, clear-weather display approximation, not calibrated radiative transfer.
 * NASA/JPL PIA19400: blue twilight is localized around the Sun. Density and
 * illumination are separate: a dark atmosphere still extinguishes distant light.
 */
export function marsAtmosphereState(altitudeM: number, sunHeight: number, enabled: boolean) {
  const density = enabled ? Math.exp(-Math.max(0, altitudeM) / 10800) : 0;
  const daylight = THREE.MathUtils.smoothstep(sunHeight, -0.16, 0.12);
  const twilight = (1 - THREE.MathUtils.smoothstep(sunHeight, 0.03, 0.32))
    * THREE.MathUtils.smoothstep(sunHeight, -0.18, -0.04);
  const brightness = daylight * (0.22 + 0.78 * Math.sqrt(Math.max(0, sunHeight)));
  const sunVisibility = THREE.MathUtils.smoothstep(sunHeight, -0.005, 0.005);
  return {density, daylight, twilight, brightness, sunVisibility};
}

export function createObservationSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      starMap: {value: null}, hasStarMap: {value: 0},
      dustDensity: {value: 0}, daylight: {value: 1}, twilight: {value: 0}, skyBrightness: {value: 1},
      localUp: {value: new THREE.Vector3(0,1,0)}, sunDirection: {value: new THREE.Vector3(1,0,0)},
      zenithColor: {value: new THREE.Color('#937b6b')}, horizonColor: {value: new THREE.Color('#c9aa88')},
    },
    vertexShader: `varying vec2 vUv; varying vec3 vRay;
      void main(){vUv=uv; vRay=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `
      uniform sampler2D starMap; uniform float hasStarMap;
      uniform float dustDensity, daylight, twilight, skyBrightness;
      uniform vec3 localUp, sunDirection, zenithColor, horizonColor;
      varying vec2 vUv; varying vec3 vRay;
      void main(){
        vec3 ray=normalize(vRay);
        float elevation=dot(ray,localUp);
        // Grazing rays traverse more dust; bounded to stay finite at the horizon.
        float airMass=1.0/sqrt(max(elevation,0.0)*max(elevation,0.0)+0.025);
        float extinction=1.0-exp(-dustDensity*airMass*0.8);
        float horizon=exp(-max(elevation,0.0)*3.5);
        float solarCos=max(dot(ray,sunDirection),0.0);
        float forward=pow(solarCos,18.0);
        vec3 sky=mix(zenithColor,horizonColor,horizon);
        sky*=skyBrightness*(0.82+0.18*forward);
        // Empirical wavelength-dependent dust phase approximation, not a blue dome.
        sky=mix(sky,vec3(0.18,0.28,0.40)*skyBrightness,twilight*pow(solarCos,36.0)*0.8);
        vec3 stars=hasStarMap>0.5?texture2D(starMap,vUv).rgb:vec3(0.001);
        float visibility=exp(-dustDensity*airMass*0.65)*(1.0-dustDensity*daylight);
        visibility*=1.0-dustDensity*smoothstep(0.005,0.12,skyBrightness);
        gl_FragColor=vec4(stars*clamp(visibility,0.0,1.0)+sky*extinction,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** Preserve the measured grayscale image; color is an explicitly illustrative
 * regolith tint. The shader adds no invented topography or sharpening. */
export const MARS_REGOLITH_TINT = new THREE.Color('#b79b80');

/** Three's stock fog mixes after output conversion. Atmosphere radiance must
 * instead share the sky's linear-light exposure/tone-mapping path. */
export const MARS_FOG_FRAGMENT = `
  #ifdef USE_FOG
    float dustFactor = smoothstep(fogNear, fogFar, vFogDepth);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, marsAirColor, dustFactor);
  #endif
`;

export function installMarsFog(material: THREE.MeshStandardMaterial, color: THREE.Color, regolith?: {spanM: THREE.Vector2; metersToLocal: number}, sunVisibility: THREE.IUniform<number> = {value:1}): void {
  material.onBeforeCompile = shader => {
    if (regolith) {
      shader.uniforms.grainSpanM = {value:regolith.spanM};
      shader.uniforms.grainMetricScale = {value:regolith.metersToLocal};
      shader.vertexShader = 'uniform vec2 grainSpanM; uniform float grainMetricScale; varying vec2 vGrainM; varying float vGrainScale;\n'+shader.vertexShader
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvGrainM=uv*grainSpanM; vGrainScale=grainMetricScale*length(modelMatrix[0].xyz);');
      shader.fragmentShader = GRAIN_FUNCTIONS + shader.fragmentShader
        .replace('#include <map_fragment>', '#include <map_fragment>\n'+GRAIN_COLOR)
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n'+GRAIN_NORMAL);
    }
    shader.uniforms.marsAirColor = {value: color};
    shader.uniforms.marsSunVisibility = sunVisibility;
    shader.fragmentShader = 'uniform float marsSunVisibility;\n'+shader.fragmentShader
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directDiffuse*=marsSunVisibility; reflectedLight.directSpecular*=marsSunVisibility;');
    shader.fragmentShader = 'uniform vec3 marsAirColor;\n' + shader.fragmentShader
      .replace('#include <fog_fragment>', '')
      .replace('#include <tonemapping_fragment>', MARS_FOG_FRAGMENT+'\n#include <tonemapping_fragment>');
  };
  material.customProgramCacheKey = () => regolith ? 'mars-grain-linear-fog-v1' : 'mars-linear-fog-v1';
}


// Illustrative sub-image-scale sand: fixed to the measured station UV grid.
// No displacement or invented terrain. Derivatives and distance suppress shimmer.
const GRAIN_FUNCTIONS = `
  varying vec2 vGrainM; varying float vGrainScale;
  float grainHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float grainNoise(vec2 p){
    vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    float n=mix(mix(grainHash(i),grainHash(i+vec2(1,0)),f.x),
      mix(grainHash(i+vec2(0,1)),grainHash(i+vec2(1,1)),f.x),f.y);
    return n-0.5;
  }
`;
const GRAIN_COLOR = `
  float grainFade=1.0-smoothstep(15.0,40.0,length(vViewPosition)/vGrainScale);
  float grainFine=grainNoise(vGrainM/0.05);
  float grainCoarse=grainNoise(vGrainM/0.19);
  vec2 footprint=fwidth(vGrainM);
  float grainFineWeight=1.0-smoothstep(0.3,1.0,max(footprint.x,footprint.y)/0.05);
  float grainCoarseWeight=1.0-smoothstep(0.3,1.0,max(footprint.x,footprint.y)/0.19);
  diffuseColor.rgb*=1.0+(grainFine*grainFineWeight*0.05+grainCoarse*grainCoarseWeight*0.03)*grainFade;
`;
const GRAIN_NORMAL = `
  // Differentiate raw noise, then filter the first derivatives. Never differentiate fwidth.
  float grainDx=(dFdx(grainFine)*0.0002*grainFineWeight+dFdx(grainCoarse)*0.0003*grainCoarseWeight)*vGrainScale*grainFade;
  float grainDy=(dFdy(grainFine)*0.0002*grainFineWeight+dFdy(grainCoarse)*0.0003*grainCoarseWeight)*vGrainScale*grainFade;
  vec3 grainX=dFdx(-vViewPosition), grainY=dFdy(-vViewPosition);
  vec3 grainR1=cross(grainY,normal),grainR2=cross(normal,grainX);
  float grainDet=dot(grainX,grainR1);
  vec3 gradient=sign(grainDet)*(grainDx*grainR1+grainDy*grainR2)/max(abs(grainDet),1e-30);
  gradient*=min(1.0,0.035/max(length(gradient),0.000001));
  normal=normalize(normal-gradient);
`;
