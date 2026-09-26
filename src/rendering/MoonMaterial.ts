/**
 * 月球专属天体物理多孔月壤与冲日散射着色材质 (MoonMaterial)
 * 1. Lommel-Seeliger / Hapke 多孔玄武岩月壤漫反射模型（模拟月面平坦圆盘测光特性，根除塑料高光）；
 * 2. 满月冲日效应激增 (Lunar Opposition Surge)，在相位角趋近 0° 时微孔隙自阴影隐去，反照率跃升 30%；
 * 3. 月海 (Maria) 玄武岩与月陆 (Highlands) 斜长岩地质反照率分异，强化第谷 (Tycho) 与哥白尼 (Copernicus) 千公里明亮溅射辐射纹；
 * 4. 真空环境剃刀晨昏线 (Razor-Edge Terminator) 凌厉过渡；
 * 5. 教学补光联动 (teachingLight)，开灯清晰辨识月球背面密集环形山与南极-艾特肯巨大盆地。
 * F-SURFACE-BLEND-01：支持共享本体光照 uniform 与高/低清地理混合带，使站点
 * 细层（L1/DTM 窗）与本体球面同口径着色，边缘带按地理位置渐混全球底图。
 */

import * as THREE from 'three';

export interface MoonMaterialUniforms {
  [key: string]: THREE.IUniform<any>;
  moonTexture: { value: THREE.Texture | null };
  sunDirection: { value: THREE.Vector3 };
  teachingLight: { value: number };
  /** R2：整体透明度（挖孔补片克隆体渐显用；本体恒 1 不受影响） */
  uOpacity: { value: number };
}

export interface MoonMaterialOptions {
  /** 共享本体光照 uniform 对象（引用同一 IUniform，引擎逐帧更新自动同步） */
  shared?: {
    sunDirection: { value: THREE.Vector3 };
    teachingLight: { value: number };
  };
  /**
   * 窗口混合：moonTex 作为高清图按网格局部 UV 采样；loTexture 作为全球底图
   * 按 uvRect=[u0,v0,u1,v1]（窗口的全球等距柱状 UV 范围）插值采样；网格边带
   * （bandFrac×窗口宽，从边缘起算）内权重平滑降为 0，中心保持纯高清。
   * uv 轴向：网格 vUv=(0,0) 为窗口西北角（lat 最大），故 v 向取 uvRect[3]→[1]。
   */
  blend?: {
    loTexture: THREE.Texture | null;
    uvRect: [number, number, number, number];
    bandFrac?: number;
  };
}

/** 采样兜底纹理：纹理迟到期间避免 sampler2D 绑定为空（渲染黑块/告警） */
let whiteFallback: THREE.DataTexture | null = null;
function white1x1(): THREE.DataTexture {
  if (!whiteFallback) {
    whiteFallback = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    whiteFallback.needsUpdate = true;
  }
  return whiteFallback;
}

export function createMoonMaterial(
  moonTex: THREE.Texture | null,
  options?: MoonMaterialOptions
): THREE.ShaderMaterial {
  const blend = options?.blend;
  const uniforms: MoonMaterialUniforms = {
    moonTexture: { value: moonTex ?? white1x1() },
    sunDirection: options?.shared?.sunDirection ?? { value: new THREE.Vector3(1, 0, 0).normalize() },
    teachingLight: options?.shared?.teachingLight ?? { value: 0.0 },
    uOpacity: { value: 1.0 },
  };
  if (blend) {
    uniforms.uLoTexture = { value: blend.loTexture ?? white1x1() };
    uniforms.uGlobalUv0 = { value: new THREE.Vector2(blend.uvRect[0], blend.uvRect[1]) };
    uniforms.uGlobalUv1 = { value: new THREE.Vector2(blend.uvRect[2], blend.uvRect[3]) };
    uniforms.uBandFrac = { value: blend.bandFrac ?? 0.15 };
  }

  const sampleBody = blend
    ? `
        vec4 hiRaw = texture2D(moonTexture, vUv);
        // 窗口局部 UV → 全球等距柱状 UV（v 轴反向：网格 v=0 为北缘）
        vec2 gUv = vec2(
          mix(uGlobalUv0.x, uGlobalUv1.x, vUv.x),
          mix(uGlobalUv1.y, uGlobalUv0.y, vUv.y));
        vec4 loRaw = texture2D(uLoTexture, gUv);
        // 地理固定的边缘混合带：到窗口边最近距离在 bandFrac 内权重 0→1，
        // 中心恒 1（纯高清），四角连续（min 距离场，无十字线/圆形硬边）
        vec2 ed = min(vUv, 1.0 - vUv);
        // Product of smooth edge weights also has continuous derivatives at corners.
        vec2 edgeWeight = smoothstep(vec2(0.0), vec2(max(uBandFrac, 1e-4)), ed);
        float wHi = edgeWeight.x * edgeWeight.y;
        vec4 rawTex = mix(loRaw, hiRaw, wHi);
      `
    : `
        vec4 rawTex = texture2D(moonTexture, vUv);
      `;

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
      uniform float uOpacity;
      ${blend ? `
      uniform sampler2D uLoTexture;
      uniform vec2 uGlobalUv0;
      uniform vec2 uGlobalUv1;
      uniform float uBandFrac;` : ''}

      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      void main() {
        vec3 N = normalize(vNormal);
        vec3 L = normalize(sunDirection);
        vec3 V = normalize(cameraPosition - vWorldPosition);

        ${sampleBody}

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

        gl_FragColor = vec4(finalColor, uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
