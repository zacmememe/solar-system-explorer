/**
 * R4（260925 基础体验恢复·第四批）：拾取可见性过滤回归测试。
 *
 * 审计七：Three.js Raycaster 不检查祖先 visible——隐藏的旧系统/父组下的
 * mesh 仍会抢走本应给后方可见天体的点击（"点了这个去了另一个"）。
 * 引擎侧以 isObjectVisible（沿父链检查）过滤拾取集合；本测试用真实
 * THREE.Raycaster 复现审计受控场景并验证过滤语义。
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

/** 与 SolarEngine.isObjectVisible 同式（可见链检查） */
function isObjectVisible(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) {
    if (!p.visible) return false;
  }
  return true;
}

function makeScene() {
  const scene = new THREE.Scene();
  // 前方球：挂在隐藏组下（模拟物理模式隐藏的其他系统/未激活站点组）
  const hiddenGroup = new THREE.Group();
  hiddenGroup.visible = false;
  const front = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 16, 12),
    new THREE.MeshBasicMaterial()
  );
  front.position.set(0, 0, -5);
  front.userData.bodyId = 'front-hidden';
  hiddenGroup.add(front);
  scene.add(hiddenGroup);
  // 后方球：可见（模拟当前观察天体）
  const back = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 16, 12),
    new THREE.MeshBasicMaterial()
  );
  back.position.set(0, 0, -8);
  back.userData.bodyId = 'back-visible';
  scene.add(back);
  scene.updateMatrixWorld(true);
  return { scene, front, back };
}

function makeCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  cam.position.set(0, 0, 0);
  cam.lookAt(0, 0, -1);
  cam.updateMatrixWorld();
  return cam;
}

describe('R4：拾取可见性过滤（Raycaster 不查祖先 visible 的反例）', () => {
  it('不过滤时隐藏的前方球抢走点击（审计受控场景复现）', () => {
    const { front, back } = makeScene();
    const cam = makeCamera();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), cam);
    const hits = ray.intersectObjects([front, back]);
    expect(hits[0].object.userData.bodyId).toBe('front-hidden'); // 错误行为基线
  });

  it('可见链过滤后命中后方可见天体', () => {
    const { front, back } = makeScene();
    const cam = makeCamera();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), cam);
    const pickables = [front, back].filter((m) => isObjectVisible(m));
    expect(pickables).toEqual([back]);
    const hits = ray.intersectObjects(pickables);
    expect(hits[0].object.userData.bodyId).toBe('back-visible');
  });

  it('mesh 自身 visible=false 同样被过滤（隐藏瓦片/站点子网格）', () => {
    const { back } = makeScene();
    back.visible = false;
    expect(isObjectVisible(back)).toBe(false);
    const parent = new THREE.Group();
    const child = new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshBasicMaterial());
    parent.add(child);
    expect(isObjectVisible(child)).toBe(true);
    parent.visible = false;
    expect(isObjectVisible(child)).toBe(false); // 父链隐藏
  });
});
