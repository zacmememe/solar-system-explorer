/**
 * 太阳可见光外观近似：保留来源纹理的细节与边缘变暗；采用中性亮色。
 * 日冕为克制的展示光晕，不是校准辐射或光球对流模拟。
 */

import * as THREE from 'three';

export function createSunMaterial(sunTexture: THREE.Texture | null): THREE.ShaderMaterial {
  if (sunTexture) {
    sunTexture.wrapS = THREE.RepeatWrapping;
    sunTexture.wrapT = THREE.ClampToEdgeWrapping;
  }

  return new THREE.ShaderMaterial({
    uniforms: {
      sunTexture: { value: sunTexture },
      hasSurfaceMap: { value: sunTexture ? 1.0 : 0.0 },
      time: { value: 0.0 },
      glowColor: { value: new THREE.Color(1.0, 0.72, 0.40) },
      coreColor: { value: new THREE.Color(1.0, 0.93, 0.78) },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      varying vec3 vSurfaceDirection;

      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vSurfaceDirection = normalize(position);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      #include <common>

      uniform sampler2D sunTexture;
      uniform float hasSurfaceMap;
      uniform vec3 glowColor;
      uniform vec3 coreColor;
      uniform float time;

      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      varying vec3 vSurfaceDirection;

      // Body-fixed, seamless procedural granulation. It is illustrative, not
      // a solar observation or a fluid simulation; derivative filtering avoids
      // fine noise sparkling when the Sun shrinks or grazes the view.
      float hash3(vec3 p) {
        p = fract(p * 0.3183099 + vec3(0.13, 0.37, 0.71));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }
      float granulation(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash3(i), hash3(i+vec3(1,0,0)), f.x),
                       mix(hash3(i+vec3(0,1,0)), hash3(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash3(i+vec3(0,0,1)), hash3(i+vec3(1,0,1)), f.x),
                       mix(hash3(i+vec3(0,1,1)), hash3(i+vec3(1,1,1)), f.x), f.y), f.z);
      }
      float spot(vec3 direction, vec3 centre, float radius) {
        vec3 axis = normalize(centre);
        vec3 delta = direction - axis;
        float d = length(delta);
        float aa = max(fwidth(d), 0.0001);
        if (d > radius * 1.5 + aa) return 1.0;
        vec3 tangent = normalize(cross(vec3(0,1,0), axis));
        vec3 bitangent = cross(axis, tangent);
        vec2 local = vec2(dot(delta,tangent)*1.12, dot(delta,bitangent)*0.90);
        // Irregular umbra/penumbra boundaries, not concentric decal circles.
        float uneven = 0.86 + 0.28 * granulation(direction * 125.0);
        d = length(local) * uneven;
        float softness = max(aa, radius * 0.12);
        float penumbra = 1.0 - smoothstep(radius-softness, radius+softness, d);
        float umbra = 1.0 - smoothstep(radius*0.43-softness, radius*0.43+softness, d);
        float angle = atan(local.y, local.x);
        float fibres = sin(angle*37.0 + uneven*12.0) * (1.0-smoothstep(0.02,0.10,aa/radius));
        return 1.0 - 0.33 * penumbra - 0.56 * umbra + 0.025 * fibres * penumbra * (1.0-umbra);
      }

      void main() {
        // SSS is an illustrative surface map, not a measured white-light image.
        // Use its luminance, not its orange display palette. The body already
        // rotates in simulation time; do not scroll UVs a second time.
        vec4 texColor = texture2D(sunTexture, vUv);

        // 视线夹角与边缘昏暗（Limb Darkening）
        vec3 viewDir = normalize(vViewPosition);
        float dotNV = max(dot(normalize(vNormal), viewDir), 0.0);

        // A linear limb-darkening approximation keeps the photosphere luminous
        // on every side, but avoids the old nearly uniform white disk. These
        // display coefficients are not a calibrated wavelength-dependent fit.
        float limbFactor = 0.30 + 0.70 * dotNV;
        float luminance = mix(0.45, dot(texColor.rgb, vec3(0.2126, 0.7152, 0.0722)), hasSurfaceMap);
        vec3 direction = normalize(vSurfaceDirection);
        vec3 cells = direction * 420.0;
        float footprint = max(length(dFdx(cells)), length(dFdy(cells)));
        float grainWeight = 1.0 - smoothstep(0.65, 2.2, footprint);
        float grain = mix(1.0, 0.86 + 0.28 * granulation(cells), grainWeight);
        // The SSS map's large bright swirls must not become white continents.
        // Keep only gentle broad modulation under the fine photosphere texture.
        float detail = (0.87 + 0.22 * luminance) * grain;
        // Illustrative active-region groups; no claim about current positions,
        // sizes or activity. Unlike UV decals these remain smooth at the seam.
        float spots = spot(direction, vec3(0.93,0.22,-0.32), 0.029)
                    * spot(direction, vec3(0.90,0.235,-0.365), 0.016)
                    * spot(direction, vec3(0.67,-0.24,-0.70), 0.022)
                    * spot(direction, vec3(0.70,-0.23,-0.66), 0.011)
                    * spot(direction, vec3(-0.70,0.30,0.64), 0.024)
                    * spot(direction, vec3(-0.74,0.31,0.59), 0.012);
        vec3 tint = mix(glowColor, coreColor, smoothstep(0.0, 0.65, dotNV));
        vec3 finalColor = tint * (1.12 * limbFactor * detail * spots);

        gl_FragColor = vec4(finalColor, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * 局部曝光辉光示意，不代表可见光下同时可见的真实日冕亮度。
 * 保留世界深度遮挡，避免太阳/辉光穿过前景行星；不改变全局曝光。
 */
export function createSunCoronaMaterial(coreRadiusRatio: number = 0.45): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      coronaColor: { value: new THREE.Color(1.0, 0.78, 0.48) },
      coreGlowColor: { value: new THREE.Color(1.0, 0.95, 0.83) },
      coreRadiusRatio: { value: coreRadiusRatio },
      time: { value: 0.0 },
    },
    vertexShader: `
      varying vec2 vUv;
      uniform float coreRadiusRatio;

      void main() {
        vUv = uv;
        // 面向相机的公告板变换：以太阳中心为原点，在观察空间直接平移四边形顶点
        vec4 mvPosition = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        // Billboard orientation is camera-facing, but its size must still follow
        // the body's world scale when the Sun is projected into a distant sky.
        vec2 worldScale = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
        // At close range a sphere's apparent limb is wider than a disk at its
        // centre plane. Follow that angular radius so a compact glow does not
        // disappear behind the photosphere when zooming in. The quad vertices
        // are +/- halfWidth; keep its depth in the ordinary world pass.
        float radius = abs(position.x) * worldScale.x * coreRadiusRatio;
        float distanceToCenter = length(mvPosition.xyz);
        float tangentScale = distanceToCenter / sqrt(max(
          distanceToCenter * distanceToCenter - radius * radius, radius * radius * 0.01));
        mvPosition.xy += position.xy * worldScale * clamp(tangentScale, 1.0, 10.0);
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
        // Concentrate the visual glow at the limb, with a faint broad tail.
        // This is an exposure cue, not a plasma-density calculation.
        float corona = 0.82 * exp(-d * 32.0) + 0.18 * exp(-d * 8.0);

        // Subtle illustrative asymmetry; not observed magnetic structures.
        float angle = atan(centerOffset.y, centerOffset.x);
        float streamer = 0.82 + 0.18 * sin(angle * 8.0 + time * 0.35) * sin(angle * 5.0 - time * 0.2);
        streamer += 0.08 * sin(angle * 19.0 - time * 0.6);

        // 在到达边界之前平稳归零，彻底根除任何可见的硬切边界
        float edgeFade = 1.0 - smoothstep(0.52, 1.0, dist);

        float alpha = corona * streamer * edgeFade;
        if (alpha < 0.002) discard;

        vec3 col = mix(coronaColor, coreGlowColor * 1.8, exp(-d * 22.0));
        gl_FragColor = vec4(col, alpha * 0.32);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.DoubleSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    depthWrite: false,
  });
}
