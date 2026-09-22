/**
 * 火星微小卫星专属碳质小行星表土漫反射着色材质 (AsteroidMoonMaterial)
 * 专用于火卫一 (Phobos) 与火卫二 (Deimos)：
 * 1. 真实极低几何反照率 (Albedo ~0.07，碳质球粒陨石深沉哑光黑褐调)；
 * 2. Lommel-Seeliger 小天体微重力风化层多孔散射模型；
 * 3. 碳质小行星特有的陡峭相角冲日增亮曲线 (Opposition Surge)；
 * 4. 真空剃刀晨昏线 (Razor-Edge Terminator)，锐化深邃陨坑壁凹陷阴影；
 * 5. 教学补光 (teachingLight) 联动，暗面清晰呈现不规则形态与微观地质特征。
 */

import * as THREE from 'three';

export interface AsteroidMoonMaterialUniforms {
  [key: string]: THREE.IUniform<any>;
  moonTexture: { value: THREE.Texture | null };
  sunDirection: { value: THREE.Vector3 };
  teachingLight: { value: number };
  bodyType: { value: number }; // 1.0 for Phobos, 2.0 for Deimos
}

export function createAsteroidMoonMaterial(
  moonTex: THREE.Texture,
  kind: 'phobos' | 'deimos' = 'phobos'
): THREE.ShaderMaterial {
  const uniforms: AsteroidMoonMaterialUniforms = {
    moonTexture: { value: moonTex },
    sunDirection: { value: new THREE.Vector3(1, 0, 0).normalize() },
    teachingLight: { value: 0.0 },
    bodyType: { value: kind === 'phobos' ? 1.0 : 2.0 },
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
      uniform sampler2D moonTexture;
      uniform vec3 sunDirection;
      uniform float teachingLight;
      uniform float bodyType; // 1.0 = phobos, 2.0 = deimos

      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      void main() {
        vec3 N = normalize(vNormal);
        vec3 L = normalize(sunDirection);
        vec3 V = normalize(cameraPosition - vWorldPosition);

        vec4 rawTex = texture2D(moonTexture, vUv);

        // 1. 基础几何夹角
        float NdotL = dot(N, L);
        float NdotV = max(dot(N, V), 0.001);
        float sunLit = max(NdotL, 0.0);

        // 2. Lommel-Seeliger 多孔粗糙深空表土漫反射
        float lommelSeeliger = sunLit / (sunLit + NdotV);
        float diffuseShading = pow(sunLit, 0.88) * 0.82 + 0.18 * sunLit;
        float asteroidDiffuse = mix(diffuseShading, lommelSeeliger * 1.38, 0.55);

        // 3. 碳质小行星冲日效应激增 (陡峭相角反照增益)
        float cosPhase = max(dot(L, V), 0.0);
        float opposition = pow(cosPhase, 24.0) * 0.32 * sunLit;
        float totalDiffuse = asteroidDiffuse + opposition;

        // 4. 地表质感校准：真实碳质球粒陨石 (C/D-type Asteroid Regolith)
        // 适当提升向阳面可读性，保留深沉冷碳黑至暗灰褐
        vec3 surfaceColor = rawTex.rgb * 1.35;

        if (bodyType < 1.5) {
          // 火卫一 (Phobos): 强化斯蒂克尼坑底深黑阴影与坑壁新鲜露头亮岩微对比
          float luma = dot(surfaceColor, vec3(0.299, 0.587, 0.114));
          surfaceColor = mix(surfaceColor * 0.88, surfaceColor, smoothstep(0.16, 0.48, luma));
        } else {
          // 火卫二 (Deimos): 厚风化层毛毯包络，微尘流柔和漫漫呈现
          surfaceColor = surfaceColor * vec3(1.04, 1.02, 0.98);
        }

        // 5. 真空剃刀晨昏线 (Razor-Edge Terminator)
        float terminator = smoothstep(-0.006, 0.012, NdotL);

        // 6. 受光区颜色
        vec3 litColor = surfaceColor * totalDiffuse;

        // 7. 教学补光 (teachingLight) 联动
        vec3 deepSpaceAmbient = surfaceColor * 0.03;
        vec3 teachingAmbient = surfaceColor * 0.48;
        vec3 ambientTerm = mix(deepSpaceAmbient, teachingAmbient, teachingLight);

        vec3 finalColor = litColor * terminator + ambientTerm * (1.0 - terminator * 0.85);

        gl_FragColor = vec4(finalColor, 1.0);
      }
    `,
  });
}
