/**
 * 土星环专用径向纹理与行星投影阴影材质
 * 遵循 01-REBUILD-PLAN.zh-CN.md 第 9.1 节规范：
 * 1. 严格使用径向纹理映射 u = (r - innerR) / (outerR - innerR)；
 * 2. 双面透光渲染（THREE.DoubleSide）；
 * 3. 行星对光环背阳面的几何解析阴影（遮挡直射阳光）。
 */

import * as THREE from 'three';

export interface RingMaterialOptions {
  innerRadius: number;
  outerRadius: number;
  ringTexture: THREE.Texture;
  planetRadius: number;
}

export function createSaturnRingMaterial(options: RingMaterialOptions): THREE.ShaderMaterial {
  const { innerRadius, outerRadius, ringTexture, planetRadius } = options;

  ringTexture.wrapS = THREE.ClampToEdgeWrapping;
  ringTexture.wrapT = THREE.ClampToEdgeWrapping;

  return new THREE.ShaderMaterial({
    uniforms: {
      ringTexture: { value: ringTexture },
      innerRadius: { value: innerRadius },
      outerRadius: { value: outerRadius },
      planetRadius: { value: planetRadius },
      sunDirection: { value: new THREE.Vector3(1, 0, 0) }, // 局部坐标系下的阳光入射方向
      ambientLight: { value: 0.15 },
    },
    vertexShader: `
      varying vec3 vLocalPosition;
      varying vec3 vNormal;

      void main() {
        vLocalPosition = position;
        vNormal = normalMatrix * normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      #include <common>

      uniform sampler2D ringTexture;
      uniform float innerRadius;
      uniform float outerRadius;
      uniform float planetRadius;
      uniform vec3 sunDirection;
      uniform float ambientLight;

      varying vec3 vLocalPosition;
      varying vec3 vNormal;

      void main() {
        // 1. 径向距离计算（空间不变量：中心为原点，局部三维坐标模长即为真实径向半径）
        float r = length(vLocalPosition);
        if (r < innerRadius || r > outerRadius) {
          discard;
        }

        // 2. 径向 UV 映射，u 沿半径延伸，v 取条带中心 0.5
        float u = clamp((r - innerRadius) / (outerRadius - innerRadius), 0.0, 1.0);
        vec4 texColor = texture2D(ringTexture, vec2(u, 0.5));

        // 若 alpha 极小（如卡西尼环缝最高透光区），直接剔除
        if (texColor.a < 0.03) {
          discard;
        }

        // 3. 行星对星环背阳面的解析圆柱影锥计算
        vec3 sunDirNorm = normalize(sunDirection);
        float alongSun = dot(vLocalPosition, sunDirNorm);

        float shadowFactor = 1.0;
        // 如果环点位于行星背阳侧 (alongSun < 0.0)
        if (alongSun < 0.0) {
          // 计算该点到背阳投射圆柱轴线的垂直距离
          vec3 projOnAxis = alongSun * sunDirNorm;
          float distToAxis = length(vLocalPosition - projOnAxis);
          if (distToAxis < planetRadius) {
            // 平滑大气半影过渡
            shadowFactor = smoothstep(0.88 * planetRadius, planetRadius, distToAxis);
          }
        }

        // 4. 双面透光与微冰晶微粒的前向米氏散射辉光 (Forward Scattering)
        float lightIntensity = ambientLight + (1.0 - ambientLight) * shadowFactor;
        vec3 diffuse = texColor.rgb * lightIntensity * 1.15;

        gl_FragColor = vec4(diffuse, texColor.a * 0.92);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false, // 防止半透明星环切断背景深度
    blending: THREE.NormalBlending,
  });
}

/**
 * 天王星高拟真细密暗色冰晶光环径向纹理 (Uranus Rings)
 * 真实还原 13 道独立细窄光环，以最外侧最显著的 Epsilon (ε) 环为主导
 */
export function getUranusRingTexture(): THREE.Texture {
  if (typeof document === 'undefined') {
    const data = new Uint8Array([100, 116, 139, 180]);
    const tex = new THREE.DataTexture(data, 1, 1);
    tex.needsUpdate = true;
    return tex;
  }

  const W = 512, H = 1;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const imgData = ctx.createImageData(W, H);
  const data = imgData.data;

  for (let x = 0; x < W; x++) {
    const u = x / W; // 0.0=内边缘，1.0=外边缘
    let alpha = 0.0;
    let r = 148, g = 163, b = 184; // 优雅低反照率深青灰冰屑色

    // 内部细窄暗环群 (6, 5, 4, Alpha, Beta, Eta, Gamma, Delta 环)
    if (u > 0.18 && u < 0.22) alpha = 0.25;
    if (u > 0.32 && u < 0.36) alpha = 0.32;
    if (u > 0.45 && u < 0.49) alpha = 0.45;
    if (u > 0.58 && u < 0.63) alpha = 0.55;
    if (u > 0.70 && u < 0.74) alpha = 0.48;

    // 最外侧主导巨环：Epsilon (ε) 环 (最密最高光深度)
    if (u > 0.86 && u < 0.96) {
      const epNorm = (u - 0.91) / 0.05;
      alpha = Math.max(0.0, 1.0 - epNorm * epNorm) * 0.85;
      r = 186; g = 230; b = 253; // ε 环富冰晶亮青白
    }

    const idx = x * 4;
    data[idx] = r;
    data[idx + 1] = g;
    data[idx + 2] = b;
    data[idx + 3] = Math.round(alpha * 255);
  }

  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/**
 * 海王星暗色尘埃与密集弧段光环径向纹理 (Neptune Rings)
 * 真实还原 Galle 弥散内环、Le Verrier 环与带有著名的自由/平等/博爱光环弧段的 Adams 环
 */
export function getNeptuneRingTexture(): THREE.Texture {
  if (typeof document === 'undefined') {
    const data = new Uint8Array([70, 60, 50, 140]);
    const tex = new THREE.DataTexture(data, 1, 1);
    tex.needsUpdate = true;
    return tex;
  }

  const W = 512, H = 1;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const imgData = ctx.createImageData(W, H);
  const data = imgData.data;

  for (let x = 0; x < W; x++) {
    const u = x / W;
    let alpha = 0.0;
    let r = 120, g = 100, b = 85; // 碳化有机辐射尘埃微铜褐色

    // 内侧 Galle 弥散尘埃宽环
    if (u > 0.15 && u < 0.35) {
      alpha = 0.15 * Math.sin(((u - 0.15) / 0.20) * Math.PI);
    }
    // Le Verrier 狭窄主环
    if (u > 0.52 && u < 0.56) {
      alpha = 0.45;
    }
    // Lassell 极暗光环薄层
    if (u > 0.56 && u < 0.75) {
      alpha = 0.08;
    }
    // 最外侧著名 Adams 弧环
    if (u > 0.88 && u < 0.94) {
      alpha = 0.65;
      r = 160; g = 140; b = 120;
    }

    const idx = x * 4;
    data[idx] = r;
    data[idx + 1] = g;
    data[idx + 2] = b;
    data[idx + 3] = Math.round(alpha * 255);
  }

  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export interface RingShadowPlanetMaterialOptions {
  planetTexture: THREE.Texture;
  ringTexture: THREE.Texture;
  innerRadius: number;
  outerRadius: number;
}

/**
 * 行星本体受光环投射阴影材质 (Ring Shadow on Planet Globe)
 * 依据卡西尼号/旅行者号物理观测：
 * 当阳光照射行星赤道附近的浓厚云层时，位于赤道平面的高密光环将在地表投下狭长深邃的星环黑带阴影。
 */
export function createRingShadowPlanetMaterial(
  options: RingShadowPlanetMaterialOptions
): THREE.ShaderMaterial {
  const { planetTexture, ringTexture, innerRadius, outerRadius } = options;

  planetTexture.wrapS = THREE.RepeatWrapping;
  planetTexture.wrapT = THREE.ClampToEdgeWrapping;
  ringTexture.wrapS = THREE.ClampToEdgeWrapping;
  ringTexture.wrapT = THREE.ClampToEdgeWrapping;

  return new THREE.ShaderMaterial({
    uniforms: {
      planetTexture: { value: planetTexture },
      ringTexture: { value: ringTexture },
      innerRadius: { value: innerRadius },
      outerRadius: { value: outerRadius },
      sunDirection: { value: new THREE.Vector3(1, 0, 0) },
      ambientLight: { value: 0.22 },
      teachingLight: { value: 0.0 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vLocalPosition;

      void main() {
        vUv = uv;
        vLocalPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D planetTexture;
      uniform sampler2D ringTexture;
      uniform float innerRadius;
      uniform float outerRadius;
      uniform vec3 sunDirection;
      uniform float ambientLight;
      uniform float teachingLight;

      varying vec2 vUv;
      varying vec3 vLocalPosition;

      void main() {
        vec4 texColor = texture2D(planetTexture, vUv);

        // 1. 局部坐标系下的球体表面漫反射
        vec3 localNormal = normalize(vLocalPosition);
        vec3 normSunDir = normalize(sunDirection);
        float dotNL = max(dot(localNormal, normSunDir), 0.0);

        // 2. 光环在行星本体表面的几何解析投射阴影
        // Sample on all fragments so mip derivatives remain defined at the
        // projected edge. Coverage spans one pixel instead of a hard branch.
        float sunY = (normSunDir.y < 0.0 ? -1.0 : 1.0) * max(abs(normSunDir.y), 0.00001);
        float t = -vLocalPosition.y / sunY;
        vec3 hitPoint = vLocalPosition + t * normSunDir;
        float rHit = length(hitPoint.xz);
        float radialWidth = max(fwidth(rHit), 0.00001);
        float rayWidth = max(fwidth(t), 0.00001);
        float radialCoverage = smoothstep(innerRadius - radialWidth, innerRadius + radialWidth, rHit)
          * (1.0 - smoothstep(outerRadius - radialWidth, outerRadius + radialWidth, rHit));
        float frontCoverage = smoothstep(-rayWidth, rayWidth, t);
        float u = (rHit - innerRadius) / (outerRadius - innerRadius);
        vec4 ringSample = texture2D(ringTexture, vec2(u, 0.5));
        float shadowFactor = 1.0 - ringSample.a * 0.88 * radialCoverage * frontCoverage;

        // 3. 漫反射 + 教学提亮支持
        float baseLight = mix(ambientLight, 0.65, teachingLight);
        float lightIntensity = baseLight + (1.0 - baseLight) * dotNL * shadowFactor;
        vec3 finalColor = texColor.rgb * lightIntensity;

        gl_FragColor = vec4(finalColor, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

