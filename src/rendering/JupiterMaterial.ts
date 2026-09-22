/**
 * 木星专属气态巨行星多层次着色渲染管线
 * 遵循天体物理真实感与克制设计原则：
 * 1. Minnaert 气态大气边缘变暗 (Limb Darkening) 物理散射模型；
 * 2. 柔和气态大气晨昏渐变 (Soft Gas-Atmosphere Terminator)；
 * 3. 纬度条带 (Belts & Zones) 与大红斑对比度保留；
 * 4. 教学提亮支持 (teachingLight)，开灯看清背阳面云带，关灯忠于真实宇宙光影。
 */

import * as THREE from 'three';

export interface JupiterMaterialUniforms {
  [key: string]: THREE.IUniform<any>;
  jupiterTexture: { value: THREE.Texture | null };
  sunDirection: { value: THREE.Vector3 };
  teachingLight: { value: number };
  minnaertK: { value: number }; // Minnaert 幂参数，气态行星典型值 0.82 ~ 0.88
}

export function createJupiterMaterial(jupiterTex: THREE.Texture): THREE.ShaderMaterial {
  const uniforms: JupiterMaterialUniforms = {
    jupiterTexture: { value: jupiterTex },
    sunDirection: { value: new THREE.Vector3(1, 0, 0).normalize() },
    teachingLight: { value: 0.0 },
    minnaertK: { value: 0.85 },
  };

  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      void main() {
        vUv = uv;
        // 世界空间法线与坐标
        vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      #include <common>

      uniform sampler2D jupiterTexture;
      uniform vec3 sunDirection;
      uniform float teachingLight;
      uniform float minnaertK;

      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      void main() {
        // 全局世界空间统一向量
        vec3 N = normalize(vNormal);
        vec3 L = normalize(sunDirection);
        vec3 V = normalize(cameraPosition - vWorldPosition);

        // 基础纹理采样
        vec4 texColor = texture2D(jupiterTexture, vUv);

        // 1. 光照入射角与相机观测角
        float NdotL = dot(N, L);
        float NdotV = max(dot(N, V), 0.0);
        float sunLit = max(NdotL, 0.0);

        // 2. 气态巨行星 Minnaert / Lommel-Seeliger 边缘变暗 (Limb Darkening)
        // 视线倾斜穿过厚重大气层时，光程更长且高层气溶胶散射吸收增多，盘面边缘呈现柔和暗化
        // 保持中心原汁原味饱和度，边缘优雅暗化，彻底消除硬塑料感与过曝泛白
        float limbDarkening = mix(0.35, 1.0, pow(clamp(NdotV, 0.0, 1.0), 0.40));
        float sunTerm = pow(sunLit, minnaertK);
        float minnaertShading = sunTerm * limbDarkening;

        // 3. 柔和气态晨昏过渡 (Soft Gas Terminator)
        float terminator = smoothstep(-0.06, 0.12, NdotL);

        // 4. 深空弱环境光与暗部处理
        vec3 deepSpaceAmbient = vec3(0.012, 0.015, 0.020);

        // 5. 教学提亮模式支持 (teachingLight)
        // 开启时照亮背阳面云带与风暴，保留可观察的纹理层级；关灯忠于真实宇宙深空
        vec3 teachingAmbient = texColor.rgb * 0.32;
        vec3 ambientTerm = mix(deepSpaceAmbient, teachingAmbient, teachingLight);

        // 6. 昼夜合成
        vec3 directColor = texColor.rgb * minnaertShading * terminator;
        vec3 finalColor = directColor + ambientTerm * (1.0 - terminator * 0.85);

        // 7. 高层氨/甲烷雾霾微弱米黄边缘辉光 (Forward Haze Rim)
        float rim = pow(1.0 - clamp(NdotV, 0.0, 1.0), 3.5);
        vec3 rimColor = vec3(1.0, 0.94, 0.80) * (rim * 0.20 * terminator);
        finalColor += rimColor;

        gl_FragColor = vec4(finalColor, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
