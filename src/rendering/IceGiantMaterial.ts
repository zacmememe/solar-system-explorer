/**
 * 冰巨星专属天体物理着色材质 (IceGiantMaterial)
 * 专为天王星 (Uranus) 与海王星 (Neptune) 打造：
 * 1. 甲烷 (CH4) 分子选择性光谱吸收与深邃 Rayleigh 散射模型；
 * 2. 天王星淡天青玉色 (Aquamarine Cyan) 与海王星皇家钴蓝 (Royal Azure Blue) 光谱调校；
 * 3. 海王星高空甲烷白色冰晶羽状卷云 (Methane Cirrus Glint) 动态识别与提亮；
 * 4. 冰巨星 Minnaert 边缘柔和变暗 (Limb Darkening) 与平滑晨昏过渡；
 * 5. 教学提亮支持 (teachingLight)，开灯清晰辨识微弱纬度带与极地烟雾帽。
 */

import * as THREE from 'three';

export interface IceGiantMaterialUniforms {
  [key: string]: THREE.IUniform<any>;
  planetTexture: { value: THREE.Texture | null };
  sunDirection: { value: THREE.Vector3 };
  teachingLight: { value: number };
  isUranus: { value: number }; // 1.0 为天王星，0.0 为海王星
}

export function createIceGiantMaterial(
  planetTex: THREE.Texture,
  planetKind: 'uranus' | 'neptune'
): THREE.ShaderMaterial {
  const uniforms: IceGiantMaterialUniforms = {
    planetTexture: { value: planetTex },
    sunDirection: { value: new THREE.Vector3(1, 0, 0).normalize() },
    teachingLight: { value: 0.0 },
    isUranus: { value: planetKind === 'uranus' ? 1.0 : 0.0 },
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
      uniform sampler2D planetTexture;
      uniform vec3 sunDirection;
      uniform float teachingLight;
      uniform float isUranus;

      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      void main() {
        vec3 N = normalize(vNormal);
        vec3 L = normalize(sunDirection);
        vec3 V = normalize(cameraPosition - vWorldPosition);

        vec4 rawTex = texture2D(planetTexture, vUv);

        // 1. 几何光照与冰巨星气态厚重大气多重散射
        float NdotL = dot(N, L);
        float NdotV = max(dot(N, V), 0.0);
        float sunLit = max(NdotL, 0.0);

        // 气态多重散射与 Minnaert 边缘柔和变暗 (保持向阳面通透高亮)
        float limbDarkening = mix(0.68, 1.0, pow(clamp(NdotV, 0.0, 1.0), 0.28));
        float diffuseShading = (pow(sunLit, 0.85) * 0.82 + 0.18) * limbDarkening;

        // =========================================================================
        // 天王星 (Uranus) 真实天体物理模型：
        // 1. 明亮光化学极地烟雾帽 (Polar Photochemical Smog Hood / Cap - HST & JWST 观测)
        // 2. 严格平行于立式赤道/环面的细腻同心多频喷流明暗层理 (Zonal Jet Streams)
        // 3. 羊脂玉般通透温润的淡天青翡色 (Aquamarine Cyan Jade)
        // =========================================================================
        float lat = abs(vUv.y - 0.5) * 2.0; // 0.0 为赤道，1.0 为两极

        // A. 极地烟雾帽 (极昼极夜光化学烃类产物，高反照率微暖玉青色)
        float polarHood = smoothstep(0.35, 0.90, lat);
        vec3 polarHoodColor = vec3(0.78, 0.95, 0.94);

        // B. 同心同纬多频喷流明暗条带 (严格平行于立式赤道/光环平面，层理细腻自然)
        float band1 = cos(vUv.y * 31.415) * 0.048;  // 5 对主喷流带
        float band2 = sin(vUv.y * 62.830) * 0.026;  // 10 对次级喷流
        float band3 = cos(vUv.y * 125.66) * 0.015;  // 细微层理
        float band4 = sin(vUv.y * 251.32) * 0.008;  // 极细高阶气溶胶带
        float zonalBanding = band1 + band2 + band3 + band4;

        // C. 天王星地表纹理综合合成 (绝无人工点阵，纯净自然玉润)
        vec3 uranusBase = rawTex.rgb * (1.0 + zonalBanding);
        uranusBase = mix(uranusBase, polarHoodColor, polarHood * 0.36);
        vec3 uranusColor = mix(uranusBase, vec3(0.52, 0.88, 0.92), 0.06);

        // =========================================================================
        // 海王星 (Neptune) 真实天体物理模型：
        // 1. 标志性大暗斑 (Great Dark Spot) 反气旋深渊核加深与层叠涡旋
        // 2. 伴生滑行者 (Scooter) 与高空甲烷白色冰晶羽状卷云高反照率漫散射提亮
        // 3. 太阳系最强超音速喷流条带 (Supersonic Zonal Jet Belts) 自然原画保真
        // =========================================================================
        float texLuma = dot(rawTex.rgb, vec3(0.299, 0.587, 0.114));

        // A. 局部大暗斑涡旋深渊核 (Deep Abyssal Indigo Core)
        // 提取原贴图中 luma < 0.46 的深色反气旋洼地，加深至深邃神秘的冷夜暗靛蓝
        float darkSpotFactor = smoothstep(0.48, 0.38, texLuma);
        vec3 darkSpotTone = vec3(0.08, 0.16, 0.44);
        vec3 neptuneBase = mix(rawTex.rgb, darkSpotTone, darkSpotFactor * 0.55);

        // B. 滑行者亮白甲烷冰晶卷云 (High-Albedo Cirrus Scooter)
        // 提取原贴图中 luma > 0.60 的高空卷云，赋予纯净明亮的冷白高散射反照率
        float cirrusFactor = smoothstep(0.60, 0.75, texLuma);
        vec3 cirrusGlint = vec3(0.96, 0.98, 1.05) * 1.35;
        vec3 neptuneColor = mix(neptuneBase, cirrusGlint, cirrusFactor * 0.92);

        // 3. 选定当前冰巨星地表色
        vec3 surfaceColor = mix(neptuneColor, uranusColor, isUranus);

        // 4. 柔和气态晨昏过渡 (Soft Atmosphere Terminator)
        float terminator = smoothstep(-0.06, 0.12, NdotL);

        // 5. 教学补光模式 (teachingLight)
        vec3 deepSpaceAmbient = mix(vec3(0.008, 0.012, 0.024), vec3(0.010, 0.018, 0.022), isUranus);
        vec3 teachingAmbient = surfaceColor * 0.42;
        vec3 ambientTerm = mix(deepSpaceAmbient, teachingAmbient, teachingLight);

        // 6. 高层甲烷大气冷光边缘微晕 (Cold Methane Rim Scattering)
        float rim = pow(1.0 - clamp(NdotV, 0.0, 1.0), 3.4);
        vec3 rimTint = mix(vec3(0.35, 0.65, 1.0), vec3(0.60, 0.92, 0.98), isUranus);
        vec3 rimGlow = rimTint * (rim * 0.26 * terminator);

        // 7. 综合最终物理色彩合成
        vec3 litColor = surfaceColor * diffuseShading;
        vec3 finalColor = litColor * terminator + ambientTerm * (1.0 - terminator * 0.82) + rimGlow;

        gl_FragColor = vec4(finalColor, 1.0);
      }
    `,

  });
}
