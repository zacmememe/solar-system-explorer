/**
 * 太阳发光与日冕边缘散射材质
 * 遵循天体物理视觉特征：
 * 1. 边缘昏暗（Limb Darkening）与中心高温辉光；
 * 2. 动态光球对流纹理扰动；
 * 3. 伴随外部半透明日冕光晕外壳。
 */

import * as THREE from 'three';

export function createSunMaterial(sunTexture: THREE.Texture): THREE.ShaderMaterial {
  sunTexture.wrapS = THREE.RepeatWrapping;
  sunTexture.wrapT = THREE.ClampToEdgeWrapping;

  return new THREE.ShaderMaterial({
    uniforms: {
      sunTexture: { value: sunTexture },
      time: { value: 0.0 },
      glowColor: { value: new THREE.Color(1.0, 0.65, 0.2) },
      coreColor: { value: new THREE.Color(1.0, 0.95, 0.8) },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewPosition;

      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      #include <common>

      uniform sampler2D sunTexture;
      uniform vec3 glowColor;
      uniform vec3 coreColor;
      uniform float time;

      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewPosition;

      void main() {
        // 轻微对流动画采样
        vec2 uvOffset = vec2(time * 0.005, 0.0);
        vec4 texColor = texture2D(sunTexture, vUv + uvOffset);

        // 视线夹角与边缘昏暗（Limb Darkening）
        vec3 viewDir = normalize(vViewPosition);
        float dotNV = max(dot(vNormal, viewDir), 0.0);

        // 中心高亮，边缘稍深暖橙色
        float limbFactor = pow(dotNV, 0.6);
        vec3 finalColor = mix(glowColor * texColor.rgb * 1.5, coreColor * texColor.rgb * 1.8, limbFactor);

        gl_FragColor = vec4(finalColor, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * 太阳外侧高能日冕光晕材质 (Coronal Streamers & Exponential Flare)
 * 采用相机空间自适应公告板定向 + 纯径向指数衰减：
 * 彻底根除几何球体在边缘截断产生的硬圈伪影，呈现向无尽深空平滑扩散的自然炽热辉光。
 */
export function createSunCoronaMaterial(coreRadiusRatio: number = 0.45): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      coronaColor: { value: new THREE.Color(1.0, 0.45, 0.08) },
      coreGlowColor: { value: new THREE.Color(1.0, 0.85, 0.35) },
      coreRadiusRatio: { value: coreRadiusRatio },
      time: { value: 0.0 },
    },
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        // 面向相机的公告板变换：以太阳中心为原点，在观察空间直接平移四边形顶点
        vec4 mvPosition = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        mvPosition.xy += position.xy;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      #include <common>

      uniform vec3 coronaColor;
      uniform vec3 coreGlowColor;
      uniform float coreRadiusRatio;
      uniform float time;

      varying vec2 vUv;

      void main() {
        vec2 centerOffset = vUv - vec2(0.5);
        float dist = length(centerOffset) * 2.0; // 0.0 在中心，1.0 在四边形外边界

        // 仅在太阳物理球体半径外平滑扩散
        float d = max(dist - coreRadiusRatio, 0.0);
        // 指数平滑衰减，模拟恒星高能等离子体密度随距离的自然跌落
        float corona = exp(-d * 5.8);

        // 动态日冕射线流束 (Coronal Streamers & Magnetic Flares)
        float angle = atan(centerOffset.y, centerOffset.x);
        float streamer = 0.82 + 0.18 * sin(angle * 8.0 + time * 0.35) * sin(angle * 5.0 - time * 0.2);
        streamer += 0.08 * sin(angle * 19.0 - time * 0.6);

        // 在到达边界之前平稳归零，彻底根除任何可见的硬切边界
        float edgeFade = 1.0 - smoothstep(0.52, 1.0, dist);

        float alpha = corona * streamer * edgeFade;
        if (alpha < 0.002) discard;

        // 内层明亮炽金白，外层漫射金橙色
        vec3 col = mix(coronaColor * 1.5, coreGlowColor * 2.4, exp(-d * 14.0));
        gl_FragColor = vec4(col, alpha * 0.9);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.DoubleSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

