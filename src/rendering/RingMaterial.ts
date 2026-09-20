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
      uniform sampler2D ringTexture;
      uniform float innerRadius;
      uniform float outerRadius;
      uniform float planetRadius;
      uniform vec3 sunDirection;
      uniform float ambientLight;

      varying vec3 vLocalPosition;
      varying vec3 vNormal;

      void main() {
        // 1. 径向距离计算（假设 Ring 几何体在 XY 平面内）
        float r = length(vLocalPosition.xy);
        if (r < innerRadius || r > outerRadius) {
          discard;
        }

        // 2. 径向 UV 映射，u 沿半径延伸，v 取条带中心 0.5
        float u = (r - innerRadius) / (outerRadius - innerRadius);
        vec4 texColor = texture2D(ringTexture, vec2(u, 0.5));

        // 若 alpha 极小（环缝极高透光区），直接剔除或半透明
        if (texColor.a < 0.05) {
          discard;
        }

        // 3. 行星对星环的背阳面几何解析阴影
        // 当光线从 sunDirection 射来，行星中心为原点 (0,0,0)
        // 环上点 vLocalPosition 到太阳方向反向的投影
        vec3 sunDirNorm = normalize(sunDirection);
        float alongSun = dot(vLocalPosition, sunDirNorm);

        float shadowFactor = 1.0;
        // 如果点在行星背阳侧 (alongSun < 0.0)
        if (alongSun < 0.0) {
          // 计算该点到背阳圆柱体轴线的距离
          vec3 projOnAxis = alongSun * sunDirNorm;
          float distToAxis = length(vLocalPosition - projOnAxis);
          // 在行星半径内受阴影遮蔽
          if (distToAxis < planetRadius) {
            // 平滑软阴影边缘过渡
            shadowFactor = smoothstep(0.85 * planetRadius, planetRadius, distToAxis);
          }
        }

        // 4. 双面微光与环境光混合
        vec3 diffuse = texColor.rgb * (ambientLight + (1.0 - ambientLight) * shadowFactor);

        gl_FragColor = vec4(diffuse, texColor.a);
      }
    `,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false, // 防止半透明星环切断背景深度
    blending: THREE.NormalBlending,
  });
}
