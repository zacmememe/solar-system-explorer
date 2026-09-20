/**
 * 航天器机库 3D 实时交互视窗
 * 遵循 04-VEHICLES.zh-CN.md 规范：
 * 1. 真实米制建模展示，支持构图自适应与真实米制标尺对比；
 * 2. 交互平滑旋转，空闲时柔和微动，用户交互优先；
 * 3. 结构热点实时定位高亮。
 */

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { VehicleId } from '../contracts/vehicle';
import { VEHICLE_CATALOG } from './VehicleCatalog';
import { VehicleMeshBuilder } from './VehicleMeshBuilder';

interface VehicleViewer3DProps {
  vehicleId: VehicleId;
  activeHotspotId?: string | null;
  scaleMode?: 'framed' | 'metric';
}

export const VehicleViewer3D: React.FC<VehicleViewer3DProps> = ({
  vehicleId,
  activeHotspotId,
  scaleMode = 'framed',
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 400;
    const height = container.clientHeight || 340;

    // 1. WebGL 场景与渲染器
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a101d);

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 500);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    container.appendChild(renderer.domElement);

    // 2. 摄影棚灯光系统（柔和三点光 + 轮廓光）
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(5, 8, 7);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x38bdf8, 1.2);
    fillLight.position.set(-6, -2, -5);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xfde047, 0.8);
    rimLight.position.set(0, -6, 5);
    scene.add(rimLight);

    const ambientLight = new THREE.AmbientLight(0x334155, 1.0);
    scene.add(ambientLight);

    // 3. 构建航天器模型
    const vehicleGroup = new THREE.Group();
    scene.add(vehicleGroup);

    const mesh = VehicleMeshBuilder.buildVehicle(vehicleId);
    vehicleGroup.add(mesh);

    // 计算模型包围盒与中心
    const box = new THREE.Box3().setFromObject(mesh);
    const center = new THREE.Vector3();
    box.getCenter(center);
    mesh.position.sub(center); // 居中

    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z, 0.01);

    // 相机与缩放控制
    if (scaleMode === 'framed') {
      // 构图模式：距离按物体大小自适应
      camera.position.set(0, maxDim * 0.4, maxDim * 1.8);
      camera.lookAt(0, 0, 0);
    } else {
      // 真实米制模式：固定相机视野，展现 109m ISS 与 3.7m Voyager 的剧烈体积反差
      camera.position.set(0, 25, 75);
      camera.lookAt(0, 0, 0);

      // 地面米制参考网格 (100m x 100m，每格 5m)
      const gridHelper = new THREE.GridHelper(100, 20, 0x38bdf8, 0x1e293b);
      gridHelper.position.y = -size.y * 0.5 - 0.5;
      scene.add(gridHelper);
    }

    // 4. 热点高亮指示器
    const hotspotMarker = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(0.15, maxDim * 0.025), 16, 16),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true })
    );
    hotspotMarker.visible = false;
    scene.add(hotspotMarker);

    // 5. 交互旋转控制
    let isDragging = false;
    let prevX = 0;
    let prevY = 0;
    let rotY = 0.3;
    let rotX = 0.15;
    let userInteracted = false;

    const onPointerDown = (e: PointerEvent) => {
      isDragging = true;
      userInteracted = true;
      prevX = e.clientX;
      prevY = e.clientY;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - prevX;
      const dy = e.clientY - prevY;
      rotY += dx * 0.008;
      rotX = Math.max(-1.2, Math.min(1.2, rotX + dy * 0.008));
      prevX = e.clientX;
      prevY = e.clientY;
    };

    const onPointerUp = () => {
      isDragging = false;
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    // 6. 动画循环
    let lastTime = performance.now();
    const animate = () => {
      animRef.current = requestAnimationFrame(animate);
      const now = performance.now();
      const deltaSec = (now - lastTime) / 1000;
      lastTime = now;

      // 若未手动拖拽，缓慢自动自转展示
      if (!isDragging && !userInteracted) {
        rotY += deltaSec * 0.25;
      }

      vehicleGroup.rotation.y = rotY;
      vehicleGroup.rotation.x = rotX;

      // 更新热点标记
      const def = VEHICLE_CATALOG[vehicleId];
      if (activeHotspotId && def) {
        const hs = def.hotspots.find((h) => h.id === activeHotspotId);
        if (hs) {
          const [hx, hy, hz] = hs.relativePosM;
          const localHotspot = new THREE.Vector3(hx, hy, hz).sub(center);
          localHotspot.applyAxisAngle(new THREE.Vector3(1, 0, 0), rotX);
          localHotspot.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
          hotspotMarker.position.copy(localHotspot);
          hotspotMarker.visible = true;
          // 呼吸闪烁
          const s = 1.0 + Math.sin(now * 0.008) * 0.2;
          hotspotMarker.scale.setScalar(s);
        } else {
          hotspotMarker.visible = false;
        }
      } else {
        hotspotMarker.visible = false;
      }

      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animRef.current);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('resize', onResize);

      vehicleGroup.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const m = obj as THREE.Mesh;
          m.geometry.dispose();
          if (Array.isArray(m.material)) {
            m.material.forEach((mat) => mat.dispose());
          } else {
            m.material.dispose();
          }
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
    };
  }, [vehicleId, activeHotspotId, scaleMode]);

  return (
    <div
      ref={mountRef}
      style={{
        width: '100%',
        height: '100%',
        minHeight: 280,
        position: 'relative',
        cursor: 'grab',
        touchAction: 'none',
      }}
      title="鼠标按住拖拽可 360° 自由旋转飞船"
    />
  );
};
