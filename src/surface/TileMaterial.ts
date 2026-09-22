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

  return new THREE.ShaderMaterial({
    uniforms: {
      dayTexture: { value: dayTexture },
      coarseTexture: { value: coarseTex },
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
        // 采样祖先低清与自有高清纹理
        vec2 coarseUv = ancestorUvOffset + vUv * ancestorUvScale;
        vec4 coarseColor = texture2D(coarseTexture, coarseUv);
        vec4 fineColor = texture2D(dayTexture, vUv);

        vec3 dayColor;
        if (hasFineTexture > 0.5) {
          dayColor = mix(coarseColor.rgb, fineColor.rgb, clamp(imageMix, 0.0, 1.0));
        } else {
          dayColor = coarseColor.rgb;
        }

        // 世界空间阳光向量
        vec3 normSunDir = normalize(sunDirection);
        float dotNL = dot(vNormal, normSunDir);

        // 晨昏线平滑过渡
        float dayFactor = smoothstep(-0.15, 0.20, dotNL);

        // 昼面光照漫反射与微量夜间微光
        float diffuse = max(dotNL, 0.0);
        vec3 litDayColor = dayColor * (diffuse * 0.95 + 0.05);

        // 夜面基础弱光 (含教学提亮)
        vec3 nightColor = dayColor * (0.04 + 0.25 * teachingLight);

        vec3 finalColor = mix(nightColor, litDayColor, dayFactor);

        // 大气边缘散射微光 (Fresnel Rim)
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 3.5);
        vec3 atmosphereRim = vec3(0.25, 0.55, 0.95) * fresnel * max(dotNL, 0.0) * 0.45;
        finalColor += atmosphereRim;

        // 单一不透明表面：alpha 保持 1.0，彻底消除多层重绘与透视穿模
        gl_FragColor = vec4(finalColor, 1.0);

        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
