import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CameraController } from '../src/camera/CameraController';

describe('CameraController 单一控制与防篡改测试', () => {
  function createTestRig() {
    const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 2000);
    const controller = new CameraController({ camera });
    const getBodyPos = (id: string) => {
      if (id === 'moon') return { pos: new THREE.Vector3(384.4, 0, 0), radius: 1.737 };
      return { pos: new THREE.Vector3(0, 0, 0), radius: 6.371 };
    };
    return { camera, controller, getBodyPos };
  }

  it('CAM-01: 选择天体只更新 selectedBodyId，绝不擅自移动相机或启动飞行', () => {
    const { controller, camera } = createTestRig();
    const initialPos = camera.position.clone();

    controller.executeCommand({ type: 'select', bodyId: 'moon' });
    const snapshot = controller.getSnapshot();

    expect(snapshot.selectedBodyId).toBe('moon');
    expect(snapshot.targetBodyId).toBe('earth'); // 仍在观察地球
    expect(snapshot.isTransitioning).toBe(false);
    expect(camera.position.distanceTo(initialPos)).toBeCloseTo(0, 4);
  });

  it('CAM-02: 空闲等待绝不自动回正视角或重设目标', () => {
    const { controller, camera, getBodyPos } = createTestRig();

    // 用户主动旋转到一个特定方位
    controller.executeCommand({ type: 'orbit', deltaPhi: 0.3, deltaTheta: 0.5 });
    const userPos = camera.position.clone();

    // 模拟等待 120 秒（120 帧，每帧 1 秒）
    for (let i = 0; i < 120; i++) {
      controller.update(1.0, getBodyPos);
    }

    // 视角必须完全保持，严禁回正
    expect(camera.position.x).toBeCloseTo(userPos.x, 3);
    expect(camera.position.y).toBeCloseTo(userPos.y, 3);
    expect(camera.position.z).toBeCloseTo(userPos.z, 3);
    expect(controller.getSnapshot().isTransitioning).toBe(false);
  });

  it('CAM-03: 飞行进行到一半时用户拖动，飞行立即取消，控制权归还用户', () => {
    const { controller, getBodyPos } = createTestRig();

    // 发起飞往月球
    controller.executeCommand({ type: 'flyTo', bodyId: 'moon', durationSec: 3.0 });
    expect(controller.getSnapshot().isTransitioning).toBe(true);
    expect(controller.getSnapshot().mode).toBe('TRANSITION');

    // 飞行 1 秒（达到约 33% 进度）
    controller.update(1.0, getBodyPos);
    expect(controller.getSnapshot().isTransitioning).toBe(true);

    // 用户拖动鼠标（触发 orbit 命令）
    controller.executeCommand({ type: 'orbit', deltaPhi: 0.1, deltaTheta: 0.2 });

    // 飞行必须瞬间被取消！
    expect(controller.getSnapshot().isTransitioning).toBe(false);
    expect(controller.getSnapshot().mode).toBe('ORBIT_TARGET');

    // 后续继续更新也不会恢复旧飞行
    controller.update(1.0, getBodyPos);
    expect(controller.getSnapshot().isTransitioning).toBe(false);
  });

  it('CAM-04: 命令具有单调递增 commandId，防止并发竞态', () => {
    const { controller } = createTestRig();

    const t1 = controller.executeCommand({ type: 'select', bodyId: 'earth' });
    const t2 = controller.executeCommand({ type: 'flyTo', bodyId: 'moon' });
    const t3 = controller.executeCommand({ type: 'cancelFlight' });

    expect(t2).toBeGreaterThan(t1);
    expect(t3).toBeGreaterThan(t2);
    expect(controller.getSnapshot().commandId).toBe(t3);
  });
});
