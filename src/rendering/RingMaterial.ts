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

        // 只丢弃全透明像素；弱窄环的次像素覆盖不能被阈值抹掉
        if (texColor.a <= 0.0) {
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

/** Main narrow-ring radii/widths: NASA NSSDCA/PDS Ring-Moon Node.
 * Area coverage preserves sub-texel optical depth without inflating ring width.
 * Reflectance and uniform azimuth are illustrative; Neptune arcs are not modeled.
 */
function narrowRingTexture(radiusKm:number, inner:number, outer:number,
  bands:readonly (readonly [number,number,number])[]):THREE.DataTexture {
  const width=4096, data=new Uint8Array(width*4);
  const min=radiusKm*inner, span=radiusKm*(outer-inner), step=span/width;
  for(let x=0;x<width;x++) {
    const lo=min+x*step, hi=lo+step;
    let alpha=0;
    for(const [center,bandWidth,tau] of bands) {
      const coverage=Math.max(0,Math.min(hi,center+bandWidth/2)-Math.max(lo,center-bandWidth/2))/step;
      alpha+=coverage*(1-Math.exp(-tau));
    }
    data.set([100,98,95,Math.round(Math.min(1,alpha)*255)],x*4);
  }
  const tex=new THREE.DataTexture(data,width,1);
  tex.colorSpace=THREE.SRGBColorSpace;
  tex.minFilter=THREE.LinearMipmapLinearFilter;tex.magFilter=THREE.LinearFilter;
  tex.generateMipmaps=true;tex.needsUpdate=true;
  return tex;
}
export function getUranusRingTexture():THREE.Texture {
  // Variable-width rings use representative widths within the observed range.
  return narrowRingTexture(25362,1.45,2.15,[
    [41837,1.5,.3],[42234,2,.5],[42571,2,.3],[44718,7,.4],[45661,8,.3],
    [47176,1.6,.4],[47627,2.5,.4],[48300,5,.4],[50024,2,.1],[51149,58,1],
  ]);
}
export function getNeptuneRingTexture():THREE.Texture {
  // Galle/Lassell extremely faint diffuse components omitted in this display.
  return narrowRingTexture(24622,1.65,2.60,[[53200,50,.006],[62933,15,.03]]);
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

