/**
 * 伽利略卫星表面展示材质：现有拼图、近似冰/岩反射与教学补光。
 * 不从暗像素猜测熔岩湖，不叠加假极冠；Io 使用增强色观测拼图，其余仍是程序纹理。
 */

import * as THREE from 'three';

export interface GalileanMoonUniforms {
  [key: string]: THREE.IUniform<any>;
  moonTexture: { value: THREE.Texture | null };
  sunDirection: { value: THREE.Vector3 };
  teachingLight: { value: number };
}

// ---------------------------------------------------------------------------
// 1. 木卫一 (Io) — 增强色表面与近似反射
// ---------------------------------------------------------------------------
export function createIoMaterial(ioTex: THREE.Texture): THREE.ShaderMaterial {
  const uniforms: GalileanMoonUniforms = {
    moonTexture: { value: ioTex },
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

        // 2. Lommel-Seeliger 富硫粉尘与多孔二氧化硫霜雪漫散射
        float lommelSeeliger = sunLit / (sunLit + NdotV);
        float regolithDiffuse = mix(pow(sunLit, 0.85) * 0.80 + 0.20 * sunLit, lommelSeeliger * 1.35, 0.50);

        // 3. 满月冲日效应 (Opposition Surge)
        float cosPhase = max(dot(L, V), 0.0);
        float oppositionSurge = pow(cosPhase, 20.0) * 0.28 * sunLit;
        float totalDiffuse = regolithDiffuse + oppositionSurge;

        // 4. 真空剃刀晨昏线 (Razor-Edge Terminator)
        float terminator = smoothstep(-0.006, 0.012, NdotL);

        // 5. 白昼向阳面受光色彩
        vec3 litColor = rawTex.rgb * totalDiffuse;

        // Albedo alone cannot identify a hot lava lake. No thermal map is loaded.
        // 7. 教学暗部补光 (teachingLight) 联动
        vec3 deepSpaceAmbient = rawTex.rgb * 0.02;
        vec3 teachingAmbient = rawTex.rgb * 0.42;
        vec3 ambientTerm = mix(deepSpaceAmbient, teachingAmbient, teachingLight);

        vec3 finalColor = litColor * terminator + ambientTerm * (1.0 - terminator * 0.85);

        gl_FragColor = vec4(finalColor, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

// ---------------------------------------------------------------------------
// 2. 木卫二 (Europa) — 纯净水冰球、双脊冰裂痕与菲涅尔镜面微光材质
// ---------------------------------------------------------------------------
export function createEuropaMaterial(europaTex: THREE.Texture): THREE.ShaderMaterial {
  const uniforms: GalileanMoonUniforms = {
    moonTexture: { value: europaTex },
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
        vec3 H = normalize(L + V);

        vec4 rawTex = texture2D(moonTexture, vUv);

        // 1. 基础几何与光照
        float NdotL = dot(N, L);
        float NdotV = max(dot(N, V), 0.001);
        float sunLit = max(NdotL, 0.0);

        // 2. 纯净水冰壳高反照率漫散射 (高透散射与微观冰粒回散射)
        float iceDiffuse = pow(sunLit, 0.90) * 0.88 + 0.12 * sunLit;

        // 3. 满月冲日激增 (Opposition Surge)
        float cosPhase = max(dot(L, V), 0.0);
        float oppositionSurge = pow(cosPhase, 24.0) * 0.25 * sunLit;
        float totalDiffuse = iceDiffuse + oppositionSurge;

        // 4. 水冰微晶平滑菲涅尔镜面高光 (Ice Specular & Fresnel Sheen)
        // 纯净冰原 (高亮浅灰白) 具备平滑高光；红褐色水合盐裂隙 (Lineae) 与柯纳马拉混沌多孔粗糙，高光减弱
        float luma = dot(rawTex.rgb, vec3(0.299, 0.587, 0.114));
        float cleanIceFactor = smoothstep(0.48, 0.88, luma);

        float NdotH = max(dot(N, H), 0.0);
        float specular = pow(NdotH, 28.0) * 0.22 * cleanIceFactor * sunLit;
        float fresnel = pow(1.0 - NdotV, 4.0) * 0.14 * cleanIceFactor * sunLit;

        // 5. 真空剃刀晨昏线 (Razor-Edge Terminator)
        float terminator = smoothstep(-0.005, 0.010, NdotL);

        // 6. 受光色彩合成
        vec3 litColor = rawTex.rgb * totalDiffuse + vec3(0.90, 0.95, 1.0) * (specular + fresnel);

        // 7. 教学暗部补光
        vec3 deepSpaceAmbient = rawTex.rgb * 0.025;
        vec3 teachingAmbient = rawTex.rgb * 0.45;
        vec3 ambientTerm = mix(deepSpaceAmbient, teachingAmbient, teachingLight);

        vec3 finalColor = litColor * terminator + ambientTerm * (1.0 - terminator * 0.85);

        gl_FragColor = vec4(finalColor, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

// ---------------------------------------------------------------------------
// 3. 木卫三 (Ganymede) — 双重地质反照率分异与极地冰帽材质
// ---------------------------------------------------------------------------
export function createGanymedeMaterial(ganymedeTex: THREE.Texture): THREE.ShaderMaterial {
  const uniforms: GalileanMoonUniforms = {
    moonTexture: { value: ganymedeTex },
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

        // 1. 入射角与视线
        float NdotL = dot(N, L);
        float NdotV = max(dot(N, V), 0.001);
        float sunLit = max(NdotL, 0.0);

        // 2. 双重地质单元漫散射：
        // 伽利略区 (Galileo Regio) 等古老重撞击暗区采用 Lommel-Seeliger 多孔冰岩散射；
        // 乌鲁克槽沟 (Uruk Sulci) 等新鲜断层冰槽具备高反照率微光
        float luma = dot(rawTex.rgb, vec3(0.299, 0.587, 0.114));
        float brightGrooveFactor = smoothstep(0.36, 0.65, luma);

        float lommelSeeliger = sunLit / (sunLit + NdotV);
        float darkDiffuse = lommelSeeliger * 1.32;
        float grooveDiffuse = pow(sunLit, 0.88) * 0.85 + 0.15 * sunLit;
        float surfaceDiffuse = mix(darkDiffuse, grooveDiffuse, brightGrooveFactor);

        // 3. 满月冲日效应
        float cosPhase = max(dot(L, V), 0.0);
        float oppositionSurge = pow(cosPhase, 22.0) * 0.26 * sunLit;
        float totalDiffuse = surfaceDiffuse + oppositionSurge;

        // 4. 极地带电粒子诱导霜冻冰帽增强 (两极纬度强化微晶散射)
        float polarDist = abs(vUv.y - 0.5) * 2.0; // 0=赤道，1=极地
        float polarCap = smoothstep(0.55, 0.88, polarDist) * 0.12 * sunLit;

        // 5. 真空剃刀晨昏线
        float terminator = smoothstep(-0.005, 0.010, NdotL);

        // 6. 受光色彩合成
        vec3 surfaceColor = rawTex.rgb;
        vec3 litColor = surfaceColor * totalDiffuse;

        // 7. 教学暗部补光
        vec3 deepSpaceAmbient = surfaceColor * 0.025;
        vec3 teachingAmbient = surfaceColor * 0.44;
        vec3 ambientTerm = mix(deepSpaceAmbient, teachingAmbient, teachingLight);

        vec3 finalColor = litColor * terminator + ambientTerm * (1.0 - terminator * 0.85);

        gl_FragColor = vec4(finalColor, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

// ---------------------------------------------------------------------------
// 4. 木卫四 (Callisto) — 撞击坑饱和古老地壳与瓦尔哈拉巨型盆地材质
// ---------------------------------------------------------------------------
export function createCallistoMaterial(callistoTex: THREE.Texture): THREE.ShaderMaterial {
  const uniforms: GalileanMoonUniforms = {
    moonTexture: { value: callistoTex },
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

        // 1. 入射角与视线几何
        float NdotL = dot(N, L);
        float NdotV = max(dot(N, V), 0.001);
        float sunLit = max(NdotL, 0.0);

        // 2. 太阳系最古老多孔冰碳混合表土 Lommel-Seeliger 漫散射
        float lommelSeeliger = sunLit / (sunLit + NdotV);
        float regolithDiffuse = mix(pow(sunLit, 0.90) * 0.80 + 0.20 * sunLit, lommelSeeliger * 1.38, 0.65);

        // 3. 满月冲日效应
        float cosPhase = max(dot(L, V), 0.0);
        float oppositionSurge = pow(cosPhase, 20.0) * 0.24 * sunLit;
        float totalDiffuse = regolithDiffuse + oppositionSurge;

        // 4. 瓦尔哈拉同心断裂带与古老退化撞击坑边缘冰霜提亮
        // 坑缘与同心脊经过亿万年升华积留微量高反照率水冰，产生微弱晶体反光
        float luma = dot(rawTex.rgb, vec3(0.299, 0.587, 0.114));
        float frostRim = smoothstep(0.40, 0.72, luma) * 0.15;

        // 5. 真空剃刀晨昏线
        float terminator = smoothstep(-0.006, 0.010, NdotL);

        // 6. 受光色彩
        vec3 surfaceColor = rawTex.rgb;
        vec3 litColor = surfaceColor * totalDiffuse;

        // 7. 教学暗部补光
        vec3 deepSpaceAmbient = surfaceColor * 0.025;
        vec3 teachingAmbient = surfaceColor * 0.42;
        vec3 ambientTerm = mix(deepSpaceAmbient, teachingAmbient, teachingLight);

        vec3 finalColor = litColor * terminator + ambientTerm * (1.0 - terminator * 0.85);

        gl_FragColor = vec4(finalColor, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
