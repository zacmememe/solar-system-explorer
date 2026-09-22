/**
 * 金星专属双层着色材质管线 (VenusMaterial)
 * 1. createVenusAtmosphereMaterial:
 *    - 浓厚二氧化碳与硫酸气溶胶多重米氏散射模型 (高几何反照率 Albedo 0.77)；
 *    - 晨昏高密度高层大气折射透射微光弧 (Atmospheric Twilight Refraction Arc)；
 *    - 紫外波段超自转弱云系对比度强化；
 *    - 教学提亮支持 (teachingLight)；
 * 2. createVenusRadarMaterial:
 *    - 麦哲伦号合成孔径微波雷达 (SAR) 粗糙火山熔岩与玄武岩平原质感着色。
 */

import * as THREE from 'three';

export interface VenusAtmosphereUniforms {
  [key: string]: THREE.IUniform<any>;
  atmosphereTexture: { value: THREE.Texture | null };
  sunDirection: { value: THREE.Vector3 };
  teachingLight: { value: number };
}

export interface VenusRadarUniforms {
  [key: string]: THREE.IUniform<any>;
  radarTexture: { value: THREE.Texture | null };
  sunDirection: { value: THREE.Vector3 };
  teachingLight: { value: number };
}

/**
 * 金星浓厚硫酸云层多重散射专属 Shader 材质
 */
export function createVenusAtmosphereMaterial(atmTex: THREE.Texture): THREE.ShaderMaterial {
  const uniforms: VenusAtmosphereUniforms = {
    atmosphereTexture: { value: atmTex },
    sunDirection: { value: new THREE.Vector3(1, 0, 0).normalize() },
    teachingLight: { value: 0.0 },
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
      uniform sampler2D atmosphereTexture;
      uniform vec3 sunDirection;
      uniform float teachingLight;

      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      void main() {
        vec3 N = normalize(vNormal);
        vec3 L = normalize(sunDirection);
        vec3 V = normalize(cameraPosition - vWorldPosition);

        vec4 texColor = texture2D(atmosphereTexture, vUv);

        // 1. 几何夹角
        float NdotL = dot(N, L);
        float NdotV = max(dot(N, V), 0.0);
        float sunLit = max(NdotL, 0.0);

        // 2. 浓厚硫酸气溶胶多重散射 (High Albedo Mie Multiple Scattering)
        // 金星反照率高达 0.77，昼面由于深厚气溶胶多次散射，呈现均匀明亮且柔和的奶油金光泽
        // 消除单一朗伯死黑，在斜射角依然具有较强的前向与侧向弥散反光
        float multipleScatter = pow(sunLit, 0.65) * 0.75 + sunLit * 0.25;
        float limbSoftening = mix(0.65, 1.0, pow(NdotV, 0.25));
        float cloudLuminance = multipleScatter * limbSoftening;

        // 3. 微弱紫外波段超自转云纹微对比增强
        // 金星可见光几乎无特征，适当凸显紫外吸收体形成的微妙流动暗条纹
        vec3 baseGold = texColor.rgb;
        float cloudPattern = dot(baseGold, vec3(0.333));
        vec3 enhancedCloud = mix(baseGold, baseGold * (0.85 + 0.30 * cloudPattern), 0.40);

        // 4. 厚重大气晨昏折射光弧 (Twilight Refraction Arc)
        // 92 个大气压极厚气体在晨昏交界侧产生前向深金色透射光
        float forwardAngle = max(dot(L, -V), 0.0);
        float twilightBand = smoothstep(-0.20, 0.10, NdotL) * smoothstep(0.20, -0.10, NdotL);
        float arcIntensity = pow(forwardAngle, 2.8) * twilightBand * 0.45;
        vec3 twilightArc = vec3(1.0, 0.82, 0.48) * arcIntensity;

        // 5. 昼夜合成与暗部处理
        float dayFactor = smoothstep(-0.10, 0.15, NdotL);
        vec3 litColor = enhancedCloud * cloudLuminance;

        // 6. 教学提亮 (teachingLight)
        vec3 deepSpaceAmbient = vec3(0.015, 0.016, 0.020);
        vec3 teachingAmbient = enhancedCloud * 0.38;
        vec3 ambientTerm = mix(deepSpaceAmbient, teachingAmbient, teachingLight);

        // 7. 高层边缘金色薄雾光晕 (High-Altitude Golden Haze Rim)
        float rim = pow(1.0 - NdotV, 3.0);
        vec3 rimGlow = vec3(1.0, 0.90, 0.65) * rim * 0.22 * smoothstep(-0.10, 0.20, NdotL);

        vec3 finalColor = litColor * dayFactor + ambientTerm * (1.0 - dayFactor * 0.85) + twilightArc + rimGlow;

        gl_FragColor = vec4(finalColor, 1.0);
      }
    `,
  });
}

/**
 * 金星麦哲伦微波雷达穿透地表专属 Shader 材质
 */
export function createVenusRadarMaterial(radarTex: THREE.Texture): THREE.ShaderMaterial {
  const uniforms: VenusRadarUniforms = {
    radarTexture: { value: radarTex },
    sunDirection: { value: new THREE.Vector3(1, 0, 0).normalize() },
    teachingLight: { value: 0.0 },
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
      uniform sampler2D radarTexture;
      uniform vec3 sunDirection;
      uniform float teachingLight;

      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      void main() {
        vec3 N = normalize(vNormal);
        vec3 L = normalize(sunDirection);
        vec3 V = normalize(cameraPosition - vWorldPosition);

        vec4 texColor = texture2D(radarTexture, vUv);

        float NdotL = dot(N, L);
        float NdotV = max(dot(N, V), 0.0);
        float sunLit = max(NdotL, 0.0);

        // 麦哲伦微波雷达地貌粗糙度后向散射
        float radarRoughness = sunLit / max(sunLit + NdotV, 0.001);
        float basaltDiffuse = mix(sunLit, radarRoughness * 1.5, 0.35);

        // 强化雷达地貌对比：粗糙火山熔岩高亮明晰，平原幽深
        vec3 radarColor = texColor.rgb;
        float dayFactor = smoothstep(-0.06, 0.12, NdotL);
        vec3 litColor = radarColor * basaltDiffuse;

        // 教学补光支持
        vec3 deepSpaceAmbient = vec3(0.012, 0.014, 0.020);
        vec3 teachingAmbient = radarColor * 0.40;
        vec3 ambientTerm = mix(deepSpaceAmbient, teachingAmbient, teachingLight);

        vec3 finalColor = litColor * dayFactor + ambientTerm * (1.0 - dayFactor * 0.85);

        gl_FragColor = vec4(finalColor, 1.0);
      }
    `,
  });
}
