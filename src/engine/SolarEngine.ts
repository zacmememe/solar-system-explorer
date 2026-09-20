/**
 * 太阳系渲染主引擎 SolarEngine (M1 完整视觉增强版)
 * 遵循 01-REBUILD-PLAN 与 AGENTS.md 约束：
 * 1. WebGLRenderer (WebGL2)，单一 render loop；
 * 2. 地球多层多波段着色（昼夜混合 + 城市灯光 + 独立自旋云层 + 边缘微光）；
 * 3. 沉浸式真实深空星图背景；
 * 4. 严格区分点击拾取与旋转拖拽；
 * 5. 卫星独立公转，不挂在行星自转网格下；
 * 6. 支持 WebGL 上下文丢失/恢复。
 */

import * as THREE from 'three';
import { CameraController } from '../camera/CameraController';
import { BODIES, computeRenderTransform, getMoonPositionKm } from '../astronomy/bodies';
import { AssetManager } from '../assets/AssetManager';
import {
  createEarthSurfaceMaterial,
  createEarthCloudMaterial,
  createAtmosphereHaloMaterial,
} from '../rendering/EarthMaterial';
import type { BodyId } from '../contracts/body';
import type { CameraCommand, CameraStateSnapshot } from '../contracts/camera';
import productionAssetsData from '../../sources/production-assets.json';

export interface WebGLDiagnosticInfo {
  isWebGL2: boolean;
  rendererName: string;
  vendorName: string;
  maxTextureSize: number;
  maxRenderBufferSize: number;
  highpSupported: boolean;
}

export interface SolarEngineCallbacks {
  onSelectBody?: (bodyId: BodyId) => void;
  onCameraSnapshot?: (snapshot: CameraStateSnapshot) => void;
  onWebGLInfo?: (info: WebGLDiagnosticInfo) => void;
}

function safeDisposeMaterial(mat: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(mat)) {
    mat.forEach((m) => m.dispose());
  } else {
    mat.dispose();
  }
}

export class SolarEngine {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private cameraController: CameraController;
  private assetManager: AssetManager;

  // 场景星空背景
  private skyboxMesh: THREE.Mesh | null = null;

  // 地球多层对象
  private earthGroup: THREE.Group;
  private earthMesh: THREE.Mesh;
  private cloudMesh: THREE.Mesh;
  private haloMesh: THREE.Mesh;
  private earthMaterial: THREE.ShaderMaterial | null = null;
  private cloudMaterial: THREE.ShaderMaterial | null = null;
  private haloMaterial: THREE.ShaderMaterial | null = null;

  // 月球对象
  private moonGroup: THREE.Group;
  private moonMesh: THREE.Mesh;

  // 光照
  private sunLight: THREE.DirectionalLight;
  private ambientLight: THREE.AmbientLight;

  // 渲染探索选项
  private showClouds: boolean = true;
  private teachingLight: boolean = false;
  private showAtmosphere: boolean = true;

  // 动画与时钟
  private isRunning: boolean = true;
  private animFrameId: number = 0;
  private lastTime: number = 0;
  private simTimeHours: number = 0;
  private timeScale: number = 1.0;
  private isPaused: boolean = false;

  // 交互控制
  private isPointerDown: boolean = false;
  private pointerStartX: number = 0;
  private pointerStartY: number = 0;
  private lastPointerX: number = 0;
  private lastPointerY: number = 0;
  private dragThresholdPx: number = 6;
  private hasDragged: boolean = false;
  private raycaster: THREE.Raycaster = new THREE.Raycaster();
  private pointerNdc: THREE.Vector2 = new THREE.Vector2();

  private callbacks: SolarEngineCallbacks;

  constructor(container: HTMLElement, callbacks: SolarEngineCallbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;

    // 1. 创建 Canvas 与 WebGLRenderer (WebGL2)
    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    this.container.appendChild(this.canvas);

    const context = this.canvas.getContext('webgl2');
    if (!context) {
      throw new Error('当前环境不支持 WebGL2！请在兼容的现代浏览器或硬件中运行。');
    }

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      context,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    // 提取诊断信息
    this.extractDiagnostics(context);

    // 2. 场景与相机
    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      8000
    );

