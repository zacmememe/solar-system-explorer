/**
 * 地球多层次着色渲染管线
 * 遵循 01-REBUILD-PLAN.zh-CN.md：
 * 1. 昼夜平滑过渡（晨昏线）；
 * 2. 真实夜间城市灯光（夜间发光）；
 * 3. 真实边缘大气散射（Fresnel Rim）；
 * 4. 教学提亮支持（给家长孩子看清背面大陆，明确区分真实与教学）；
 * 5. 独立自旋云层材质。
 */

import * as THREE from 'three';

export interface EarthMaterialUniforms {
  [key: string]: THREE.IUniform<any>;
  dayTexture: { value: THREE.Texture | null };
  nightTexture: { value: THREE.Texture | null };
  sunDirection: { value: THREE.Vector3 };
  teachingLight: { value: number }; // 0 = 真实光照, 1 = 教学提亮
}

/**
 * 地表昼夜混合着色器材质
 */
export function createEarthSurfaceMaterial(
  dayTex: THREE.Texture,
  nightTex: THREE.Texture
): THREE.ShaderMaterial {
  const uniforms: EarthMaterialUniforms = {
    dayTexture: { value: dayTex },
    nightTexture: { value: nightTex },
    sunDirection: { value: new THREE.Vector3(500, 50, 300).normalize() },
    teachingLight: { value: 0.0 },
    observationMode: { value: 0.0 },
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

      uniform sampler2D dayTexture;
      uniform sampler2D nightTexture;
      uniform vec3 sunDirection;
      uniform float teachingLight;
      uniform float observationMode;

      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      void main() {
        vec3 dayColor = texture2D(dayTexture, vUv).rgb;
        vec3 nightLights = texture2D(nightTexture, vUv).rgb * vec3(1.3, 1.1, 0.85); // 温暖的城市灯光色温

        // 表面法线与太阳方向的夹角余弦 (世界坐标空间)
        vec3 normSunDir = normalize(sunDirection);
        float dotNL = dot(vNormal, normSunDir);

        // 晨昏线平滑过渡区间 (-0.15 到 0.20)
        float dayFactor = smoothstep(-0.15, 0.20, dotNL);

        // 昼面漫反射（考虑微弱环境光）
        float diffuse = max(dotNL, 0.0);
        vec3 litDayColor = dayColor * (diffuse * 0.95 + 0.05);

        // 夜面城市灯光淡入 (仅在暗部发光)
        float nightFactor = 1.0 - smoothstep(-0.18, 0.12, dotNL);
        vec3 litNightColor = nightLights * nightFactor;

        // 教学提亮：如果开启，在夜面混入适度白昼地形轮廓，供孩子辨识大陆
        vec3 teachingBase = dayColor * 0.18 * (1.0 - dayFactor) * teachingLight;

        // 大气边缘散射微光（Fresnel Rim）
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 3.5);
        float sunAtmosphere = max(dot(normSunDir, vNormal), 0.0) * 0.7 + max(dot(normSunDir, viewDir), 0.0) * 0.3;
        vec3 atmosphereRim = vec3(0.3, 0.6, 1.0) * fresnel * (sunAtmosphere * 0.8 + 0.15);

        vec3 finalColor = mix(litNightColor + teachingBase, litDayColor, dayFactor);
        finalColor += atmosphereRim * dayFactor; // 大气散射主要在被光照侧显现
        if (observationMode > 0.5) {
          vec3 referenceDirection = normalize(vec3(0.4, 0.8, 0.5));
          finalColor = dayColor * (max(dot(vNormal, referenceDirection), 0.0) * 0.35 + 0.65);
        }

        gl_FragColor = vec4(finalColor, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * 独立云层材质（支持受太阳照射明暗与透明度混合）
 */
export function createEarthCloudMaterial(cloudTex: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      cloudTexture: { value: cloudTex },
      sunDirection: { value: new THREE.Vector3(500, 50, 300).normalize() },
      opacity: { value: 0.85 },
    },
    transparent: true,
    depthWrite: false,
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;

      void main() {
        vUv = uv;
        vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      #include <common>

      uniform sampler2D cloudTexture;
      uniform vec3 sunDirection;
      uniform float opacity;

      varying vec2 vUv;
      varying vec3 vNormal;

      void main() {
        vec4 cloudColor = texture2D(cloudTexture, vUv);
        // SSS 云层图为灰度图：亮度即云层密度 (RGB 相同)
        float cloudDensity = (cloudColor.r + cloudColor.g + cloudColor.b) / 3.0;

        if (cloudDensity < 0.05) {
          discard;
        }

        vec3 normSunDir = normalize(sunDirection);
        float dotNL = dot(vNormal, normSunDir);
        float diffuse = max(dotNL, 0.0);

        // 昼面白云明亮，夜面云层变暗
        vec3 litCloud = vec3(0.95, 0.98, 1.0) * (diffuse * 0.92 + 0.08);

        gl_FragColor = vec4(litCloud, cloudDensity * opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * 大气外层光晕光环材质 (Atmospheric Halo)
 * 支持不同行星根据其真实大气成分与散射谱线定制
 */
export function createAtmosphereHaloMaterial(
  color: number | THREE.Color = 0x38bdf8,
  power: number = 2.8,
  maxOpacity: number = 0.75
): THREE.ShaderMaterial {
  const glowCol = color instanceof THREE.Color ? color : new THREE.Color(color);

  return new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: glowCol },
      sunDirection: { value: new THREE.Vector3(500, 50, 300).normalize() },
      power: { value: power },
      maxOpacity: { value: maxOpacity },
    },
    vertexShader: `
      varying vec3 vViewNormal;
      varying vec3 vWorldNormal;

      void main() {
        vViewNormal = normalize(normalMatrix * normal);
        vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      #include <common>

      uniform vec3 glowColor;
      uniform vec3 sunDirection;
      uniform float power;
      uniform float maxOpacity;

      varying vec3 vViewNormal;
      varying vec3 vWorldNormal;

      void main() {
        // 菲涅尔边缘探测 (视线空间)
        float intensity = pow(max(0.72 - dot(vViewNormal, vec3(0.0, 0.0, 1.0)), 0.0), power);
        if (intensity <= 0.0) discard;

        // 向日面光晕较强，背日面减弱但保持微弱深空漫射 (世界空间太阳照射角)
        float sunFactor = max(dot(vWorldNormal, normalize(sunDirection)), 0.0) * 0.75 + 0.25;

        gl_FragColor = vec4(glowColor * sunFactor, intensity * maxOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
}
