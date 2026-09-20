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
      uniform sampler2D sunTexture;
      uniform float time;
      uniform vec3 glowColor;
      uniform vec3 coreColor;

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
      }
    `,
  });
}

/**
 * 太阳外侧高能日冕光晕网格材质 (Corona Rim Glow)
 */
export function createSunCoronaMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      coronaColor: { value: new THREE.Color(1.0, 0.55, 0.1) },
      time: { value: 0.0 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewPosition;

      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 coronaColor;
      uniform float time;

      varying vec3 vNormal;
      varying vec3 vViewPosition;

      void main() {
        vec3 viewDir = normalize(vViewPosition);
        float rim = 1.0 - max(dot(vNormal, viewDir), 0.0);
        float pulse = 0.85 + 0.15 * sin(time * 2.0);
        float alpha = pow(rim, 2.5) * 0.8 * pulse;

        if (alpha < 0.01) discard;

        gl_FragColor = vec4(coronaColor * 1.5, alpha);
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}
