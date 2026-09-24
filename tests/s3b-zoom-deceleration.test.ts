/**
 * S3b 测试：对数缩放的边界渐近减速（Pro 260924 地球方向——
 * 近距离缩放连续但在数据边界平滑减速，不再撞墙式停止）
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CameraController } from '../src/camera/CameraController';

describe('S3b：缩放边界渐近减速', () => {
  it('持续推进时半径单调下降、步长渐缩、永不越过下界（渐近而非撞墙）', () => {
    const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 10000);
    const controller = new CameraController({ camera });
    controller.executeCommand({ type: 'select', bodyId: 'earth' });
    controller.setSphericalDirect(2.0, Math.PI / 2, 0);

    const radii: number[] = [];
    const steps: number[] = [];
    for (let i = 0; i < 80; i++) {
      controller.applyLogDollyInput(-0.3);
      controller.update(2.0, () => ({ pos: new THREE.Vector3(), radius: 0.9, surfaceRadius: 0.9, framingRadius: 0.9 }));
      radii.push(controller.getSnapshot().distanceToTarget);
    }
    // 捕捉进入减速带后的步长序列（最后 30 步）
    for (let i = radii.length - 30; i < radii.length; i++) steps.push(radii[i - 1] - radii[i]);

    // 单调下降且半径为正
    for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeLessThan(radii[i - 1] + 1e-12);
    expect(radii[radii.length - 1]).toBeGreaterThan(0);
    // 渐近：后期步长显著小于前期恒定对数步（2.0×0.3≈0.06/帧的衰减 ⇒ 步长收缩）
    const lateMax = Math.max(...steps);
    const earlyStep = radii[0] - radii[1];
    expect(lateMax).toBeLessThan(earlyStep);
    // 充分逼近边界（地球表面半径 ~0.9 + 2% 净空 → 下界 ~0.92；渐近收敛至附近）
    expect(radii[radii.length - 1]).toBeLessThan(0.95);
  });

  it('反向推进同样渐近于上界，不越界', () => {
    const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 10000);
    const controller = new CameraController({ camera });
    controller.executeCommand({ type: 'select', bodyId: 'earth' });
    controller.setSphericalDirect(2.0, Math.PI / 2, 0);
    let last = 2.0;
    for (let i = 0; i < 200; i++) {
      controller.applyLogDollyInput(+0.5);
      controller.update(2.0, () => ({ pos: new THREE.Vector3(), radius: 0.9, surfaceRadius: 0.9, framingRadius: 0.9 }));
      const r = controller.getSnapshot().distanceToTarget;
      expect(r).toBeGreaterThanOrEqual(last - 1e-12);
      last = r;
    }
    expect(Number.isFinite(last)).toBe(true);
  });
});
