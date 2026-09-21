/**
 * 太阳系渲染主引擎 SolarEngine (全行星与核心卫星系统)
 * 遵循 01-REBUILD-PLAN.zh-CN.md 与 AGENTS.md 规范：
 * 1. WebGLRenderer (WebGL2)，单一 render loop；
 * 2. 宏观对数/开普勒双尺度分离，保证全景与局部均不抖动；
 * 3. 严格区分点击拾取与旋转拖拽（6px 门限）；
 * 4. 卫星独立于行星自转网格，具有独立轨道与潮汐锁定计算；
 * 5. 支持土星真实双面环与背阳投影阴影、金星大气/雷达地表穿透切换、太阳发光与日冕；
 * 6. 支持 WebGL 上下文丢失与恢复、贴图按需异步载入。
 */

import * as THREE from 'three';
import { CameraController } from '../camera/CameraController';
import {
  BODIES,
  getNavOrbitRadius,
  getNavDisplayRadius,
  getPlanetNavPosition,
  getSatelliteNavPosition,
} from '../astronomy/bodies';
import { AssetManager } from '../assets/AssetManager';
import {
  createEarthSurfaceMaterial,
  createEarthCloudMaterial,
  createAtmosphereHaloMaterial,
} from '../rendering/EarthMaterial';
import { createSaturnRingMaterial } from '../rendering/RingMaterial';
import { createSunMaterial, createSunCoronaMaterial } from '../rendering/SunMaterial';
import type { BodyId, CelestialBodyData } from '../contracts/body';
import type { CameraCommand, CameraStateSnapshot } from '../contracts/camera';
import type { VehicleId, ViewCameraMode } from '../contracts/vehicle';
import {
  getIoTexture,
  getEuropaTexture,
  getEnceladusTexture,
  getTitanNearInfraredTexture,
  getTitanHazeTexture,
  getGanymedeTexture,
  getCallistoTexture,
  getMarsMoonTexture,
} from '../astronomy/MoonTextures';
import { soundEffects } from '../audio/SoundEffects';
import { VehicleMeshBuilder } from '../vehicles/VehicleMeshBuilder';
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
  onContextState?: (state: 'lost' | 'restored') => void;
}

function safeDisposeMaterial(mat: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(mat)) {
    mat.forEach((m) => m.dispose());
  } else {
    mat.dispose();
  }
}

interface BodyRenderNode {
  data: CelestialBodyData;
  systemGroup: THREE.Group; // 行星系系统根节点（平移位置，不随行星自转）
  mesh: THREE.Mesh; // 星球表面网格
  displayRadius: number;
  cloudMesh?: THREE.Mesh;
  haloMesh?: THREE.Mesh;
  ringMesh?: THREE.Mesh;
  orbitLine?: THREE.LineLoop;
  material?: THREE.Material;
  coronaMesh?: THREE.Mesh;
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

  // 天体节点集合
  private bodyNodes: Map<BodyId, BodyRenderNode> = new Map();
  private pickableMeshes: THREE.Mesh[] = [];

  // 轨道线容器
  private orbitLinesGroup: THREE.Group;

  // 光照
  private sunPointLight: THREE.PointLight;
  private ambientLight: THREE.AmbientLight;

  // 地球着色材质与云层
  private earthMaterial: THREE.ShaderMaterial | null = null;
  private earthCloudMaterial: THREE.ShaderMaterial | null = null;
  private earthHaloMaterial: THREE.ShaderMaterial | null = null;

  // 渲染探索选项
  private showClouds: boolean = true;
  private teachingLight: boolean = false;
  private showAtmosphere: boolean = true;
  private showOrbits: boolean = true;
  private venusRadarMode: boolean = false;
  private reduceMotion: boolean = false;

  // 纹理缓存
  private saturnRingMaterial: THREE.ShaderMaterial | null = null;
  private sunMaterial: THREE.ShaderMaterial | null = null;
  private sunCoronaMaterial: THREE.ShaderMaterial | null = null;

  // 载具航天器系统
  private currentVehicleId: VehicleId | null = 'apollo-lm';
  private vehicleGroup: THREE.Group = new THREE.Group();
  private currentVehicleMesh: THREE.Group | null = null;
  private viewCameraMode: ViewCameraMode = 'VEHICLE_FORMATION';
  private vehicleOrbitAngle: number = 0;

  // 动画与时钟
  private isRunning: boolean = true;
  private animFrameId: number = 0;
  private lastTime: number = 0;
  private simTimeHours: number = 0;
  private timeScale: number = 1.0;
  private isPaused: boolean = false;
  private isBackgroundPaused: boolean = false;

