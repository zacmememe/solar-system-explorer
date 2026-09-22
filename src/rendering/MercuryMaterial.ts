/**
 * 水星专属天体物理真空岩石着色材质 (MercuryMaterial)
 * 1. Lommel-Seeliger 多孔风化角砾岩表土散射模型（杜绝塑料高光）；
 * 2. 冲日效应增亮 (Opposition Surge / Retroreflection)；
 * 3. 真空剃刀晨昏线 (Razor-Edge Terminator) 凌厉明暗分界；
 * 4. 纯净真空无任何虚假大气晕 (True Airless Planetary Physics)；
 * 5. 教学提亮支持 (teachingLight)，开灯清晰辨识卡洛里撞击盆地与高地辐射纹陨石坑。
 */

import * as THREE from 'three';

export interface MercuryMaterialUniforms {
  [key: string]: THREE.IUniform<any>;
  mercuryTexture: { value: THREE.Texture | null };
  sunDirection: { value: THREE.Vector3 };
  teachingLight: { value: number };
}

export function createMercuryMaterial(mercuryTex: THREE.Texture): THREE.ShaderMaterial {
  const uniforms: MercuryMaterialUniforms = {
    mercuryTexture: { value: mercuryTex },
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

      uniform sampler2D mercuryTexture;
      uniform vec3 sunDirection;
      uniform float teachingLight;

      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      void main() {
        vec3 N = normalize(vNormal);
        vec3 L = normalize(sunDirection);
        vec3 V = normalize(cameraPosition - vWorldPosition);

        vec4 texColor = texture2D(mercuryTexture, vUv);

        // 1. 几何夹角
        float NdotL = dot(N, L);
        float NdotV = max(dot(N, V), 0.0);
        float sunLit = max(NdotL, 0.0);

        // 2. Lommel-Seeliger 表土多孔反射模型
        // 水星与月球相同，表面由数十亿年微陨石轰击形成的极细风化表土构成
        // 反射特征主要由后向多孔散射主导，大角度观察依然保持哑光深沉
        float lommelSeeliger = sunLit / max(sunLit + NdotV, 0.001);
        float rockDiffuse = mix(sunLit, lommelSeeliger * 1.5, 0.52);

        // 3. 冲日激增 (Opposition Surge)
        // 当视线与太阳方向夹角极小时，微孔隙自阴影完全隐藏，亮度显著跃升
        float cosPhase = max(dot(L, V), 0.0);
        float oppositionGlow = pow(cosPhase, 24.0) * 0.28 * sunLit;
        float totalDiffuse = rockDiffuse + oppositionGlow;

        // 4. 真空环境特有的“剃刀晨昏线” (Razor-Edge Terminator)
        // 水星毫无大气漫射，阳光直射区与极夜阴影交界线极其锋利
        float terminator = smoothstep(-0.008, 0.012, NdotL);

        // 5. 地表色调保真（铅灰、冷灰玄武岩与斜长岩）
        vec3 surfaceColor = texColor.rgb;
        vec3 litColor = surfaceColor * totalDiffuse;

        // 6. 教学补光 (teachingLight)
        // 开启时照亮卡洛里盆地与极区永久阴影陨坑群；关闭时忠于宇宙真空纯粹死寂
        vec3 deepSpaceAmbient = vec3(0.008, 0.009, 0.012);
        vec3 teachingAmbient = surfaceColor * 0.38;
        vec3 ambientTerm = mix(deepSpaceAmbient, teachingAmbient, teachingLight);

        vec3 finalColor = litColor * terminator + ambientTerm * (1.0 - terminator * 0.90);

        gl_FragColor = vec4(finalColor, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
