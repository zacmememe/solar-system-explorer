import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BODIES } from '../src/astronomy/bodies';

describe('批次 B2 地轴分层拓扑与极轴定向数学验证 (Hierarchy Tests)', () => {
  it('HIER-01: 地轴分层架构彻底消除 Euler 旋转顺序导致的极轴进动漂移', () => {
    // 测试常见倾角的天体：地球 (23.44°)、火星 (25.19°)、土星 (26.73°)、天王星 (97.77°)
    const testTilts = [23.44, 25.19, 26.73, 97.77];

    for (const tiltDeg of testTilts) {
      const tiltRad = THREE.MathUtils.degToRad(tiltDeg);

      // 规范重构模型：systemGroup -> poleFrame -> mesh
      const systemGroup = new THREE.Group();
      const poleFrame = new THREE.Group();
      poleFrame.rotation.z = tiltRad;
      systemGroup.add(poleFrame);

      const mesh = new THREE.Mesh();
      poleFrame.add(mesh);

      systemGroup.updateMatrixWorld(true);

      // 测量初始极轴在世界坐标系中的方向
      const initialAxis = new THREE.Vector3(0, 1, 0);
      const qInitial = new THREE.Quaternion();
      mesh.getWorldQuaternion(qInitial);
      initialAxis.applyQuaternion(qInitial).normalize();

      // 在自转 360° 的各个关键相位下采样
      const spinAngles = [
        Math.PI / 4,
        Math.PI / 2,
        Math.PI,
        (3 * Math.PI) / 2,
        2 * Math.PI,
        5.4321,
      ];

      for (const spin of spinAngles) {
        mesh.rotation.y = spin;
        systemGroup.updateMatrixWorld(true);

        const currentAxis = new THREE.Vector3(0, 1, 0);
        const qCurrent = new THREE.Quaternion();
        mesh.getWorldQuaternion(qCurrent);
        currentAxis.applyQuaternion(qCurrent).normalize();

        // 计算当前极轴与初始极轴的夹角 (弧度)
        const dot = Math.min(1.0, Math.max(-1.0, initialAxis.dot(currentAxis)));
        const angleDiffRad = Math.acos(dot);
        const angleDiffDeg = THREE.MathUtils.radToDeg(angleDiffRad);

        // 断言：在任意自转角度下，极轴方向绝对保真，偏转严格为 0 度
        expect(angleDiffDeg).toBeLessThan(1e-5);
      }

      // 对照组实验：如果在单一 mesh 上同时设置 rotation.z 和 rotation.y (Three.js 默认 XYZ 顺序)
      const buggyMesh = new THREE.Mesh();
      buggyMesh.rotation.z = tiltRad;
      buggyMesh.rotation.y = Math.PI / 2; // 自转 90 度
      buggyMesh.updateMatrixWorld(true);

      const buggyAxis = new THREE.Vector3(0, 1, 0);
      const qBuggy = new THREE.Quaternion();
      buggyMesh.getWorldQuaternion(qBuggy);
      buggyAxis.applyQuaternion(qBuggy).normalize();

      const buggyDot = Math.min(1.0, Math.max(-1.0, initialAxis.dot(buggyAxis)));
      const buggyAngleDiffDeg = THREE.MathUtils.radToDeg(Math.acos(buggyDot));

      // 在倾角 >= 23° 时，单一网格自转 90° 必然导致严重极轴偏转 (> 20°)
      if (tiltDeg > 20) {
        expect(buggyAngleDiffDeg).toBeGreaterThan(15.0);
      }
    }
  });

  it('HIER-02: 光环位于 poleFrame 赤道面，法线与极轴恒重合且不受行星自转拖曳', () => {
    const saturnData = BODIES.saturn;
    const tiltRad = THREE.MathUtils.degToRad(saturnData.axialTiltDeg);

    const systemGroup = new THREE.Group();
    const poleFrame = new THREE.Group();
    poleFrame.rotation.z = tiltRad;
    systemGroup.add(poleFrame);

    const planetMesh = new THREE.Mesh(new THREE.SphereGeometry(10, 16, 16));
    poleFrame.add(planetMesh);

    // 依规范：RingGeometry 经 rotateX(PI / 2) 使几何体处于 X-Z 平面，法线沿本地 Y 轴
    const ringGeo = new THREE.RingGeometry(12, 20, 32);
    ringGeo.rotateX(Math.PI / 2);
    const ringMesh = new THREE.Mesh(ringGeo);
    poleFrame.add(ringMesh);

    systemGroup.updateMatrixWorld(true);

    // 1. 验证光环法线与行星极轴完全同向
    const qPole = new THREE.Quaternion();
    poleFrame.getWorldQuaternion(qPole);
    const worldPoleAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(qPole).normalize();

    const qRing = new THREE.Quaternion();
    ringMesh.getWorldQuaternion(qRing);
    const worldRingNormal = new THREE.Vector3(0, 1, 0).applyQuaternion(qRing).normalize();

    expect(worldRingNormal.distanceTo(worldPoleAxis)).toBeLessThan(1e-5);

    // 2. 模拟行星高速自转
    planetMesh.rotation.y = Math.PI * 1.5;
    systemGroup.updateMatrixWorld(true);

    // 光环法线与世界四元数应保持完全静止，不受 planetMesh.rotation.y 拖曳
    const qRingAfterSpin = new THREE.Quaternion();
    ringMesh.getWorldQuaternion(qRingAfterSpin);
    expect(qRingAfterSpin.angleTo(qRing)).toBeLessThan(1e-6);

    const qPlanet = new THREE.Quaternion();
    planetMesh.getWorldQuaternion(qPlanet);
    // 行星自身已旋转，四元数发生变化
    expect(qPlanet.angleTo(qRing)).toBeGreaterThan(0.5);
  });

  it('HIER-03: 卫星系统挂载于母星 systemGroup，随母星平移但不随母星自转', () => {
    const earthGroup = new THREE.Group();
    earthGroup.position.set(100, 0, 0); // 地球公转位置

    const earthPoleFrame = new THREE.Group();
    earthPoleFrame.rotation.z = THREE.MathUtils.degToRad(23.44);
    earthGroup.add(earthPoleFrame);

    const earthMesh = new THREE.Mesh();
    earthPoleFrame.add(earthMesh);

    // 卫星月球挂载在 earthGroup (systemGroup) 下
    const moonGroup = new THREE.Group();
    moonGroup.position.set(10, 0, 0); // 月球相对于地球的轨道位置
    earthGroup.add(moonGroup);

    const moonPoleFrame = new THREE.Group();
    moonPoleFrame.rotation.z = THREE.MathUtils.degToRad(1.54);
    moonGroup.add(moonPoleFrame);

    const moonMesh = new THREE.Mesh();
    moonPoleFrame.add(moonMesh);

    earthGroup.updateMatrixWorld(true);

    const initialMoonWorldPos = new THREE.Vector3();
    moonMesh.getWorldPosition(initialMoonWorldPos);
    expect(initialMoonWorldPos.x).toBeCloseTo(110, 4);

    // 当地球绕自转轴自转 180 度时
    earthMesh.rotation.y = Math.PI;
    earthGroup.updateMatrixWorld(true);

    // 月球的世界位置绝对不应受到地球自转影响
    const afterSpinMoonWorldPos = new THREE.Vector3();
    moonMesh.getWorldPosition(afterSpinMoonWorldPos);
    expect(afterSpinMoonWorldPos.distanceTo(initialMoonWorldPos)).toBeLessThan(1e-5);
  });
});