  // 交互控制
  private isPointerDown: boolean = false;
  private pointerStartX: number = 0;
  private pointerStartY: number = 0;
  private lastPointerX: number = 0;
  private lastPointerY: number = 0;
  private dragThresholdPx: number = 6;
  private hasDragged: boolean = false;
  private activePointers: Map<number, { x: number; y: number }> = new Map();
  private lastPinchDistance: number = 0;
  private titanInfraredMode: boolean = false;
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
      preserveDrawingBuffer: true,
    });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.extractDiagnostics(context);

    // 2. 场景与相机
    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      8000
    );

    // 相机控制器：唯一相机写入者
    this.cameraController = new CameraController({
      camera: this.camera,
    });

    // 资源管理器并注册全部生产资产
    this.assetManager = new AssetManager();
    this.assetManager.registerManifest(productionAssetsData.assets as any);

    // 3. 构建星空天球背景
    this.setupSkybox();

    // 4. 构建光照体系
    // 太阳中心点光源（发散到整个太阳系）
    this.sunPointLight = new THREE.PointLight(0xfff8ee, 2.5, 0, 0.005);
    this.sunPointLight.position.set(0, 0, 0);
    this.scene.add(this.sunPointLight);

    // 柔和微弱的环境光（深空星光漫反射）
    this.ambientLight = new THREE.AmbientLight(0x222a38, 0.35);
    this.scene.add(this.ambientLight);

    // 4.1 相机伴随柔和三维补光灯（确保深空航天器表面金属光泽与隔热薄膜清晰呈现）
    const cameraHeadlight = new THREE.DirectionalLight(0xffffff, 0.75);
    cameraHeadlight.position.set(0.6, 0.8, 1.2);
    this.camera.add(cameraHeadlight);
    this.scene.add(this.camera);

    // 5. 轨道线组
    this.orbitLinesGroup = new THREE.Group();
    this.scene.add(this.orbitLinesGroup);

    // 5.1 载具航天器容器与初始载具
    this.scene.add(this.vehicleGroup);
    this.setVehicle(this.currentVehicleId);

    // 6. 初始化所有天体对象（包含太阳、八大行星与主要卫星）
    this.initAllBodies();

    // 7. 绑定输入事件
    this.bindEvents();

    // 8. 启动异步贴图预取与加载管线
    this.loadInitialTextures();

    // 9. 启动单一渲染循环
    this.lastTime = performance.now();
    this.animate();
  }

  private extractDiagnostics(gl: WebGL2RenderingContext): void {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const vendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const maxRB = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
    const highp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision ?? 0;

    const info: WebGLDiagnosticInfo = {
      isWebGL2: true,
      rendererName: renderer ?? 'Unknown',
      vendorName: vendor ?? 'Unknown',
      maxTextureSize: maxTex ?? 0,
      maxRenderBufferSize: maxRB ?? 0,
      highpSupported: highp > 0,
    };

    if (this.callbacks.onWebGLInfo) {
      this.callbacks.onWebGLInfo(info);
    }
  }

  private setupSkybox(): void {
    const skyGeo = new THREE.SphereGeometry(5000, 36, 24);
    const skyMat = new THREE.MeshBasicMaterial({
      color: 0x050810,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.skyboxMesh = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.skyboxMesh);
  }

  /**
   * 初始化太阳、行星与卫星的渲染节点
   */
  private initAllBodies(): void {
    // 太阳球体
    const sunData = BODIES.sun;
    const sunGroup = new THREE.Group();
    const sunRadius = getNavDisplayRadius(sunData.radiusKm, sunData.type);
    const sunGeo = new THREE.SphereGeometry(sunRadius, 48, 48);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffaa22 });
    const sunMesh = new THREE.Mesh(sunGeo, sunMat);
    sunMesh.userData = { bodyId: 'sun' };
    sunGroup.add(sunMesh);
    this.pickableMeshes.push(sunMesh);

    // 太阳日冕光晕
    this.sunCoronaMaterial = createSunCoronaMaterial();
    const coronaGeo = new THREE.SphereGeometry(sunRadius * 1.15, 32, 32);
    const coronaMesh = new THREE.Mesh(coronaGeo, this.sunCoronaMaterial);
    sunGroup.add(coronaMesh);

    this.scene.add(sunGroup);
    this.bodyNodes.set('sun', {
      data: sunData,
      systemGroup: sunGroup,
      mesh: sunMesh,
      displayRadius: sunRadius,
      coronaMesh,
    });

    // 遍历所有行星创建节点与公转轨道线
    const planetIds: BodyId[] = [
      'mercury',
      'venus',
      'earth',
      'mars',
      'jupiter',
      'saturn',
      'uranus',
      'neptune',
    ];

    for (const id of planetIds) {
      const data = BODIES[id];
      if (!data) continue;

      // 1. 系统根节点（平移位置，不随行星自转，便于卫星挂载）
      const systemGroup = new THREE.Group();
      this.scene.add(systemGroup);

      // 2. 行星表面网格
      const displayRadius = getNavDisplayRadius(data.radiusKm, data.type);
      const sphereGeo = new THREE.SphereGeometry(displayRadius, 48, 36);
      const defaultMat = new THREE.MeshStandardMaterial({
        color: data.colorHex ?? 0x888888,
        roughness: 0.85,
        metalness: 0.05,
      });
      const mesh = new THREE.Mesh(sphereGeo, defaultMat);
      mesh.userData = { bodyId: id };
      mesh.rotation.z = THREE.MathUtils.degToRad(data.axialTiltDeg);
      systemGroup.add(mesh);
      this.pickableMeshes.push(mesh);

      const node: BodyRenderNode = {
        data,
        systemGroup,
        mesh,
        displayRadius,
        material: defaultMat,
      };

      // 3. 行星公转轨道线（优雅半透明椭圆）
      if (data.orbitSemiMajorAxisKm > 0) {
        const orbitRadius = getNavOrbitRadius(data.orbitSemiMajorAxisKm);
        const incRad = THREE.MathUtils.degToRad(data.orbitalInclinationDeg || 0);
        const points: THREE.Vector3[] = [];
        const segments = 128;
        for (let i = 0; i <= segments; i++) {
          const angle = (i / segments) * Math.PI * 2;
          const x = orbitRadius * Math.cos(angle);
          const y = orbitRadius * Math.sin(angle) * Math.sin(incRad);
          const z = orbitRadius * Math.sin(angle) * Math.cos(incRad);
          points.push(new THREE.Vector3(x, y, z));
        }
        const orbitGeo = new THREE.BufferGeometry().setFromPoints(points);
        const orbitMat = new THREE.LineBasicMaterial({
          color: data.colorHex ?? 0x557799,
          transparent: true,
          opacity: 0.35,
        });
        const orbitLine = new THREE.LineLoop(orbitGeo, orbitMat);
        this.orbitLinesGroup.add(orbitLine);
        node.orbitLine = orbitLine;
      }

      // 4. 地球专属多层：独立自旋云层与大气光晕
      if (id === 'earth') {
        const cloudGeo = new THREE.SphereGeometry(displayRadius * 1.012, 48, 36);
        const defaultCloudMat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.4,
          wireframe: false,
        });
        const cloudMesh = new THREE.Mesh(cloudGeo, defaultCloudMat);
        systemGroup.add(cloudMesh);
        node.cloudMesh = cloudMesh;

        const haloGeo = new THREE.SphereGeometry(displayRadius * 1.025, 48, 36);
        this.earthHaloMaterial = createAtmosphereHaloMaterial(0x38bdf8, 2.8, 0.75);
        const haloMesh = new THREE.Mesh(haloGeo, this.earthHaloMaterial);
        systemGroup.add(haloMesh);
        node.haloMesh = haloMesh;
      }

      // 5. 金星专属：浓厚大气层外壳与金色大气晕
      if (id === 'venus') {
        const atmGeo = new THREE.SphereGeometry(displayRadius * 1.015, 48, 36);
        const atmMat = new THREE.MeshStandardMaterial({
          color: 0xf5d08a,
          roughness: 0.9,
          metalness: 0.0,
          transparent: true,
          opacity: 0.95,
        });
        const atmMesh = new THREE.Mesh(atmGeo, atmMat);
        atmMesh.userData = { bodyId: 'venus' };
        systemGroup.add(atmMesh);
        node.cloudMesh = atmMesh;

        const haloGeo = new THREE.SphereGeometry(displayRadius * 1.03, 48, 36);
        const haloMesh = new THREE.Mesh(haloGeo, createAtmosphereHaloMaterial(0xfbbf24, 2.2, 0.85));
        systemGroup.add(haloMesh);
        node.haloMesh = haloMesh;
      }

      // 火星：火星红尘大气光晕
      if (id === 'mars') {
        const haloGeo = new THREE.SphereGeometry(displayRadius * 1.018, 48, 36);
        const haloMesh = new THREE.Mesh(haloGeo, createAtmosphereHaloMaterial(0xf87171, 3.2, 0.45));
        systemGroup.add(haloMesh);
        node.haloMesh = haloMesh;
      }

      // 木星：巨行星琥珀色边缘光晕
      if (id === 'jupiter') {
        const haloGeo = new THREE.SphereGeometry(displayRadius * 1.018, 48, 36);
        const haloMesh = new THREE.Mesh(haloGeo, createAtmosphereHaloMaterial(0xfde047, 2.4, 0.45));
        systemGroup.add(haloMesh);
        node.haloMesh = haloMesh;
      }

      // 6. 土星专属：土星光环几何体与金色晕
      if (id === 'saturn' && data.ringConfig) {
        const innerR = displayRadius * data.ringConfig.innerRadiusRatio;
        const outerR = displayRadius * data.ringConfig.outerRadiusRatio;
        const ringGeo = new THREE.RingGeometry(innerR, outerR, 96);
        // 使环几何体位于 X-Z 平面
        ringGeo.rotateX(Math.PI / 2);

        const defaultRingMat = new THREE.MeshBasicMaterial({
          color: 0xd0b885,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.75,
        });
        const ringMesh = new THREE.Mesh(ringGeo, defaultRingMat);
        ringMesh.rotation.z = THREE.MathUtils.degToRad(data.axialTiltDeg);
        systemGroup.add(ringMesh);
        node.ringMesh = ringMesh;

        const haloGeo = new THREE.SphereGeometry(displayRadius * 1.018, 48, 36);
        const haloMesh = new THREE.Mesh(haloGeo, createAtmosphereHaloMaterial(0xfef08a, 2.5, 0.45));
        systemGroup.add(haloMesh);
        node.haloMesh = haloMesh;
      }

      // 天王星与海王星：甲烷散射天青与深蓝光晕
      if (id === 'uranus') {
        const haloGeo = new THREE.SphereGeometry(displayRadius * 1.025, 48, 36);
        const haloMesh = new THREE.Mesh(haloGeo, createAtmosphereHaloMaterial(0x38bdf8, 2.4, 0.65));
        systemGroup.add(haloMesh);
        node.haloMesh = haloMesh;

        // 天王星倾斜立式光环系统
        if (data.ringConfig) {
          const innerR = displayRadius * data.ringConfig.innerRadiusRatio;
          const outerR = displayRadius * data.ringConfig.outerRadiusRatio;
          const ringGeo = new THREE.RingGeometry(innerR, outerR, 64);
          ringGeo.rotateX(Math.PI / 2);
          const ringMat = new THREE.MeshBasicMaterial({
            color: 0x67e8f9,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.45,
          });
          const ringMesh = new THREE.Mesh(ringGeo, ringMat);
          ringMesh.rotation.z = THREE.MathUtils.degToRad(data.axialTiltDeg);
          systemGroup.add(ringMesh);
          node.ringMesh = ringMesh;
        }
      }

      if (id === 'neptune') {
        const haloGeo = new THREE.SphereGeometry(displayRadius * 1.025, 48, 36);
        const haloMesh = new THREE.Mesh(haloGeo, createAtmosphereHaloMaterial(0x3b82f6, 2.4, 0.75));
        systemGroup.add(haloMesh);
        node.haloMesh = haloMesh;
      }

      this.bodyNodes.set(id, node);
    }

    // 初始化核心卫星（月球、火星卫星、伽利略四卫星、土卫六/二）
    const satelliteIds: BodyId[] = [
      'moon',
      'phobos',
      'deimos',
      'io',
      'europa',
      'ganymede',
      'callisto',
      'titan',
      'enceladus',
    ];

    for (const satId of satelliteIds) {
      const satData = BODIES[satId];
      if (!satData || !satData.parentId) continue;

      const parentNode = this.bodyNodes.get(satData.parentId);
      if (!parentNode) continue;

      const satGroup = new THREE.Group();
      // 挂载在行星系统的平移根节点下（随行星平移，但不随行星自转！）
      parentNode.systemGroup.add(satGroup);

      const satRadius = Math.max(0.35, getNavDisplayRadius(satData.radiusKm, satData.type));
      const satGeo = new THREE.SphereGeometry(satRadius, 32, 24);
      const satMat = new THREE.MeshStandardMaterial({
        color: satData.colorHex ?? 0xaaaaaa,
        roughness: 0.9,
      });
      const satMesh = new THREE.Mesh(satGeo, satMat);
      satMesh.userData = { bodyId: satId };
      satMesh.rotation.z = THREE.MathUtils.degToRad(satData.axialTiltDeg || 0);
      satGroup.add(satMesh);
      this.pickableMeshes.push(satMesh);

      let satHalo: THREE.Mesh | undefined;
      let satCloudMesh: THREE.Mesh | undefined;
      if (satId === 'titan') {
        // 土卫六可见光浓厚光化学烟雾外壳
        const atmGeo = new THREE.SphereGeometry(satRadius * 1.018, 32, 24);
        const atmMat = new THREE.MeshStandardMaterial({
          color: 0xf59e0b,
          roughness: 0.95,
          transparent: true,
          opacity: 0.95,
        });
        satCloudMesh = new THREE.Mesh(atmGeo, atmMat);
        satCloudMesh.userData = { bodyId: 'titan' };
        satGroup.add(satCloudMesh);

        const haloGeo = new THREE.SphereGeometry(satRadius * 1.035, 32, 24);
        satHalo = new THREE.Mesh(haloGeo, createAtmosphereHaloMaterial(0xf97316, 2.0, 0.88));
        satGroup.add(satHalo);
      }

      this.bodyNodes.set(satId, {
        data: satData,
        systemGroup: satGroup,
        mesh: satMesh,
        displayRadius: satRadius,
        material: satMat,
        cloudMesh: satCloudMesh,
        haloMesh: satHalo,
      });
    }
  }

  /**
   * 异步并行加载与挂载所有高质量 2K 真实生产贴图
   */
  private async loadInitialTextures(): Promise<void> {
    const token = this.cameraController.getSnapshot().commandId;

    // 1. 深空星图背景 (银河与万千繁星)
    this.assetManager.loadTexture('stars-bg-sss-2k', token, () => true).then((starsTex) => {
      if (starsTex && this.skyboxMesh) {
        const mat = this.skyboxMesh.material as THREE.MeshBasicMaterial;
        mat.color.set(0xffffff);
        mat.map = starsTex;
        mat.needsUpdate = true;
      }
    }).catch((e) => console.error('[Texture] Skybox load failed:', e));

    // 2. 太阳光球层贴图
    this.assetManager.loadTexture('sun-sss-2k', token, () => true).then((sunTex) => {
      const sunNode = this.bodyNodes.get('sun');
      if (sunTex && sunNode) {
        this.sunMaterial = createSunMaterial(sunTex);
        safeDisposeMaterial(sunNode.mesh.material);
        sunNode.mesh.material = this.sunMaterial;
      }
    }).catch((e) => console.error('[Texture] Sun load failed:', e));

    // 3. 地球多层多波段 Shader（白昼 + 夜晚灯光 + 独立云层）
    Promise.all([
      this.assetManager.loadTexture('earth-day-sss-2k', token, () => true),
      this.assetManager.loadTexture('earth-night-sss-2k', token, () => true),
      this.assetManager.loadTexture('earth-clouds-sss-2k', token, () => true),
    ]).then(([dayTex, nightTex, cloudsTex]) => {
      const earthNode = this.bodyNodes.get('earth');
      if (earthNode && dayTex && nightTex) {
        this.earthMaterial = createEarthSurfaceMaterial(dayTex, nightTex);
        const sunDir = earthNode.systemGroup.position.clone().negate().normalize();
        this.earthMaterial.uniforms.sunDirection.value.copy(sunDir);
        this.earthMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
        safeDisposeMaterial(earthNode.mesh.material);
        earthNode.mesh.material = this.earthMaterial;
      }
      if (earthNode && earthNode.cloudMesh && cloudsTex) {
        this.earthCloudMaterial = createEarthCloudMaterial(cloudsTex);
        const sunDir = earthNode.systemGroup.position.clone().negate().normalize();
        this.earthCloudMaterial.uniforms.sunDirection.value.copy(sunDir);
        safeDisposeMaterial(earthNode.cloudMesh.material);
        earthNode.cloudMesh.material = this.earthCloudMaterial;
      }
    }).catch((e) => console.error('[Texture] Earth load failed:', e));

    // 4. 月球 NASA LROC 正射图与主要撞击坑卫星
    this.assetManager.loadTexture('moon-svs-2025-2k', token, () => true).then((moonTex) => {
      if (!moonTex) return;
      const moonNode = this.bodyNodes.get('moon');
      if (moonNode) {
        const mat = moonNode.mesh.material as THREE.MeshStandardMaterial;
        mat.color.set(0xffffff);
        mat.map = moonTex;
        mat.needsUpdate = true;
      }

    }).catch((e) => console.error('[Texture] Moon load failed:', e));

    // 4.1 挂载核心卫星专属高拟真科学地貌纹理
    const ioNode = this.bodyNodes.get('io');
    if (ioNode) {
      const mat = ioNode.mesh.material as THREE.MeshStandardMaterial;
      mat.color.set(0xffffff);
      mat.map = getIoTexture();
      mat.roughness = 0.85;
      mat.needsUpdate = true;
    }

    const europaNode = this.bodyNodes.get('europa');
    if (europaNode) {
      const mat = europaNode.mesh.material as THREE.MeshStandardMaterial;
      mat.color.set(0xffffff);
      mat.map = getEuropaTexture();
      mat.roughness = 0.45;
      mat.metalness = 0.08;
      mat.needsUpdate = true;
    }

    const enceladusNode = this.bodyNodes.get('enceladus');
    if (enceladusNode) {
      const mat = enceladusNode.mesh.material as THREE.MeshStandardMaterial;
      mat.color.set(0xffffff);
      mat.map = getEnceladusTexture();
      mat.roughness = 0.35;
      mat.needsUpdate = true;
    }

    const titanNode = this.bodyNodes.get('titan');
    if (titanNode) {
      // 内部：卡西尼 938nm 近红外穿透地表
      const surfMat = titanNode.mesh.material as THREE.MeshStandardMaterial;
      surfMat.color.set(0xffffff);
      surfMat.map = getTitanNearInfraredTexture();
      surfMat.roughness = 0.85;
      surfMat.needsUpdate = true;

      // 外部：可见光橘黄光化学烟雾大气层
      if (titanNode.cloudMesh) {
        const atmMat = titanNode.cloudMesh.material as THREE.MeshStandardMaterial;
        atmMat.color.set(0xffffff);
        atmMat.map = getTitanHazeTexture();
        atmMat.roughness = 0.95;
        atmMat.needsUpdate = true;
      }
    }

    const ganymedeNode = this.bodyNodes.get('ganymede');
    if (ganymedeNode) {
      const mat = ganymedeNode.mesh.material as THREE.MeshStandardMaterial;
      mat.color.set(0xffffff);
      mat.map = getGanymedeTexture();
      mat.roughness = 0.88;
      mat.needsUpdate = true;
    }

    const callistoNode = this.bodyNodes.get('callisto');
    if (callistoNode) {
      const mat = callistoNode.mesh.material as THREE.MeshStandardMaterial;
      mat.color.set(0xffffff);
      mat.map = getCallistoTexture();
      mat.roughness = 0.9;
      mat.needsUpdate = true;
    }

    const phobosNode = this.bodyNodes.get('phobos');
    if (phobosNode) {
      const mat = phobosNode.mesh.material as THREE.MeshStandardMaterial;
      mat.color.set(0xffffff);
      mat.map = getMarsMoonTexture(true);
      mat.roughness = 0.92;
      mat.needsUpdate = true;
    }

    const deimosNode = this.bodyNodes.get('deimos');
    if (deimosNode) {
      const mat = deimosNode.mesh.material as THREE.MeshStandardMaterial;
      mat.color.set(0xffffff);
      mat.map = getMarsMoonTexture(false);
      mat.roughness = 0.92;
      mat.needsUpdate = true;
    }

    // 5. 金星（大气与穿透地表雷达图）
    Promise.all([
      this.assetManager.loadTexture('venus-atmosphere-sss-2k', token, () => true),
      this.assetManager.loadTexture('venus-surface-sss-2k', token, () => true),
    ]).then(([atmTex, surfTex]) => {
      const venusNode = this.bodyNodes.get('venus');
      if (venusNode) {
        if (surfTex) {
          const mat = venusNode.mesh.material as THREE.MeshStandardMaterial;
          mat.color.set(0xffffff);
          mat.map = surfTex;
          mat.needsUpdate = true;
        }
        if (venusNode.cloudMesh && atmTex) {
          const atmMat = venusNode.cloudMesh.material as THREE.MeshStandardMaterial;
          atmMat.color.set(0xffffff);
          atmMat.map = atmTex;
          atmMat.needsUpdate = true;
        }
      }
    }).catch((e) => console.error('[Texture] Venus load failed:', e));

    // 6. 水星与火星
    this.assetManager.loadTexture('mercury-sss-2k', token, () => true).then((mercuryTex) => {
      const node = this.bodyNodes.get('mercury');
      if (mercuryTex && node) {
        const mat = node.mesh.material as THREE.MeshStandardMaterial;
        mat.color.set(0xffffff);
        mat.map = mercuryTex;
        mat.needsUpdate = true;
      }
    }).catch((e) => console.error('[Texture] Mercury load failed:', e));

    this.assetManager.loadTexture('mars-sss-2k', token, () => true).then((marsTex) => {
      const node = this.bodyNodes.get('mars');
      if (marsTex && node) {
        const mat = node.mesh.material as THREE.MeshStandardMaterial;
        mat.color.set(0xffffff);
        mat.map = marsTex;
        mat.needsUpdate = true;
      }
    }).catch((e) => console.error('[Texture] Mars load failed:', e));

    // 7. 木星
    this.assetManager.loadTexture('jupiter-sss-2k', token, () => true).then((jupiterTex) => {
      const node = this.bodyNodes.get('jupiter');
      if (jupiterTex && node) {
        const mat = node.mesh.material as THREE.MeshStandardMaterial;
        mat.color.set(0xffffff);
        mat.map = jupiterTex;
        mat.needsUpdate = true;
      }
    }).catch((e) => console.error('[Texture] Jupiter load failed:', e));

    // 8. 土星与土星环
    Promise.all([
      this.assetManager.loadTexture('saturn-sss-2k', token, () => true),
      this.assetManager.loadTexture('saturn-rings-sss-2k', token, () => true),
    ]).then(([saturnTex, saturnRingsTex]) => {
      const saturnNode = this.bodyNodes.get('saturn');
      if (saturnTex && saturnNode) {
        const mat = saturnNode.mesh.material as THREE.MeshStandardMaterial;
        mat.color.set(0xffffff);
        mat.map = saturnTex;
        mat.needsUpdate = true;
      }
      if (saturnRingsTex && saturnNode && saturnNode.ringMesh && saturnNode.data.ringConfig) {
        this.saturnRingMaterial = createSaturnRingMaterial({
          innerRadius: saturnNode.displayRadius * saturnNode.data.ringConfig.innerRadiusRatio,
          outerRadius: saturnNode.displayRadius * saturnNode.data.ringConfig.outerRadiusRatio,
          ringTexture: saturnRingsTex,
          planetRadius: saturnNode.displayRadius,
        });
        safeDisposeMaterial(saturnNode.ringMesh.material);
        saturnNode.ringMesh.material = this.saturnRingMaterial;
      }
    }).catch((e) => console.error('[Texture] Saturn load failed:', e));

    // 9. 天王星与海王星
    this.assetManager.loadTexture('uranus-sss-2k', token, () => true).then((uranusTex) => {
      const node = this.bodyNodes.get('uranus');
      if (uranusTex && node) {
        const mat = node.mesh.material as THREE.MeshStandardMaterial;
        mat.color.set(0xffffff);
        mat.map = uranusTex;
        mat.needsUpdate = true;
      }
    }).catch((e) => console.error('[Texture] Uranus load failed:', e));

    this.assetManager.loadTexture('neptune-sss-2k', token, () => true).then((neptuneTex) => {
      const node = this.bodyNodes.get('neptune');
      if (neptuneTex && node) {
        const mat = node.mesh.material as THREE.MeshStandardMaterial;
        mat.color.set(0xffffff);
        mat.map = neptuneTex;
        mat.needsUpdate = true;
      }
    }).catch((e) => console.error('[Texture] Neptune load failed:', e));
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.onResize);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.canvas.addEventListener('webglcontextlost', this.onContextLost, false);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored, false);
  }

  private onVisibilityChange = (): void => {
    if (document.hidden) {
      this.isBackgroundPaused = true;
    } else {
      this.isBackgroundPaused = false;
      this.lastTime = performance.now();
    }
  };

  private onContextLost = (e: Event): void => {
    e.preventDefault();
    console.warn('[SolarEngine] WebGL context lost!');
    if (this.callbacks.onContextState) {
      this.callbacks.onContextState('lost');
    }
  };

  private onContextRestored = (): void => {
    console.info('[SolarEngine] WebGL context restored! Recovering rendering pipeline...');
    if (this.callbacks.onContextState) {
      this.callbacks.onContextState('restored');
    }
    this.lastTime = performance.now();
  };

  private onResize = (): void => {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    if (this.activePointers.size === 1) {
      this.isPointerDown = true;
      this.hasDragged = false;
      this.pointerStartX = e.clientX;
      this.pointerStartY = e.clientY;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    } else if (this.activePointers.size === 2) {
      const pts = Array.from(this.activePointers.values());
      this.lastPinchDistance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      this.hasDragged = true;
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.activePointers.has(e.pointerId)) return;
    this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // 双指触控捏合缩放
    if (this.activePointers.size === 2) {
      const pts = Array.from(this.activePointers.values());
      const currentDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (this.lastPinchDistance > 0) {
        const delta = (this.lastPinchDistance - currentDist) * 0.25;
        this.cameraController.executeCommand({ type: 'zoom', deltaDist: delta });
        this.emitSnapshot();
      }
      this.lastPinchDistance = currentDist;
      return;
    }

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
    this.activePointers.delete(e.pointerId);

    if (this.activePointers.size === 0) {
      this.lastPinchDistance = 0;
      if (!this.isPointerDown) return;
      this.isPointerDown = false;

      // 若未发生拖拽位移，视为一次精准点击拾取
      if (!this.hasDragged) {
        this.handlePick(e.clientX, e.clientY);
      }
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const zoomFactor = e.deltaY * 0.08;
    this.cameraController.executeCommand({ type: 'zoom', deltaDist: zoomFactor });
    this.emitSnapshot();
  };

  private handlePick(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const intersects = this.raycaster.intersectObjects(this.pickableMeshes);

    if (intersects.length > 0) {
      const hit = intersects[0].object;
      const bodyId = hit.userData.bodyId as BodyId;
      if (bodyId) {
        soundEffects.playClick();
        this.cameraController.executeCommand({ type: 'select', bodyId });
        if (this.callbacks.onSelectBody) {
          this.callbacks.onSelectBody(bodyId);
        }
        this.emitSnapshot();
      }
    }
  }

  public executeCameraCommand(cmd: CameraCommand): void {
    if (cmd.type === 'flyTo' || cmd.type === 'overview' || cmd.type === 'restoreBookmark') {
      soundEffects.playWarp();
    } else if (cmd.type === 'select') {
      soundEffects.playClick();
    }
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
    const earthNode = this.bodyNodes.get('earth');
    if (earthNode && earthNode.cloudMesh) {
      earthNode.cloudMesh.visible = show;
    }
  }

  public setTeachingLight(enable: boolean): void {
    this.teachingLight = enable;
    if (this.earthMaterial) {
      this.earthMaterial.uniforms.teachingLight.value = enable ? 1.0 : 0.0;
    }
    // 增加全局环境光以辅助暗部辨识
    this.ambientLight.intensity = enable ? 0.85 : 0.35;
  }

  public setShowAtmosphere(show: boolean): void {
    this.showAtmosphere = show;
    for (const node of this.bodyNodes.values()) {
      if (node.haloMesh) {
        node.haloMesh.visible = show;
      }
    }
  }

  public setShowOrbits(show: boolean): void {
    this.showOrbits = show;
    this.orbitLinesGroup.visible = show;
  }

  public setShowVenusSurface(radar: boolean): void {
    this.venusRadarMode = radar;
    soundEffects.playRadarPing();
    const venusNode = this.bodyNodes.get('venus');
    if (venusNode && venusNode.cloudMesh) {
      // 雷达模式下隐藏浓厚大气，展现熔岩表面
      venusNode.cloudMesh.visible = !radar;
    }
  }

  public setShowTitanInfrared(infrared: boolean): void {
    this.titanInfraredMode = infrared;
    soundEffects.playRadarPing();
    const titanNode = this.bodyNodes.get('titan');
    if (titanNode && titanNode.cloudMesh) {
      // 近红外模式下隐藏橘黄迷雾外壳，展现卡西尼号近红外地表
      titanNode.cloudMesh.visible = !infrared;
    }
  }

  public isTitanInfraredMode(): boolean {
    return this.titanInfraredMode;
  }

  public setReduceMotion(enabled: boolean): void {
    this.reduceMotion = enabled;
    this.cameraController.setReduceMotion(enabled);
  }

  public isReduceMotion(): boolean {
    return this.reduceMotion;
  }

  public isTeachingLight(): boolean {
    return this.teachingLight;
  }

  public isShowClouds(): boolean {
    return this.showClouds;
  }

  public isShowAtmosphere(): boolean {
    return this.showAtmosphere;
  }

  public isShowOrbits(): boolean {
    return this.showOrbits;
  }

  public isVenusRadarMode(): boolean {
    return this.venusRadarMode;
  }

  public setVehicle(id: VehicleId | null): void {
    if (this.currentVehicleMesh) {
      this.vehicleGroup.remove(this.currentVehicleMesh);
      this.currentVehicleMesh.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          mesh.geometry.dispose();
          safeDisposeMaterial(mesh.material);
        }
      });
      this.currentVehicleMesh = null;
    }

    this.currentVehicleId = id;
    if (!id) return;

    const mesh = VehicleMeshBuilder.buildVehicle(id);
    const box = new THREE.Box3().setFromObject(mesh);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z, 0.01);
    mesh.userData = { originalMaxDim: maxDim };

    this.currentVehicleMesh = mesh;
    this.vehicleGroup.add(mesh);
  }

  public getCurrentVehicle(): VehicleId | null {
    return this.currentVehicleId;
  }

  public setViewCameraMode(mode: ViewCameraMode): void {
    this.viewCameraMode = mode;
  }

  public getViewCameraMode(): ViewCameraMode {
    return this.viewCameraMode;
  }

  public getRendererCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  public renderImmediate(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private emitSnapshot(): void {
    if (this.callbacks.onCameraSnapshot) {
      this.callbacks.onCameraSnapshot(this.cameraController.getSnapshot());
    }
  }

  private animate = (): void => {
    if (!this.isRunning) return;
    this.animFrameId = requestAnimationFrame(this.animate);

    if (this.isBackgroundPaused) {
      return;
    }

    const now = performance.now();
    const deltaSec = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    // 1. 推进模拟时间
    if (!this.isPaused) {
      this.simTimeHours += (deltaSec * this.timeScale) / 3600.0;
    }

    // 更新太阳着色器动画
    if (this.sunMaterial) {
      this.sunMaterial.uniforms.time.value += deltaSec;
    }
    if (this.sunCoronaMaterial) {
      this.sunCoronaMaterial.uniforms.time.value += deltaSec;
    }

    // 2. 更新所有天体的位置与自转
    for (const [id, node] of this.bodyNodes.entries()) {
      if (node.data.type === 'star') {
        // 太阳位于原点，缓慢自转
        const sunRotRad = ((2.0 * Math.PI) / node.data.rotationPeriodHours) * this.simTimeHours;
        node.mesh.rotation.y = sunRotRad;
        continue;
      }

      if (node.data.type === 'planet') {
        // 计算行星在太阳系全景中的开普勒公转坐标
        const [px, py, pz] = getPlanetNavPosition(id, this.simTimeHours);
        node.systemGroup.position.set(px, py, pz);

        // 计算行星自身自转
        const rotRad = ((2.0 * Math.PI) / node.data.rotationPeriodHours) * this.simTimeHours;
        node.mesh.rotation.y = rotRad;

        // 地球专属：更新光照向量与自旋云层流动
        if (id === 'earth') {
          const sunDir = node.systemGroup.position.clone().negate().normalize();
          if (this.earthMaterial) {
            this.earthMaterial.uniforms.sunDirection.value.copy(sunDir);
          }
          if (this.earthCloudMaterial && node.cloudMesh) {
            this.earthCloudMaterial.uniforms.sunDirection.value.copy(sunDir);
            node.cloudMesh.rotation.y = rotRad * 1.04 + (this.simTimeHours * 0.01);
          }
        }

        // 土星专属：更新投射到光环的太阳方向
        if (id === 'saturn' && this.saturnRingMaterial) {
          const sunDir = node.systemGroup.position.clone().negate().normalize();
          this.saturnRingMaterial.uniforms.sunDirection.value.copy(sunDir);
        }
      }

      if (node.data.type === 'moon') {
        // 依据开普勒真实周期与审美分层计算卫星局部位置，杜绝天体穿模挤压
        const [mx, my, mz] = getSatelliteNavPosition(id, this.simTimeHours);
        node.systemGroup.position.set(mx, my, mz);

        // 潮汐锁定：始终朝向母星
        const moonOrbitAngle = Math.atan2(mz, mx);
        node.mesh.rotation.y = -moonOrbitAngle;
      }

      // 更新大气光晕的向日方向
      if (node.haloMesh && (node.haloMesh.material as THREE.ShaderMaterial).uniforms?.sunDirection) {
        const worldPos = new THREE.Vector3();
        node.mesh.getWorldPosition(worldPos);
        const sunDir = worldPos.negate().normalize();
        (node.haloMesh.material as THREE.ShaderMaterial).uniforms.sunDirection.value.copy(sunDir);
      }
    }

    // 3. 更新载具空间位置与伴飞/随船/绕飞姿态
    if (this.currentVehicleMesh && this.currentVehicleId) {
      const origDim = (this.currentVehicleMesh.userData.originalMaxDim as number) || 5.0;

      if (this.viewCameraMode === 'VEHICLE_FORMATION') {
        if (this.vehicleGroup.parent !== this.camera) {
          this.camera.add(this.vehicleGroup);
        }
        this.vehicleGroup.visible = true;

        // 伴飞视角：航天器稳固置于相机右前下方前景（视觉占比约 18%-22%）
        const normScale = 0.85 / origDim;
        this.currentVehicleMesh.scale.setScalar(normScale);

        const bob = this.reduceMotion ? 0.0 : Math.sin(now * 0.002) * 0.012;
        this.vehicleGroup.position.set(0.48, -0.34 + bob, -2.1);
        this.vehicleGroup.rotation.set(0.12, -0.38, 0);
      } else if (this.viewCameraMode === 'VEHICLE_ONBOARD') {
        if (this.vehicleGroup.parent !== this.camera) {
          this.camera.add(this.vehicleGroup);
        }
        this.vehicleGroup.visible = true;

        // 随船视角：前向传感器/机鼻俯瞰观察
        const normScale = 0.95 / origDim;
        this.currentVehicleMesh.scale.setScalar(normScale);

        this.vehicleGroup.position.set(0.0, -0.42, -1.35);
        this.vehicleGroup.rotation.set(0.06, 0, 0);
      } else {
        if (this.vehicleGroup.parent !== this.scene) {
          this.scene.add(this.vehicleGroup);
        }
        // PLANET_OBSERVE: 航天器在当前目标星球轨道优雅巡航
        const targetId = this.cameraController.getSnapshot().targetBodyId;
        const targetNode = (targetId ? this.bodyNodes.get(targetId) : null) || this.bodyNodes.get('earth');
        if (targetNode) {
          this.vehicleGroup.visible = true;
          const worldPos = new THREE.Vector3();
          targetNode.mesh.getWorldPosition(worldPos);
          const orbitR = targetNode.displayRadius * 1.55;
          this.vehicleOrbitAngle += deltaSec * 0.25;

          const orbitScale = Math.max(targetNode.displayRadius * 0.09, 0.45) / origDim;
          this.currentVehicleMesh.scale.setScalar(orbitScale);

          const vx = worldPos.x + Math.cos(this.vehicleOrbitAngle) * orbitR;
          const vy = worldPos.y + Math.sin(this.vehicleOrbitAngle * 0.8) * (orbitR * 0.2);
          const vz = worldPos.z + Math.sin(this.vehicleOrbitAngle) * orbitR;

          this.vehicleGroup.position.set(vx, vy, vz);

          const tangent = new THREE.Vector3(
            -Math.sin(this.vehicleOrbitAngle),
            0.1,
            Math.cos(this.vehicleOrbitAngle)
          ).normalize();
          this.vehicleGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), tangent);
        } else {
          this.vehicleGroup.visible = false;
        }
      }
    } else {
      this.vehicleGroup.visible = false;
    }

    // 4. 星空背景天球跟随相机移动（保持无尽远景感）
    if (this.skyboxMesh) {
      this.skyboxMesh.position.copy(this.camera.position);
    }

    // 5. 更新单一相机控制器
    this.cameraController.update(deltaSec, (id: BodyId) => {
      const node = this.bodyNodes.get(id);
      if (!node) {
        return { pos: new THREE.Vector3(0, 0, 0), radius: 5.0 };
      }

      // 获取天体在世界空间中的绝对坐标
      const worldPos = new THREE.Vector3();
      node.mesh.getWorldPosition(worldPos);

      let effectiveRadius = node.displayRadius;
      if (node.ringMesh && node.data.ringConfig) {
        effectiveRadius *= node.data.ringConfig.outerRadiusRatio;
      }

      return {
        pos: worldPos,
        radius: effectiveRadius,
      };
    });

    // 6. 渲染一帧
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
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);

    this.assetManager.disposeAll();

    if (this.currentVehicleMesh) {
      this.currentVehicleMesh.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          mesh.geometry.dispose();
          safeDisposeMaterial(mesh.material);
        }
      });
    }

    if (this.skyboxMesh) {
      this.skyboxMesh.geometry.dispose();
      safeDisposeMaterial(this.skyboxMesh.material);
    }

    for (const node of this.bodyNodes.values()) {
      node.mesh.geometry.dispose();
      safeDisposeMaterial(node.mesh.material);
      if (node.cloudMesh) {
        node.cloudMesh.geometry.dispose();
        safeDisposeMaterial(node.cloudMesh.material);
      }
      if (node.haloMesh) {
        node.haloMesh.geometry.dispose();
        safeDisposeMaterial(node.haloMesh.material);
      }
      if (node.ringMesh) {
        node.ringMesh.geometry.dispose();
        safeDisposeMaterial(node.ringMesh.material);
      }
      if (node.orbitLine) {
        node.orbitLine.geometry.dispose();
        safeDisposeMaterial(node.orbitLine.material);
      }
    }

    this.renderer.dispose();

    if (this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
  }
}
