/**
 * 冰巨星外观：基于现有拼图、Minnaert 边缘变暗和教学补光。
 * 海王星降低旧图过强蓝色，参考 2024 Oxford 颜色重建；当前为经验色调近似，非光谱积分。
 */

import * as THREE from 'three';

export interface IceGiantMaterialUniforms {
  [key: string]: THREE.IUniform<any>;
  planetTexture: { value: THREE.Texture | null };
  sunDirection: { value: THREE.Vector3 };
  teachingLight: { value: number };
  isUranus: { value: number }; // 1.0 为天王星，0.0 为海王星
}

export function createIceGiantMaterial(
  planetTex: THREE.Texture,
  planetKind: 'uranus' | 'neptune'
): THREE.ShaderMaterial {
  const uniforms: IceGiantMaterialUniforms = {
    planetTexture: { value: planetTex },
    sunDirection: { value: new THREE.Vector3(1, 0, 0).normalize() },
    teachingLight: { value: 0.0 },
    isUranus: { value: planetKind === 'uranus' ? 1.0 : 0.0 },
  };

  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      void main() {
        vUv = uv;
        vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      #include <common>

      uniform sampler2D planetTexture;
      uniform vec3 sunDirection;
      uniform float teachingLight;
      uniform float isUranus;

      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      void main() {
        vec3 N = normalize(vNormal);
        vec3 L = normalize(sunDirection);
        vec3 V = normalize(cameraPosition - vWorldPosition);

        vec4 rawTex = texture2D(planetTexture, vUv);

        // 1. 几何光照与冰巨星气态厚重大气多重散射
        float NdotL = dot(N, L);
        float NdotV = max(dot(N, V), 0.0);
        float sunLit = max(NdotL, 0.0);

        // 气态多重散射与 Minnaert 边缘柔和变暗 (保持向阳面通透高亮)
        float limbDarkening = mix(0.68, 1.0, pow(clamp(NdotV, 0.0, 1.0), 0.28));
        float diffuseShading = (pow(sunLit, 0.85) * 0.82 + 0.18) * limbDarkening;

        // Existing processed maps are not calibrated reflectance. Remove the
        // brightness-as-geology classifier: linear sRGB put virtually all Neptune
        // pixels below its dark-spot threshold. Preserve map structure instead.
        float mapLuma = dot(rawTex.rgb,vec3(0.2126,0.7152,0.0722));
        vec3 paleNeptune = vec3(0.24,0.40,0.43) * clamp(mapLuma/0.14,0.5,1.35);
        // Approximate color balance informed by the 2024 reprocessing, not new data.
        vec3 surfaceColor = mix(mix(rawTex.rgb,paleNeptune,0.72),rawTex.rgb,isUranus);

        // 4. 柔和气态晨昏过渡 (Soft Atmosphere Terminator)
        float terminator = smoothstep(-0.06, 0.12, NdotL);

        // 5. 教学补光模式 (teachingLight)
        vec3 deepSpaceAmbient = mix(vec3(0.008, 0.012, 0.024), vec3(0.010, 0.018, 0.022), isUranus);
        vec3 teachingAmbient = surfaceColor * 0.42;
        vec3 ambientTerm = mix(deepSpaceAmbient, teachingAmbient, teachingLight);

        // 6. 高层甲烷大气冷光边缘微晕 (Cold Methane Rim Scattering)
        float rim = pow(1.0 - clamp(NdotV, 0.0, 1.0), 3.4);
        vec3 rimTint = mix(vec3(0.35, 0.65, 1.0), vec3(0.60, 0.92, 0.98), isUranus);
        vec3 rimGlow = rimTint * (rim * 0.06 * terminator);

        // 7. 综合最终物理色彩合成
        vec3 litColor = surfaceColor * diffuseShading;
        vec3 finalColor = litColor * terminator + ambientTerm * (1.0 - terminator * 0.82) + rimGlow;

        gl_FragColor = vec4(finalColor, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
