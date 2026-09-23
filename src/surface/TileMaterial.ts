/**
 * 地表瓦片专用着色器材质 (TileMaterial)
 * 集成：
 * 1. 瓦片昼夜晨昏光照与漫反射；
 * 2. 多级瓦片切换平滑淡入 (fadeAlpha 0.0~1.0)；
 * 3. 统一 ACES Filmic + sRGB 色彩管线输出 chunks；
 * 4. 教学提亮支持。
 */

import * as THREE from 'three';

export interface TileMaterialOptions {
  dayTexture: THREE.Texture;
  coarseTexture?: THREE.Texture | null;
  nightTexture?: THREE.Texture | null;
  tileGlobalUvOffset?: THREE.Vector2;
  tileGlobalUvScale?: THREE.Vector2;
  observationMode?: number;
  ancestorUvOffset?: THREE.Vector2;
  ancestorUvScale?: THREE.Vector2;
  sunDirection?: THREE.Vector3;
  teachingLight?: number;
  imageMix?: number;
  hasFineTexture?: number;
  initialAlpha?: number;
}

export function createTileShaderMaterial(options: TileMaterialOptions): THREE.ShaderMaterial {
  const {
    dayTexture,
    coarseTexture,
    nightTexture = null,
    tileGlobalUvOffset = new THREE.Vector2(0, 0),
    tileGlobalUvScale = new THREE.Vector2(1, 1),
    observationMode = 0.0,
    ancestorUvOffset = new THREE.Vector2(0, 0),
    ancestorUvScale = new THREE.Vector2(1, 1),
    sunDirection = new THREE.Vector3(500, 50, 300).normalize(),
    teachingLight = 0.0,
    imageMix = 1.0,
    hasFineTexture = 1.0,
    initialAlpha = 1.0,
  } = options;

  const coarseTex = coarseTexture || dayTexture;

  dayTexture.wrapS = THREE.ClampToEdgeWrapping;
  dayTexture.wrapT = THREE.ClampToEdgeWrapping;
  coarseTex.wrapS = THREE.ClampToEdgeWrapping;
  coarseTex.wrapT = THREE.ClampToEdgeWrapping;

  // 默认黑色空纹理用于未加载夜景时的安全备用
  const dummyNightTex = nightTexture || dayTexture;

  return new THREE.ShaderMaterial({
    uniforms: {
      dayTexture: { value: dayTexture },
      coarseTexture: { value: coarseTex },
      nightTexture: { value: dummyNightTex },
      hasNightTexture: { value: nightTexture ? 1.0 : 0.0 },
      tileGlobalUvOffset: { value: tileGlobalUvOffset.clone() },
      tileGlobalUvScale: { value: tileGlobalUvScale.clone() },
      observationMode: { value: observationMode },
      ancestorUvOffset: { value: ancestorUvOffset.clone() },
      ancestorUvScale: { value: ancestorUvScale.clone() },
      imageMix: { value: imageMix },
      hasFineTexture: { value: hasFineTexture },
      sunDirection: { value: sunDirection.clone() },
      teachingLight: { value: teachingLight },
      fadeAlpha: { value: initialAlpha }, // 向后兼容
    },
    side: THREE.FrontSide,
    transparent: false,
    depthWrite: true,
    depthTest: true,
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
      uniform sampler2D coarseTexture;
      uniform sampler2D nightTexture;
      uniform float hasNightTexture;
      uniform vec2 tileGlobalUvOffset;
      uniform vec2 tileGlobalUvScale;
      uniform float observationMode;
      uniform vec2 ancestorUvOffset;
      uniform vec2 ancestorUvScale;
      uniform float imageMix;
      uniform float hasFineTexture;
      uniform vec3 sunDirection;
      uniform float teachingLight;
      uniform float fadeAlpha;

      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      void main() {
        // 采样祖先低清与自有高清日照纹理
        vec2 coarseUv = ancestorUvOffset + vUv * ancestorUvScale;
        vec4 coarseColor = texture2D(coarseTexture, coarseUv);
        vec4 fineColor = texture2D(dayTexture, vUv);

        vec3 dayColor;
        if (hasFineTexture > 0.5) {
          dayColor = mix(coarseColor.rgb, fineColor.rgb, clamp(imageMix, 0.0, 1.0));
        } else {
          dayColor = coarseColor.rgb;
        }

        // 1. 全球城市夜灯真实采样 (由瓦片经纬度边界线性映射到全球 0..1 UV，P0 核心修复)
        vec2 globalUv = tileGlobalUvOffset + vUv * tileGlobalUvScale;
        globalUv.x = fract(globalUv.x);
        globalUv.y = clamp(globalUv.y, 0.0, 1.0);
        vec3 nightLights = hasNightTexture > 0.5 ? texture2D(nightTexture, globalUv).rgb : vec3(0.0);

        // 2. 世界空间太阳光照与晨昏线计算
        vec3 normSunDir = normalize(sunDirection);
        float dotNL = dot(vNormal, normSunDir);

        // 晨昏线平滑过渡
        float dayFactor = smoothstep(-0.15, 0.20, dotNL);

        // 昼面漫反射
        float diffuse = max(dotNL, 0.0);
        vec3 litDayColor = dayColor * (diffuse * 0.95 + 0.05);

        // 夜面真实光照：微弱太空环境底色 + 城市璀璨夜光独立自发光 (夜灯不被漫反射阴影乘成死黑！)
        vec3 cityGlow = nightLights * vec3(2.5, 2.1, 1.6);
        vec3 litNightColor = dayColor * (0.04 + 0.25 * teachingLight) + cityGlow;

        vec3 finalColor = mix(litNightColor, litDayColor, dayFactor);

        // 3. 地貌观察模式 (observationMode > 0.5)：开启全向参考照明，时间保持不变
        if (observationMode > 0.5) {
          vec3 refLightDir = normalize(vec3(0.4, 0.8, 0.5));
          float refDiffuse = max(dot(vNormal, refLightDir), 0.0) * 0.35 + 0.65;
          finalColor = dayColor * refDiffuse;
        } else {
          // 物理模式下添加大气边缘散射微光 (Fresnel Rim)
          vec3 viewDir = normalize(cameraPosition - vWorldPosition);
          float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 3.5);
          vec3 atmosphereRim = vec3(0.25, 0.55, 0.95) * fresnel * max(dotNL, 0.0) * 0.45;
          finalColor += atmosphereRim;
        }

        // 单一不透明表面：alpha 保持 1.0，彻底消除多层重绘与透视穿模
        gl_FragColor = vec4(finalColor, 1.0);

        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

