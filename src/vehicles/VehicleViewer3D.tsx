/**
 * 航天器机库 3D 实时交互视窗 VehicleViewer3D
 * 遵循 04-VEHICLES.zh-CN.md 及第二轮优化审计 R4 要求：
 * 1. 采用代际事务安全（Generation Tracking）加载 GLB/程序模型，杜绝迟到回调污染与黑屏闪烁；
 * 2. 模型切换在同一 WebGL 上下文中平滑过渡，基于最新 Bounds 准确定位机位目标；
 * 3. 结构热点绑定到模型本地空间，随载具姿态自洽旋转；
 * 4. 真实米制对比网格与可切换的中性工坊光/在轨日光对比。
 */

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { VehicleId } from '../contracts/vehicle';
import { VEHICLE_CATALOG } from './VehicleCatalog';
import { VehicleLoader } from './VehicleLoader';

export interface VehicleViewer3DProps {
  vehicleId: VehicleId;
  activeHotspotId?: string | null;
  scaleMode?: 'framed' | 'metric';
  lightingMode?: 'studio' | 'orbit';
}

export const VehicleViewer3D: React.FC<VehicleViewer3DProps> = ({
  vehicleId,
  activeHotspotId,
  scaleMode = 'framed',
  lightingMode = 'studio',
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);

  // 内部持久状态引用
  const stateRef = useRef({
    scaleMode,
    lightingMode,
    activeHotspotId,
    targetCamPos: new THREE.Vector3(0, 5, 20),
    targetLookAt: new THREE.Vector3(0, 0, 0),
    maxDim: 10,
    center: new THREE.Vector3(0, 0, 0),
    rotX: 0.15,
    rotY: 0.3,
    isDragging: false,
    userInteracted: false,
  });

  // 三维核心场景对象引用（在 Viewer 生命周期内保持单一稳定）
  const sceneRef = useRef<THREE.Scene | null>(null);
  const vehicleGroupRef = useRef<THREE.Group | null>(null);
  const currentMeshRef = useRef<THREE.Group | null>(null);
  const hotspotMarkerRef = useRef<THREE.Mesh | null>(null);
  const lightsRef = useRef<{
    keyLight: THREE.DirectionalLight;
    fillLight: THREE.DirectionalLight;
    rimLight: THREE.DirectionalLight;
    ambientLight: THREE.AmbientLight;
  } | null>(null);
  const gridHelperRef = useRef<THREE.GridHelper | null>(null);

  // 1. 同步参数变化 (scaleMode, lightingMode, activeHotspotId)
  useEffect(() => {
    stateRef.current.scaleMode = scaleMode;
    stateRef.current.lightingMode = lightingMode;
    stateRef.current.activeHotspotId = activeHotspotId;

    const { maxDim } = stateRef.current;
    if (scaleMode === 'framed') {
      stateRef.current.targetCamPos.set(0, maxDim * 0.4, maxDim * 1.8);
      stateRef.current.targetLookAt.set(0, 0, 0);
    } else {
      stateRef.current.targetCamPos.set(0, 25, 75);
      stateRef.current.targetLookAt.set(0, 0, 0);
    }

    // 更新光照模式
    if (lightsRef.current) {
      const { keyLight, fillLight, rimLight, ambientLight } = lightsRef.current;
      if (lightingMode === 'orbit') {
        // 在轨严苛日光：硬阴影、高对比度太阳直射光与深邃太空微弱反光
        keyLight.color.setHex(0xffffff);
        keyLight.intensity = 3.2;
        keyLight.position.set(12, 4, 10);
        fillLight.color.setHex(0x1e3a8a);
        fillLight.intensity = 0.35;
        rimLight.intensity = 0.0;
        ambientLight.color.setHex(0x050814);
        ambientLight.intensity = 0.2;
      } else {
        // 中性工坊光：柔和三点光与中性环境光，便于清晰观察结构与标尺
        keyLight.color.setHex(0xffffff);
        keyLight.intensity = 2.2;
        keyLight.position.set(5, 8, 7);
        fillLight.color.setHex(0x38bdf8);
        fillLight.intensity = 1.2;
        rimLight.intensity = 0.8;
        ambientLight.color.setHex(0x334155);
        ambientLight.intensity = 1.0;
      }
    }
  }, [scaleMode, lightingMode, activeHotspotId]);

  // 2. 初始化 WebGL 视窗生命周期（仅在组件挂载时运行一次，保持 renderer 常驻）
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 400;
    const height = container.clientHeight || 340;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a101d);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 500);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    container.appendChild(renderer.domElement);

    // 灯光系统
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

    lightsRef.current = { keyLight, fillLight, rimLight, ambientLight };

    // 载具装配根节点
    const vehicleGroup = new THREE.Group();
    scene.add(vehicleGroup);
    vehicleGroupRef.current = vehicleGroup;

    // 地面米制参考网格 (100m x 100m，每格 5m)
    const gridHelper = new THREE.GridHelper(100, 20, 0x38bdf8, 0x1e293b);
    gridHelper.position.y = -5.0;
    scene.add(gridHelper);
    gridHelperRef.current = gridHelper;

    // 热点高亮标记球体（挂载在 vehicleGroup 下随飞船旋转）
    const hotspotMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true })
    );
    hotspotMarker.visible = false;
    vehicleGroup.add(hotspotMarker);
    hotspotMarkerRef.current = hotspotMarker;

    // 交互拖拽控制
    let prevX = 0;
    let prevY = 0;

    const onPointerDown = (e: PointerEvent) => {
      stateRef.current.isDragging = true;
      stateRef.current.userInteracted = true;
      prevX = e.clientX;
      prevY = e.clientY;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!stateRef.current.isDragging) return;
      const dx = e.clientX - prevX;
      const dy = e.clientY - prevY;
      stateRef.current.rotY += dx * 0.008;
      stateRef.current.rotX = Math.max(-1.2, Math.min(1.2, stateRef.current.rotX + dy * 0.008));
      prevX = e.clientX;
      prevY = e.clientY;
    };

    const onPointerUp = () => {
      stateRef.current.isDragging = false;
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    // 动画循环
    let lastTime = performance.now();
    const animate = () => {
      animRef.current = requestAnimationFrame(animate);
      const now = performance.now();
      const deltaSec = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;

      // 帧率无关平滑阻尼插值 (dt-based lerp)
      const lerpAlpha = 1.0 - Math.exp(-6.0 * deltaSec);
      camera.position.lerp(stateRef.current.targetCamPos, lerpAlpha);
      camera.lookAt(stateRef.current.targetLookAt);

      if (gridHelperRef.current) {
        gridHelperRef.current.visible = stateRef.current.scaleMode === 'metric';
      }

      // 未手动交互时轻柔自转
      if (!stateRef.current.isDragging && !stateRef.current.userInteracted) {
        stateRef.current.rotY += deltaSec * 0.25;
      }

      vehicleGroup.rotation.y = stateRef.current.rotY;
      vehicleGroup.rotation.x = stateRef.current.rotX;

      // 热点闪烁动画
      if (hotspotMarkerRef.current && hotspotMarkerRef.current.visible) {
        const s = 1.0 + Math.sin(now * 0.008) * 0.25;
        hotspotMarkerRef.current.scale.setScalar(s);
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

      if (currentMeshRef.current) {
        VehicleLoader.disposeVehicleObject(currentMeshRef.current);
        currentMeshRef.current = null;
      }
      renderer.dispose();
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
    };
  }, []);

  // 3. 异步载入新模型（代际事务管理，彻底杜绝迟到回调与机位目标错误）
  useEffect(() => {
    const vehicleGroup = vehicleGroupRef.current;
    if (!vehicleGroup) return;

    const gen = VehicleLoader.nextGeneration();

    VehicleLoader.loadVehicle(vehicleId, gen).then((newModel) => {
      // 检查代际是否依然有效
      if (gen !== VehicleLoader.getCurrentGeneration() || !newModel) {
        if (newModel) {
          VehicleLoader.disposeVehicleObject(newModel);
        }
        return;
      }

      // 释放并移除旧模型
      if (currentMeshRef.current) {
        vehicleGroup.remove(currentMeshRef.current);
        VehicleLoader.disposeVehicleObject(currentMeshRef.current);
        currentMeshRef.current = null;
      }

      currentMeshRef.current = newModel;
      vehicleGroup.add(newModel);

      // 提取准确模型物理 Bounds 并更新相机聚焦目标
      const maxDim = (newModel.userData.maxDim as number) || 10;
      stateRef.current.maxDim = maxDim;

      if (stateRef.current.scaleMode === 'framed') {
        stateRef.current.targetCamPos.set(0, maxDim * 0.4, maxDim * 1.8);
      } else {
        stateRef.current.targetCamPos.set(0, 25, 75);
      }
      stateRef.current.targetLookAt.set(0, 0, 0);

      // 同步热点标记尺寸与位置
      if (hotspotMarkerRef.current) {
        const markerRadius = Math.max(0.2, maxDim * 0.025);
        hotspotMarkerRef.current.geometry.dispose();
        hotspotMarkerRef.current.geometry = new THREE.SphereGeometry(markerRadius, 16, 16);
      }

      if (gridHelperRef.current) {
        const size = newModel.userData.size as THREE.Vector3;
        gridHelperRef.current.position.y = -size.y * 0.5 - 0.2;
      }
    });
  }, [vehicleId]);

  // 4. 热点高亮更新响应
  useEffect(() => {
    const marker = hotspotMarkerRef.current;
    if (!marker) return;

    if (!activeHotspotId) {
      marker.visible = false;
      return;
    }

    const def = VEHICLE_CATALOG[vehicleId];
    const hs = def?.hotspots.find((h) => h.id === activeHotspotId);
    if (hs) {
      marker.position.set(hs.relativePosM[0], hs.relativePosM[1], hs.relativePosM[2]);
      marker.visible = true;
    } else {
      marker.visible = false;
    }
  }, [vehicleId, activeHotspotId]);

  return (
    <div
      ref={mountRef}
      data-testid="hangar-3d-viewport"
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
