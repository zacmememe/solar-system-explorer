/**
 * 太阳系渲染主引擎 SolarEngine
 * 遵循 01-REBUILD-PLAN 与 AGENTS.md 约束：
 * 1. WebGLRenderer (WebGL2)，单一 render loop；
 * 2. 区分点击（拾取）与拖动（旋转）；
 * 3. 卫星不挂在行星自转网格下；
 * 4. 支持 WebGL 上下文丢失/恢复。
 */

import * as THREE from 'three';
import { CameraController } from '../camera/CameraController';
import { BODIES, computeRenderTransform, getMoonPositionKm } from '../astronomy/bodies';
import { AssetManager } from '../assets/AssetManager';
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

export class SolarEngine {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private cameraController: CameraController;
  private assetManager: AssetManager;

  // 场景天体对象
  private earthGroup: THREE.Group;
  private earthMesh: THREE.Mesh;
  private moonGroup: THREE.Group;
  private moonMesh: THREE.Mesh;

  // 光照
  private sunLight: THREE.DirectionalLight;
  private ambientLight: THREE.AmbientLight;

  // 动画与时钟
  private isRunning: boolean = true;
  private animFrameId: number = 0;
  private lastTime: number = 0;
  private simTimeHours: number = 0;
  private timeScale: number = 1.0; // 1 = 正常时间倍速, 0 = 暂停
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
    this.renderer.toneMappingExposure = 1.0;

    // 提取诊断信息
    this.extractDiagnostics(context);

    // 2. 场景与相机
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020408); // 克制的深空暗色

    this.camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      5000
    );

    this.cameraController = new CameraController({ camera: this.camera });
    this.assetManager = new AssetManager();
    this.assetManager.registerManifest((productionAssetsData as any).assets);

    // 3. 构建天体网格
    // 地球
    const earthTransform = computeRenderTransform([0, 0, 0], [0, 0, 0], BODIES.earth.radiusKm);
    const earthGeo = new THREE.SphereGeometry(earthTransform.renderRadius, 64, 32);
    const earthMat = new THREE.MeshStandardMaterial({
      roughness: 0.7,
      metalness: 0.1,
      color: 0xffffff,
    });
    this.earthMesh = new THREE.Mesh(earthGeo, earthMat);
    this.earthGroup = new THREE.Group();
    // 倾角
    this.earthGroup.rotation.z = THREE.MathUtils.degToRad(BODIES.earth.axialTiltDeg);
    this.earthGroup.add(this.earthMesh);
    this.scene.add(this.earthGroup);

    // 月球（独立添加在 scene 下，绝不挂在 earthGroup 或 earthMesh 下！）
    const moonInitPos = getMoonPositionKm(0);
    const moonTransform = computeRenderTransform(moonInitPos, [0, 0, 0], BODIES.moon.radiusKm);
    const moonGeo = new THREE.SphereGeometry(moonTransform.renderRadius, 48, 24);
    const moonMat = new THREE.MeshStandardMaterial({
      roughness: 0.9,
      metalness: 0.05,
      color: 0xffffff,
    });
    this.moonMesh = new THREE.Mesh(moonGeo, moonMat);
    this.moonGroup = new THREE.Group();
    this.moonGroup.position.set(...moonTransform.renderPosition);
    this.moonGroup.rotation.z = THREE.MathUtils.degToRad(BODIES.moon.axialTiltDeg);
    this.moonGroup.add(this.moonMesh);
    this.scene.add(this.moonGroup);

    // 4. 光照配置（模拟真实单侧太阳光，克制暗侧教学补光）
    this.sunLight = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sunLight.position.set(500, 50, 300);
    this.scene.add(this.sunLight);

    this.ambientLight = new THREE.AmbientLight(0x1a2233, 0.25); // 暗部细节
    this.scene.add(this.ambientLight);

    // 5. 绑定事件
    this.bindEvents();

    // 6. 加载地月核验贴图
    this.loadInitialTextures();

    // 7. 启动渲染循环
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

    // 加载地球贴图
    const earthTex = await this.assetManager.loadTexture('earth-day-sss-2k', token, () => true);
    if (earthTex) {
      (this.earthMesh.material as THREE.MeshStandardMaterial).map = earthTex;
      (this.earthMesh.material as THREE.MeshStandardMaterial).needsUpdate = true;
    }

    // 加载月球贴图
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
    if (e.button !== 0) return; // 仅左键响应旋转
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

    // 若未触发明显拖拽，则视为点击拾取
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

    // 1. 模拟时钟推进（若暂停则不累加）
    if (!this.isPaused) {
      // 默认 1 真实秒 = 1 模拟小时（在 M0/M1 可调）
      this.simTimeHours += deltaSec * this.timeScale;
    }

    // 2. 天体公转与自转更新
    // 地球自转（23.934 小时一圈）
    const earthRotRad = (2 * Math.PI * (this.simTimeHours % BODIES.earth.rotationPeriodHours)) / BODIES.earth.rotationPeriodHours;
    this.earthMesh.rotation.y = earthRotRad;

    // 月球公转位置计算
    const moonPosKm = getMoonPositionKm(this.simTimeHours);
    const moonTransform = computeRenderTransform(moonPosKm, [0, 0, 0], BODIES.moon.radiusKm);
    this.moonGroup.position.set(...moonTransform.renderPosition);

    // 月球自转（潮汐锁定近似朝向地球）
    const moonOrbitAngle = Math.atan2(moonTransform.renderPosition[2], moonTransform.renderPosition[0]);
    this.moonMesh.rotation.y = -moonOrbitAngle;

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
    this.earthMesh.geometry.dispose();
    (this.earthMesh.material as THREE.Material).dispose();
    this.moonMesh.geometry.dispose();
    (this.moonMesh.material as THREE.Material).dispose();
    this.renderer.dispose();

    if (this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
  }
}
