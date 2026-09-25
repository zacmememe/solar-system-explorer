/**
 * 火星专属天体物理着色器材质 (MarsMaterial)
 * 1. Lommel-Seeliger / Hapke 粗糙风化矿物砂岩散射模型（消除廉价塑料感）；
 * 2. 极地冰盖 (Polar Ice Caps) 高反照率与微晶冰面光泽；
 * 3. 火星标志性“蓝夕阳”晨昏前向散射微光 (Martian Forward Twilight Blue Haze)；
 * 4. 高层微细氧化铁尘埃浅赭边缘光晕 (Dust Horizon Rim)；
 * 5. 教学提亮支持 (teachingLight)，开灯清晰辨识水手号大峡谷与奥林匹斯山地貌。
 */

import * as THREE from 'three';

export interface MarsMaterialUniforms {
  [key: string]: THREE.IUniform<any>;
  marsTexture: { value: THREE.Texture | null };
  sunDirection: { value: THREE.Vector3 };
  teachingLight: { value: number };
}

export function createMarsMaterial(marsTex: THREE.Texture | null): THREE.ShaderMaterial {
  if (marsTex) marsTex.wrapS = THREE.RepeatWrapping;
  const uniforms: MarsMaterialUniforms = {
    marsTexture: { value: marsTex },
    sunDirection: { value: new THREE.Vector3(1, 0, 0).normalize() },
    teachingLight: { value: 0.0 },
    layerOpacity: { value: 1.0 },
  };

  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, uniforms]),
    fog: true,
    vertexShader: `
      #include <fog_pars_vertex>
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      void main() {
        vUv = uv;
        // 世界空间法线与顶点绝对坐标
        vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>

      uniform sampler2D marsTexture;
      uniform vec3 sunDirection;
      uniform float teachingLight;
      uniform float layerOpacity;

      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      void main() {
        // 世界空间向量
        vec3 N = normalize(vNormal);
        vec3 L = normalize(sunDirection);
        vec3 V = normalize(cameraPosition - vWorldPosition);

        // 基础地表纹理采样
        vec4 texColor = texture2D(marsTexture, vUv);

        // 1. 关键几何夹角
        float NdotL = dot(N, L);
        float NdotV = max(dot(N, V), 0.0);
        float sunLit = max(NdotL, 0.0);

        // 2. Lommel-Seeliger 粗糙多孔砂岩矿物散射
        // 真实火星地表由多孔风化玄武岩与氧化铁粉尘构成，边缘衰减沉稳，绝非光滑塑料
        float lommelSeeliger = sunLit / max(sunLit + NdotV, 0.001);
        float rockDiffuse = mix(sunLit, lommelSeeliger * 1.45, 0.40);

        // 3. 南北极极地冰盖 (Polar Caps) 高反照增强与微弱冰晶反射
        // 火星南极 (vUv.y < 0.12) 和北极 (vUv.y > 0.88) 富含二氧化碳干冰与水冰
        float polarDist = abs(vUv.y - 0.5) * 2.0; // 0 (赤道) ~ 1.0 (极点)
        float luma = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
        float isIceCap = smoothstep(0.80, 0.94, polarDist) * smoothstep(0.48, 0.70, luma);

        // 冰盖冷白提亮与微晶高光
        vec3 iceColor = mix(texColor.rgb, vec3(0.96, 0.98, 1.02), 0.38);
        vec3 surfaceColor = mix(texColor.rgb, iceColor, isIceCap);

        vec3 H = normalize(L + V);
        float iceGlint = pow(max(dot(N, H), 0.0), 24.0) * isIceCap * 0.35 * sunLit;

        // 4. 火星晨昏“蓝夕阳”微米尘埃前向散射 (Martian Twilight Blue Haze)
        // 好奇号/毅力号实测证实：火星微细尘埃颗粒使晨昏地平线附近产生前向蓝散射光
        float forwardPhase = max(dot(L, -V), 0.0);
        float twilightZone = smoothstep(-0.16, 0.08, NdotL) * (1.0 - smoothstep(-0.08, 0.16, NdotL));
        float blueTwilightFactor = pow(forwardPhase, 3.2) * twilightZone * 0.38;
        vec3 blueTwilightGlow = vec3(0.32, 0.52, 0.88) * blueTwilightFactor;

        // 5. 高空微细悬浮尘埃浅赭边缘微光 (Dust Horizon Rim)
        float rim = pow(1.0 - NdotV, 3.2);
        vec3 dustRimColor = vec3(0.92, 0.68, 0.52) * rim * 0.16 * smoothstep(-0.06, 0.18, NdotL);

        // 6. 晨昏昼夜与暗部过渡
        float dayFactor = smoothstep(-0.06, 0.12, NdotL);
        vec3 litColor = surfaceColor * rockDiffuse + iceGlint;

        // 7. 教学补光模式 (teachingLight)
        // 开启时照亮水手号大峡谷与奥林匹斯山地貌；关闭时忠于真实深空黑夜
        vec3 deepSpaceAmbient = vec3(0.012, 0.014, 0.020);
        vec3 teachingAmbient = surfaceColor * 0.35;
        vec3 ambientTerm = mix(deepSpaceAmbient, teachingAmbient, teachingLight);

        // 8. 综合最终色彩合成
        vec3 finalColor = litColor * dayFactor + ambientTerm * (1.0 - dayFactor * 0.85) + blueTwilightGlow + dustRimColor;

        gl_FragColor = vec4(finalColor, layerOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}
