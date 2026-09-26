/**
 * F-LUNAR-LIMB-01/R2：挖孔补片专用材质工厂。
 *
 * P1 修正（review-8deebfc）：ShaderMaterial.clone 的 cloneUniforms 会深拷贝
 * uniform 对象——补片的 sunDirection/teachingLight/纹理若留在克隆副本里，
 * 引擎逐帧只更新本体材质时补片光照会冻结在克隆时刻（太阳方位/补光开关后
 * 补片与四周失配）。这里把除"补片自身透明度"以外的 uniform 全部改回与本体
 * 共享同一对象：引擎更新本体 uniform（对象引用不变、只写 value）即自动同步
 * 到补片。uOpacity（月）/layerOpacity（火）保持独立，供补片随细层渐显淡出。
 */

import * as THREE from 'three';

export const PATCH_OPAQUE_KEYS = ['uOpacity', 'layerOpacity'] as const;

export function makeHolePatchMaterial<T extends THREE.Material>(src: T): T {
  const m = src.clone() as T;
  m.transparent = true;
  m.depthWrite = false;
  const srcUniforms = src instanceof THREE.ShaderMaterial ? src.uniforms : undefined;
  const uniforms = m instanceof THREE.ShaderMaterial ? m.uniforms : undefined;
  if (srcUniforms && uniforms) {
    for (const key of Object.keys(srcUniforms)) {
      if (!(PATCH_OPAQUE_KEYS as readonly string[]).includes(key)) {
        // 共享 uniform 对象引用：本体更新 value 时补片同步生效
        uniforms[key] = srcUniforms[key];
      }
    }
  }
  return m;
}

/** Shader opacity if present; ordinary fallback materials use Material.opacity. */
export function patchOpacityUniform(m: THREE.Material | THREE.Material[] | undefined): THREE.IUniform<any> | null {
  const single = Array.isArray(m) ? m[0] : m;
  if (!single) return null;
  const u = (single as THREE.ShaderMaterial).uniforms;
  if (!u) return null;
  return u.uOpacity ?? u.layerOpacity ?? null;
}

/**
 * F-SURFACE-BLEND-01：细层表面（L1/rim/skirt/DTM 窗）统一渐显门控。
 * MoonMaterial 着色的层写 uOpacity uniform（同本体着色器契约）；
 * 既有 MeshStandardMaterial 层保持 opacity 字段，行为不变。
 */
export function setSurfaceLayerOpacity(m: THREE.Material, o: number): void {
  const opacity = Number.isFinite(o) ? THREE.MathUtils.clamp(o, 0, 1) : 0;
  const u = patchOpacityUniform(m);
  if (u) u.value = opacity;
  m.opacity = opacity;
  m.transparent = opacity < 1 || !m.depthWrite;
}
