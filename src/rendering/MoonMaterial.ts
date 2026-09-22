/**
 * 月球专属天体物理多孔月壤与冲日散射着色材质 (MoonMaterial)
 * 1. Lommel-Seeliger / Hapke 多孔玄武岩月壤漫反射模型（模拟月面平坦圆盘测光特性，根除塑料高光）；
 * 2. 满月冲日效应激增 (Lunar Opposition Surge)，在相位角趋近 0° 时微孔隙自阴影隐去，反照率跃升 30%；
 * 3. 月海 (Maria) 玄武岩与月陆 (Highlands) 斜长岩地质反照率分异，强化第谷 (Tycho) 与哥白尼 (Copernicus) 千公里明亮溅射辐射纹；
 * 4. 真空环境剃刀晨昏线 (Razor-Edge Terminator) 凌厉过渡；
 * 5. 教学补光联动 (teachingLight)，开灯清晰辨识月球背面密集环形山与南极-艾特肯巨大盆地。
 */

import * as THREE from 'three';

export interface MoonMaterialUniforms {
  [key: string]: THREE.IUniform<any>;
  moonTexture: { value: THREE.Texture | null };
  sunDirection: { value: THREE.Vector3 };
  teachingLight: { value: number };
}

export function createMoonMaterial(moonTex: THREE.Texture): THREE.ShaderMaterial {
  const uniforms: MoonMaterialUniforms = {
    moonTexture: { value: moonTex },
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
      #include <common>

      uniform sampler2D moonTexture;
      uniform vec3 sunDirection;
      uniform float teachingLight;

      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      void main() {
        vec3 N = normalize(vNormal);
        vec3 L = normalize(sunDirection);
        vec3 V = normalize(cameraPosition - vWorldPosition);

        vec4 rawTex = texture2D(moonTexture, vUv);

        // 1. 基础入射角与视线几何
        float NdotL = dot(N, L);
        float NdotV = max(dot(N, V), 0.001);
        float sunLit = max(NdotL, 0.0);

        // 2. Lommel-Seeliger 月面表土散射定律
        // 月球多孔粉末风化层 (Lunar Regolith) 产生近乎等亮度的圆盘测光特性 (Lunar Photometric Function)
        float lommelSeeliger = sunLit / (sunLit + NdotV);
        float diffuseShading = pow(sunLit, 0.88) * 0.82 + 0.18 * sunLit;
        float regolithDiffuse = mix(diffuseShading, lommelSeeliger * 1.40, 0.55);

        // 3. 冲日激增效应 (Lunar Opposition Surge / Coherent Backscatter)
        // 满月时刻观测视线与太阳光向夹角接近 0° 时，微颗粒微观自阴影彻底隐匿，亮度显著突增
        float cosPhase = max(dot(L, V), 0.0);
        float oppositionSurge = pow(cosPhase, 24.0) * 0.32 * sunLit;
        float totalDiffuse = regolithDiffuse + oppositionSurge;

        // 4. 地质反照率增强：月海玄武岩 vs 月陆斜长岩 vs 第谷明亮辐射纹
        float luma = dot(rawTex.rgb, vec3(0.299, 0.587, 0.114));
        vec3 surfaceColor = rawTex.rgb;

        // 4.1 月海深色平原（低钛/高钛玄武岩熔岩平原，保持沉稳冷灰黑，反照率 ~0.08）
        float mariaFactor = 1.0 - smoothstep(0.22, 0.40, luma);
        surfaceColor = mix(surfaceColor, surfaceColor * vec3(0.88, 0.90, 0.94), mariaFactor * 0.45);

        // 4.2 第谷/哥白尼高反照率年轻撞击坑放射纹 (Ray Systems) 与新鲜斜长岩高地提亮
        float rayFactor = smoothstep(0.55, 0.78, luma);
        surfaceColor += vec3(0.18, 0.20, 0.22) * rayFactor;

        // 5. 真空剃刀晨昏线 (Razor-Edge Terminator)
        float terminator = smoothstep(-0.006, 0.010, NdotL);

        // 6. 受光区与环境光合成
        vec3 litColor = surfaceColor * totalDiffuse;

        // 7. 教学暗部补光 (teachingLight) 联动
        vec3 deepSpaceAmbient = surfaceColor * 0.025;
        vec3 teachingAmbient = surfaceColor * 0.45;
        vec3 ambientTerm = mix(deepSpaceAmbient, teachingAmbient, teachingLight);

        vec3 finalColor = litColor * terminator + ambientTerm * (1.0 - terminator * 0.85);

        gl_FragColor = vec4(finalColor, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
