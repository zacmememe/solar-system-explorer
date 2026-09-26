/**
 * 不规则卫星的三轴外形与程序地貌示意。
 * 轴长受目录约束，坑槽为近似造型，不是探测器形状模型或实测高程。
 */

import * as THREE from 'three';
import type { CelestialBodyData } from '../contracts/body';

export function buildIrregularMoonGeometry(
  data: CelestialBodyData,
  displayRadius: number
): THREE.BufferGeometry {
  // 基础高细分球面网格
  const geo = new THREE.SphereGeometry(displayRadius, 48, 36);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();

  // 1. 三轴主轴尺寸比例解算
  let scaleX = 1.0, scaleY = 1.0, scaleZ = 1.0;
  if (data.dimensionsKm && data.dimensionsKm.length === 3) {
    const [dx, dy, dz] = data.dimensionsKm;
    const avg = (dx + dy + dz) / 3.0;
    scaleX = dx / avg;
    scaleY = dy / avg;
    scaleZ = dz / avg;
  } else {
    // 默认不规则比例
    scaleX = 1.35; scaleY = 1.05; scaleZ = 0.85;
  }

  const isPhobos = data.id === 'phobos';
  const isDeimos = data.id === 'deimos';
  const isAmalthea = data.id === 'amalthea';
  const isHyperion = data.id === 'hyperion';
  const isProteus = data.id === 'proteus';

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);

    // 应用三轴非对称拉伸
    v.x *= scaleX;
    v.y *= scaleY;
    v.z *= scaleZ;

    const norm = v.clone().normalize();

    // 2. 注入多频分形起伏与小行星切面地貌
    let displacement = 0;
    displacement += Math.sin(norm.x * 4.8 + norm.y * 3.5) * Math.cos(norm.z * 4.2) * 0.085;
    displacement += Math.sin(norm.x * 10.5 + norm.z * 9.2) * 0.038;

    if (isPhobos) {
      // 斯蒂克尼巨型陨石坑 (Stickney Crater: 位于 +X 侧，占据火卫一半球巨大凹陷)
      const stickneyDir = new THREE.Vector3(0.95, 0.15, -0.25).normalize();
      const dotS = norm.dot(stickneyDir);
      if (dotS > 0.62) {
        const pitDepth = Math.pow((dotS - 0.62) / 0.38, 1.4) * 0.28;
        displacement -= pitDepth;
      }
      // 放射状应力条沟起伏
      const groove = Math.sin(norm.y * 24.0 + norm.z * 18.0) * 0.001;
      displacement += groove;
    } else if (isDeimos) {
      // 火卫二厚风化层光滑包络（轻度圆润化起伏）
      displacement *= 0.65;
    } else if (isAmalthea) {
      // 木卫五：极度拉长且两端微收窄的“大红薯”
      const taper = 1.0 - Math.abs(norm.x) * 0.22;
      v.y *= taper;
      v.z *= taper;
      displacement += Math.sin(norm.x * 6.0) * 0.05;
    } else if (isHyperion) {
      // 土卫七：高孔隙率“蜂窝海绵状”深孔与锐利坑边缘
      const sponge1 = Math.sin(norm.x * 12.0) * Math.sin(norm.y * 12.0) * Math.sin(norm.z * 12.0);
      if (sponge1 < -0.15) {
        displacement += sponge1 * 0.16;
      }
      const sponge2 = Math.cos(norm.x * 22.0 + 1.2) * Math.cos(norm.z * 22.0);
      if (sponge2 < -0.3) {
        displacement += sponge2 * 0.08;
      }
    } else if (isProteus) {
      // 海卫八：多面方盒巨石形态（四方高次多项式切平棱角）
      const boxFactor = Math.pow(norm.x, 6) + Math.pow(norm.y, 6) + Math.pow(norm.z, 6);
      displacement += (boxFactor - 0.45) * 0.09;
      // 法罗斯巨坑 (Pharos Crater)
      const pharosDir = new THREE.Vector3(-0.85, 0.3, 0.4).normalize();
      const dotP = norm.dot(pharosDir);
      if (dotP > 0.68) {
        displacement -= Math.pow((dotP - 0.68) / 0.32, 1.6) * 0.22;
      }
    }

    v.addScaledVector(norm, displayRadius * displacement);
    pos.setXYZ(i, v.x, v.y, v.z);
  }

  geo.computeVertexNormals();
  return geo;
}
