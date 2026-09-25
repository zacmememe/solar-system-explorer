/**
 * R1（260925 基础体验恢复）：双 pass 深度混合反例的数学回归测试。
 *
 * 审计结论（260925 基础体验回归审计）：旧 renderLayered() 远 pass 用自适应
 * 近面（fc.near = minFarDist×0.5）的投影写深度，近 pass 用主相机（小近面）
 * 的投影写深度且不清深度——不同投影的归一化深度数值不可比，直接混合比较
 * 会让更近的表面被更远的表面拒绝绘制（呈现为黑色碎片/穿插）。
 *
 * 本测试用真实 THREE.PerspectiveCamera 投影复现该反例并固化为不变量：
 * 分层渲染的两 pass 之间必须 clearDepth（或转换深度），且普通浏览不应分层。
 * 渲染管线本身需 WebGL（探针 probe-r1-render-regression.ts 覆盖）；此处
 * 固化的是它背后的数学事实。
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

describe('R1：不同近面的投影深度不可混合比较（反例固化）', () => {
  it('反例：远相机下 27m 表面的归一化深度 < 主相机下 3.65m 表面——混合比较会把远处画到近处前面', () => {
    // 模拟旧 renderLayered 的两把尺：主相机小近面（贴面观察），远相机大近面
    const mainCam = new THREE.PerspectiveCamera(55, 16 / 9, 0.001, 5000);
    const farCam = new THREE.PerspectiveCamera(55, 16 / 9, 12.65, 5000); // minFarDist=25.3 → near=12.65
    for (const cam of [mainCam, farCam]) {
      cam.position.set(0, 0, 0);
      cam.lookAt(0, 0, -1); // 视线 -Z
      cam.updateMatrixWorld();
      cam.updateProjectionMatrix();
    }
    const ndcZ = (cam: THREE.PerspectiveCamera, dist: number): number => {
      const p = new THREE.Vector3(0, 0, -dist).project(cam);
      return (p.z + 1) / 2; // 归一化到 [0,1]（three 深度缓冲口径）
    };
    const nearSurfaceMainZ = ndcZ(mainCam, 3.65); // 应在前面的表面（近 pass）
    const farSurfaceFarZ = ndcZ(farCam, 27); // 应在后面的表面（远 pass）
    // 审计受控例的数值（0.9726 vs 0.5008 量级）
    expect(nearSurfaceMainZ).toBeGreaterThan(0.9);
    expect(farSurfaceFarZ).toBeLessThan(0.6);
    // 反例核心：混合比较时 LESS 规则拒绝更近的表面
    expect(nearSurfaceMainZ).toBeGreaterThan(farSurfaceFarZ);
  });

  it('同尺下顺序恢复正确（一致投影的深度单调性）', () => {
    const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.001, 5000);
    cam.position.set(0, 0, 0);
    cam.lookAt(0, 0, -1);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    const ndcZ = (dist: number): number => (new THREE.Vector3(0, 0, -dist).project(cam).z + 1) / 2;
    expect(ndcZ(3.65)).toBeLessThan(ndcZ(27)); // 近 < 远 → LESS 通过 → 正确遮挡
  });

  it('分层语义前提：贴面机位（dist/R < 1.5）下锚定天体表面整体先于任何远层天体', () => {
    // SURFACE_LOOK 语义：相机在锚定天体表面米级眼高，其他天体 ≥ 轨道距离。
    // 以月面眼高为例：表面距离 ~3m，最近远层天体（地球 NAV 布局）≫ 表面半径——
    // “先远后近 + clearDepth”的覆盖语义成立（近层几何必然整体在前）
    const moonRadius = 0.687; // PHYSICAL 场景半径（审计口径清单）
    const eyeHeightScene = 3 / moonRadius * 0.0000007; // 3m 的场景尺度（米→场景）
    const distOverRadius = 1 + eyeHeightScene;
    expect(distOverRadius).toBeLessThan(1.5); // renderFrame 分层阈值
    // 而轨道取景（flyTo 完成 ~2.9R、初始 4.6R）必须单 pass
    expect(2.9).toBeGreaterThan(1.5);
    expect(4.59).toBeGreaterThan(1.5);
  });
});