    this.cameraController = new CameraController({ camera: this.camera });
    this.assetManager = new AssetManager();
    this.assetManager.registerManifest((productionAssetsData as any).assets);

    // 3. 构建深空星图背景球体
    const skyGeo = new THREE.SphereGeometry(4000, 32, 32);
    const skyMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.skyboxMesh = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.skyboxMesh);

    // 4. 构建地球多层网格 (地表 + 云层 + 大气边缘光环)
    const earthTransform = computeRenderTransform([0, 0, 0], [0, 0, 0], BODIES.earth.radiusKm);
    const earthR = earthTransform.renderRadius;

    // 地表网格 (高精度 64x64 球体)
    const earthGeo = new THREE.SphereGeometry(earthR, 64, 64);
    const fallbackMat = new THREE.MeshStandardMaterial({
      roughness: 0.7,
      metalness: 0.1,
      color: 0x223344,
    });
    this.earthMesh = new THREE.Mesh(earthGeo, fallbackMat);

    // 云层网格 (外浮 1.008 倍半径)
    const cloudGeo = new THREE.SphereGeometry(earthR * 1.008, 64, 64);
    const cloudFallbackMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
    this.cloudMesh = new THREE.Mesh(cloudGeo, cloudFallbackMat);

    // 大气外缘微光网格 (外浮 1.025 倍半径)
    const haloGeo = new THREE.SphereGeometry(earthR * 1.025, 48, 48);
    const haloFallbackMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
    this.haloMesh = new THREE.Mesh(haloGeo, haloFallbackMat);

    this.earthGroup = new THREE.Group();
    this.earthGroup.rotation.z = THREE.MathUtils.degToRad(BODIES.earth.axialTiltDeg);
    this.earthGroup.add(this.earthMesh);
    this.earthGroup.add(this.cloudMesh);
    this.earthGroup.add(this.haloMesh);
    this.scene.add(this.earthGroup);

    // 5. 构建月球网格（独立添加在 scene 下，绝不挂在 earthGroup 下！）
    const moonInitPos = getMoonPositionKm(0);
    const moonTransform = computeRenderTransform(moonInitPos, [0, 0, 0], BODIES.moon.radiusKm);
    const moonGeo = new THREE.SphereGeometry(moonTransform.renderRadius, 48, 48);
    const moonMat = new THREE.MeshStandardMaterial({
      roughness: 0.88,
      metalness: 0.04,
      color: 0xffffff,
    });
    this.moonMesh = new THREE.Mesh(moonGeo, moonMat);
    this.moonGroup = new THREE.Group();
    this.moonGroup.position.set(...moonTransform.renderPosition);
    this.moonGroup.rotation.z = THREE.MathUtils.degToRad(BODIES.moon.axialTiltDeg);
    this.moonGroup.add(this.moonMesh);
    this.scene.add(this.moonGroup);

    // 6. 光照配置（模拟真实太阳光照）
    this.sunLight = new THREE.DirectionalLight(0xfff8ee, 2.6);
    this.sunLight.position.set(500, 50, 300);
    this.scene.add(this.sunLight);

    this.ambientLight = new THREE.AmbientLight(0x0a1220, 0.15); // 克制微弱暗部填充
    this.scene.add(this.ambientLight);

    // 7. 绑定交互事件
    this.bindEvents();

    // 8. 异步加载全套 M1 真实贴图并着色
    this.loadInitialTextures();

    // 9. 启动渲染循环
    this.lastTime = performance.now();
    this.animate();
  }

  private extractDiagnostics(gl: WebGL2RenderingContext): void {
    const debugExt = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererName = debugExt ? gl.getParameter(debugExt.UNMASKED_RENDERER_WEBGL) : 'WebGL2 Standard Renderer';
    const vendorName = debugExt ? gl.getParameter(debugExt.UNMASKED_VENDOR_WEBGL) : 'Unknown Vendor';
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const maxRenderBufferSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);

    const info: WebGLDiagnosticInfo = {
      isWebGL2: true,
      rendererName: rendererName || '待确认',
      vendorName: vendorName || '待确认',
      maxTextureSize,
      maxRenderBufferSize,
      highpSupported: gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision! > 0,
    };

    if (this.callbacks.onWebGLInfo) {
      this.callbacks.onWebGLInfo(info);
    }
  }

  private async loadInitialTextures(): Promise<void> {
    const token = this.cameraController.getSnapshot().commandId;

    // 1. 加载深空星图背景
    const starsTex = await this.assetManager.loadTexture('stars-bg-sss-2k', token, () => true);
    if (starsTex && this.skyboxMesh) {
      (this.skyboxMesh.material as THREE.MeshBasicMaterial).map = starsTex;
      (this.skyboxMesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
    }

    // 2. 加载地球白昼与夜景图，创建昼夜晨昏线 Shader 材质
    const earthDayTex = await this.assetManager.loadTexture('earth-day-sss-2k', token, () => true);
    const earthNightTex = await this.assetManager.loadTexture('earth-night-sss-2k', token, () => true);

    if (earthDayTex && earthNightTex) {
      this.earthMaterial = createEarthSurfaceMaterial(earthDayTex, earthNightTex);
      this.earthMaterial.uniforms.sunDirection.value.copy(this.sunLight.position).normalize();
      this.earthMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
      safeDisposeMaterial(this.earthMesh.material);
      this.earthMesh.material = this.earthMaterial;
    } else if (earthDayTex) {
      (this.earthMesh.material as THREE.MeshStandardMaterial).map = earthDayTex;
      (this.earthMesh.material as THREE.MeshStandardMaterial).needsUpdate = true;
    }

    // 3. 加载地球云层图
    const cloudTex = await this.assetManager.loadTexture('earth-clouds-sss-2k', token, () => true);
    if (cloudTex) {
      this.cloudMaterial = createEarthCloudMaterial(cloudTex);
      this.cloudMaterial.uniforms.sunDirection.value.copy(this.sunLight.position).normalize();
      safeDisposeMaterial(this.cloudMesh.material);
      this.cloudMesh.material = this.cloudMaterial;
      this.cloudMesh.visible = this.showClouds;
    }

    // 4. 创建地球大气边缘散射光晕
    this.haloMaterial = createAtmosphereHaloMaterial();
    this.haloMaterial.uniforms.sunDirection.value.copy(this.sunLight.position).normalize();
    safeDisposeMaterial(this.haloMesh.material);
    this.haloMesh.material = this.haloMaterial;
    this.haloMesh.visible = this.showAtmosphere;

    // 5. 加载月球 NASA LROC 2K 多光谱贴图
    const moonTex = await this.assetManager.loadTexture('moon-svs-2025-2k', token, () => true);
    if (moonTex) {
      (this.moonMesh.material as THREE.MeshStandardMaterial).map = moonTex;
      (this.moonMesh.material as THREE.MeshStandardMaterial).needsUpdate = true;
    }
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.onResize);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });

    // WebGL 上下文丢失/恢复处理
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('[SolarEngine] WebGL context lost!');
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      console.log('[SolarEngine] WebGL context restored. Reloading textures...');
      this.loadInitialTextures();
    });
  }

  private onResize = (): void => {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.isPointerDown = true;
    this.hasDragged = false;
    this.pointerStartX = e.clientX;
    this.pointerStartY = e.clientY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.isPointerDown) return;

    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    const totalDist = Math.hypot(e.clientX - this.pointerStartX, e.clientY - this.pointerStartY);

    if (totalDist > this.dragThresholdPx) {
      this.hasDragged = true;
    }

    if (this.hasDragged) {
      const deltaTheta = dx * 0.005;
      const deltaPhi = dy * 0.005;
      this.cameraController.executeCommand({ type: 'orbit', deltaPhi, deltaTheta });
      this.emitSnapshot();
    }

    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.isPointerDown) return;
    this.isPointerDown = false;

    // 若未触发拖拽，则视为有效点击拾取
    if (!this.hasDragged) {
      this.handlePick(e.clientX, e.clientY);
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const zoomFactor = e.deltaY * 0.05;
    this.cameraController.executeCommand({ type: 'zoom', deltaDist: zoomFactor });
    this.emitSnapshot();
  };

  private handlePick(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const intersects = this.raycaster.intersectObjects([this.earthMesh, this.moonMesh]);

    if (intersects.length > 0) {
      const hit = intersects[0].object;
      const bodyId: BodyId = hit === this.earthMesh ? 'earth' : 'moon';
      this.cameraController.executeCommand({ type: 'select', bodyId });
      if (this.callbacks.onSelectBody) {
        this.callbacks.onSelectBody(bodyId);
      }
      this.emitSnapshot();
    }
  }

  public executeCameraCommand(cmd: CameraCommand): void {
    this.cameraController.executeCommand(cmd);
    this.emitSnapshot();
  }

  public setPaused(paused: boolean): void {
    this.isPaused = paused;
  }

  public setTimeScale(scale: number): void {
    this.timeScale = scale;
  }

  public setShowClouds(show: boolean): void {
    this.showClouds = show;
    this.cloudMesh.visible = show;
  }

  public setTeachingLight(enable: boolean): void {
    this.teachingLight = enable;
    if (this.earthMaterial) {
      this.earthMaterial.uniforms.teachingLight.value = enable ? 1.0 : 0.0;
    }
  }

  public setShowAtmosphere(show: boolean): void {
    this.showAtmosphere = show;
    this.haloMesh.visible = show;
  }

  public isTeachingLight(): boolean {
    return this.teachingLight;
  }

  public isShowClouds(): boolean {
    return this.showClouds;
  }

  private emitSnapshot(): void {
    if (this.callbacks.onCameraSnapshot) {
      this.callbacks.onCameraSnapshot(this.cameraController.getSnapshot());
    }
  }

  private animate = (): void => {
    if (!this.isRunning) return;
    this.animFrameId = requestAnimationFrame(this.animate);

    const now = performance.now();
    const deltaSec = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    // 1. 模拟时钟推进
    if (!this.isPaused) {
      this.simTimeHours += deltaSec * this.timeScale;
    }

    // 2. 天体公转与自转更新
    // 地球自转（23.934 小时一圈）
    const earthRotRad = (2 * Math.PI * (this.simTimeHours % BODIES.earth.rotationPeriodHours)) / BODIES.earth.rotationPeriodHours;
    this.earthMesh.rotation.y = earthRotRad;

    // 独立自旋云层：略快于地表（形成大气对流流动效果）
    this.cloudMesh.rotation.y = earthRotRad * 1.04 + (this.simTimeHours * 0.01);

    // 月球公转位置计算
    const moonPosKm = getMoonPositionKm(this.simTimeHours);
    const moonTransform = computeRenderTransform(moonPosKm, [0, 0, 0], BODIES.moon.radiusKm);
    this.moonGroup.position.set(...moonTransform.renderPosition);

    // 月球潮汐锁定自转
    const moonOrbitAngle = Math.atan2(moonTransform.renderPosition[2], moonTransform.renderPosition[0]);
    this.moonMesh.rotation.y = -moonOrbitAngle;

    // 星空背景球跟随相机位置（保持无尽远景感）
    if (this.skyboxMesh) {
      this.skyboxMesh.position.copy(this.camera.position);
    }

    // 3. 更新相机位置与平滑过渡
    this.cameraController.update(deltaSec, (id: BodyId) => {
      if (id === 'moon') {
        return {
          pos: this.moonGroup.position,
          radius: moonTransform.renderRadius,
        };
      }
      return {
        pos: this.earthGroup.position,
        radius: computeRenderTransform([0, 0, 0], [0, 0, 0], BODIES.earth.radiusKm).renderRadius,
      };
    });

    // 4. 渲染一帧
    this.renderer.render(this.scene, this.camera);
  };

  public dispose(): void {
    this.isRunning = false;
    cancelAnimationFrame(this.animFrameId);
    window.removeEventListener('resize', this.onResize);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);

    this.assetManager.disposeAll();

    if (this.skyboxMesh) {
      this.skyboxMesh.geometry.dispose();
      safeDisposeMaterial(this.skyboxMesh.material);
    }

    this.earthMesh.geometry.dispose();
    safeDisposeMaterial(this.earthMesh.material);

    this.cloudMesh.geometry.dispose();
    safeDisposeMaterial(this.cloudMesh.material);

    this.haloMesh.geometry.dispose();
    safeDisposeMaterial(this.haloMesh.material);

    this.moonMesh.geometry.dispose();
    safeDisposeMaterial(this.moonMesh.material);

    this.renderer.dispose();

    if (this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
  }
}
