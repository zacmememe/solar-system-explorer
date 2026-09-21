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
import {
  createSaturnRingMaterial,
  createRingShadowPlanetMaterial,
  getUranusRingTexture,
  getNeptuneRingTexture,
} from '../rendering/RingMaterial';
import { createSunMaterial, createSunCoronaMaterial } from '../rendering/SunMaterial';
import { buildIrregularMoonGeometry } from '../astronomy/IrregularMeshBuilder';
import type { BodyId, CelestialBodyData } from '../contracts/body';
import type { CameraCommand, CameraStateSnapshot } from '../contracts/camera';
import type { VehicleId, ViewCameraMode } from '../contracts/vehicle';
import {
  getMoonTextureByBodyId,
  getTitanHazeTexture,
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

export interface CelestialLabelItem {
  id: BodyId;
  name: string;
  nameEn: string;
  screenX: number;
  screenY: number;
  isVisible: boolean;
  type: string;
}

export interface SolarEngineCallbacks {
  onSelectBody?: (bodyId: BodyId) => void;
  onCameraSnapshot?: (snapshot: CameraStateSnapshot) => void;
  onWebGLInfo?: (info: WebGLDiagnosticInfo) => void;
  onContextState?: (state: 'lost' | 'restored') => void;
  onCelestialLabels?: (labels: CelestialLabelItem[]) => void;
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
  private cameraHeadlight: THREE.DirectionalLight;

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

  // 纹理与材质缓存
  private saturnRingMaterial: THREE.ShaderMaterial | null = null;
  private saturnPlanetMaterial: THREE.ShaderMaterial | null = null;
  private uranusRingMaterial: THREE.ShaderMaterial | null = null;
  private neptuneRingMaterial: THREE.ShaderMaterial | null = null;
  private sunMaterial: THREE.ShaderMaterial | null = null;
  private sunCoronaMaterial: THREE.ShaderMaterial | null = null;

  // 载具航天器系统
  private currentVehicleId: VehicleId | null = 'apollo-lm';
  private vehicleGroup: THREE.Group = new THREE.Group();
  private currentVehicleMesh: THREE.Group | null = null;
  private viewCameraMode: ViewCameraMode = 'PLANET_OBSERVE';
  private prevIsTransitioning: boolean = false;

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
    this.ambientLight = new THREE.AmbientLight(0x222a38, 0.22);
    this.scene.add(this.ambientLight);

    // 4.1 相机伴随补光灯（航天器伴飞与教学模式下动态启用，全景观测模式下保持关闭）
    this.cameraHeadlight = new THREE.DirectionalLight(0xffffff, 0.0);
    this.cameraHeadlight.position.set(0.6, 0.8, 1.2);
    this.camera.add(this.cameraHeadlight);
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

    // 太阳高能日冕辐射流（面向相机自适应公告板，超大尺度柔和指数衰减，彻底杜绝硬环切面）
    const quadSize = sunRadius * 4.2;
    this.sunCoronaMaterial = createSunCoronaMaterial(sunRadius / (quadSize * 0.5));
    const coronaGeo = new THREE.PlaneGeometry(quadSize, quadSize);
    const coronaMesh = new THREE.Mesh(coronaGeo, this.sunCoronaMaterial);
    coronaMesh.frustumCulled = false;
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
          const ringGeo = new THREE.RingGeometry(innerR, outerR, 96);
          ringGeo.rotateX(Math.PI / 2);
          this.uranusRingMaterial = createSaturnRingMaterial({
            innerRadius: innerR,
            outerRadius: outerR,
            ringTexture: getUranusRingTexture(),
            planetRadius: displayRadius,
          });
          const ringMesh = new THREE.Mesh(ringGeo, this.uranusRingMaterial);
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

        // 海王星微弱暗色尘埃与弧段光环系统
        if (data.ringConfig) {
          const innerR = displayRadius * data.ringConfig.innerRadiusRatio;
          const outerR = displayRadius * data.ringConfig.outerRadiusRatio;
          const ringGeo = new THREE.RingGeometry(innerR, outerR, 96);
          ringGeo.rotateX(Math.PI / 2);
          this.neptuneRingMaterial = createSaturnRingMaterial({
            innerRadius: innerR,
            outerRadius: outerR,
            ringTexture: getNeptuneRingTexture(),
            planetRadius: displayRadius,
          });
          const ringMesh = new THREE.Mesh(ringGeo, this.neptuneRingMaterial);
          ringMesh.rotation.z = THREE.MathUtils.degToRad(data.axialTiltDeg);
          systemGroup.add(ringMesh);
          node.ringMesh = ringMesh;
        }
      }

      this.bodyNodes.set(id, node);
    }

    // 初始化太阳系全 23 颗天然卫星体系（地球、火星、木星、土星、天王星、海王星）
    const satelliteIds: BodyId[] = [
      'moon',
      'phobos',
      'deimos',
      'amalthea',
      'io',
      'europa',
      'ganymede',
      'callisto',
      'mimas',
      'enceladus',
      'tethys',
      'dione',
      'rhea',
      'titan',
      'hyperion',
      'iapetus',
      'miranda',
      'ariel',
      'umbriel',
      'titania',
      'oberon',
      'triton',
      'proteus',
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
      // 物理真实建模：非流体静力平衡小天体采用三轴椭球与特征陨石坑网格，告别千篇一律的圆球
      const satGeo = satData.shapeType === 'irregular'
        ? buildIrregularMoonGeometry(satData, satRadius)
        : new THREE.SphereGeometry(satRadius, 32, 24);
      const satMat = new THREE.MeshStandardMaterial({
        color: satData.colorHex ?? 0xaaaaaa,
        roughness: 0.9,
      });
      const satMesh = new THREE.Mesh(satGeo, satMat);
      satMesh.userData = { bodyId: satId };
      satMesh.rotation.z = THREE.MathUtils.degToRad(satData.axialTiltDeg || 0);
      satGroup.add(satMesh);
      this.pickableMeshes.push(satMesh);

      // 卫星局部公转轨道线（优雅微弱半透明环，直观呈现多星系同心轨道分布）
      let satOrbitLine: THREE.LineLoop | undefined;
      if (satData.orbitSemiMajorAxisKm > 0) {
        const parentR = getNavDisplayRadius(parentNode.data.radiusKm, parentNode.data.type);
        const baseClearance = parentNode.data.ringConfig
          ? parentR * (parentNode.data.ringConfig.outerRadiusRatio + 0.38)
          : parentR * 2.65;
        const normDist = Math.pow((satData.orbitSemiMajorAxisKm || 100000) / 100000.0, 0.52);
        const visualOrbitR = baseClearance + normDist * (parentR * 1.35);
        const incRad = THREE.MathUtils.degToRad(satData.orbitalInclinationDeg || 0);

        const pts: THREE.Vector3[] = [];
        const segs = 64;
        for (let i = 0; i <= segs; i++) {
          const a = (i / segs) * Math.PI * 2;
          pts.push(new THREE.Vector3(
            visualOrbitR * Math.cos(a),
            visualOrbitR * Math.sin(a) * Math.sin(incRad),
            visualOrbitR * Math.sin(a) * Math.cos(incRad)
          ));
        }
        const satOrbitGeo = new THREE.BufferGeometry().setFromPoints(pts);
        const satOrbitMat = new THREE.LineBasicMaterial({
          color: satData.colorHex ?? 0x64748b,
          transparent: true,
          opacity: 0.22,
        });
        satOrbitLine = new THREE.LineLoop(satOrbitGeo, satOrbitMat);
        satOrbitLine.visible = this.showOrbits;
        parentNode.systemGroup.add(satOrbitLine);
      }

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
        orbitLine: satOrbitLine,
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

    // 4.1 挂载全 23 颗天然卫星高拟真科学地貌纹理
    const allMoonIds: BodyId[] = [
      'phobos',
      'deimos',
      'amalthea',
      'io',
      'europa',
      'ganymede',
      'callisto',
      'mimas',
      'enceladus',
      'tethys',
      'dione',
      'rhea',
      'titan',
      'hyperion',
      'iapetus',
      'miranda',
      'ariel',
      'umbriel',
      'titania',
      'oberon',
      'triton',
      'proteus',
    ];

    for (const satId of allMoonIds) {
      const satNode = this.bodyNodes.get(satId);
      if (!satNode) continue;
      const tex = getMoonTextureByBodyId(satId);
      if (tex) {
        const mat = satNode.mesh.material as THREE.MeshStandardMaterial;
        mat.color.set(0xffffff);
        mat.map = tex;
        mat.roughness = satId === 'europa' ? 0.45 : satId === 'enceladus' ? 0.35 : 0.88;
        mat.metalness = satId === 'europa' ? 0.08 : 0.02;
        mat.needsUpdate = true;
      }
    }

    // 土卫六专属：可见光浓厚橘黄光化学烟雾大气层
    const titanNode = this.bodyNodes.get('titan');
    if (titanNode && titanNode.cloudMesh) {
      const atmMat = titanNode.cloudMesh.material as THREE.MeshStandardMaterial;
      atmMat.color.set(0xffffff);
      atmMat.map = getTitanHazeTexture();
      atmMat.roughness = 0.95;
      atmMat.needsUpdate = true;
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

    // 8. 土星本体与土星光环（双向投射阴影）
    Promise.all([
      this.assetManager.loadTexture('saturn-sss-2k', token, () => true),
      this.assetManager.loadTexture('saturn-rings-sss-2k', token, () => true),
    ]).then(([saturnTex, saturnRingsTex]) => {
      const saturnNode = this.bodyNodes.get('saturn');
      if (saturnTex && saturnRingsTex && saturnNode && saturnNode.data.ringConfig) {
        const innerR = saturnNode.displayRadius * saturnNode.data.ringConfig.innerRadiusRatio;
        const outerR = saturnNode.displayRadius * saturnNode.data.ringConfig.outerRadiusRatio;

        // 1. 土星本体：受星环深邃黑带条带投影阴影材质
        this.saturnPlanetMaterial = createRingShadowPlanetMaterial({
          planetTexture: saturnTex,
          ringTexture: saturnRingsTex,
          innerRadius: innerR,
          outerRadius: outerR,
        });
        this.saturnPlanetMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
        safeDisposeMaterial(saturnNode.mesh.material);
        saturnNode.mesh.material = this.saturnPlanetMaterial;

        // 2. 土星光环：受行星圆柱阴影遮挡的双面透光材质
        if (saturnNode.ringMesh) {
          this.saturnRingMaterial = createSaturnRingMaterial({
            innerRadius: innerR,
            outerRadius: outerR,
            ringTexture: saturnRingsTex,
            planetRadius: saturnNode.displayRadius,
          });
          safeDisposeMaterial(saturnNode.ringMesh.material);
          saturnNode.ringMesh.material = this.saturnRingMaterial;
        }
      }
    }).catch((e) => console.error('[Texture] Saturn load failed:', e));

    // 9. 天王星与海王星
    this.assetManager.loadTexture('uranus-sss-2k', token, () => true).then((uranusTex) => {
      const node = this.bodyNodes.get('uranus');
      if (uranusTex && node) {
        const mat = node.mesh.material as THREE.MeshStandardMaterial;
        mat.color.set(0xffffff);
        mat.map = uranusTex;
        mat.roughness = 0.65;
        mat.metalness = 0.04;
        mat.needsUpdate = true;
      }
    }).catch((e) => console.error('[Texture] Uranus load failed:', e));

    this.assetManager.loadTexture('neptune-sss-2k', token, () => true).then((neptuneTex) => {
      const node = this.bodyNodes.get('neptune');
      if (neptuneTex && node) {
        const mat = node.mesh.material as THREE.MeshStandardMaterial;
        mat.color.set(0xffffff);
        mat.map = neptuneTex;
        mat.roughness = 0.60;
        mat.metalness = 0.04;
        mat.needsUpdate = true;
      }
    }).catch((e) => console.error('[Texture] Neptune load failed:', e));
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.onResize);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('dblclick', this.onDoubleClick);
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

  private onDoubleClick = (e: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const intersects = this.raycaster.intersectObjects(this.pickableMeshes);
    if (intersects.length > 0) {
      const hit = intersects[0].object;
      const bodyId = hit.userData.bodyId as BodyId;
      if (bodyId) {
        soundEffects.playWarp();
        this.executeCameraCommand({ type: 'flyTo', bodyId });
        if (this.callbacks.onSelectBody) {
          this.callbacks.onSelectBody(bodyId);
        }
      }
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

    if (!this.isPointerDown) {
      // 鼠标未拖拽状态下的光标悬浮反馈：滑过可交互天体时变为手型光标
      const rect = this.canvas.getBoundingClientRect();
      this.pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointerNdc, this.camera);
      const hits = this.raycaster.intersectObjects(this.pickableMeshes);
      this.canvas.style.cursor = hits.length > 0 ? 'pointer' : 'default';
      return;
    }

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
    if (cmd.type === 'flyTo' && !cmd.targetPos) {
      const node = this.bodyNodes.get(cmd.bodyId);
      if (node) {
        const wp = new THREE.Vector3();
        node.mesh.getWorldPosition(wp);
        cmd = { ...cmd, targetPos: [wp.x, wp.y, wp.z] };
      }
    }
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

  private updateLightingState(): void {
    const isObserving = this.viewCameraMode === 'PLANET_OBSERVE';
    if (isObserving) {
      if (this.teachingLight) {
        this.cameraHeadlight.intensity = 0.65;
        this.ambientLight.intensity = 0.75;
      } else {
        this.cameraHeadlight.intensity = 0.0;
        this.ambientLight.intensity = 0.22;
      }
    } else {
      // 航天器伴飞/随船视角：启用柔和补光确保隔热箔与机体材质清晰
      this.cameraHeadlight.intensity = 0.70;
      this.ambientLight.intensity = 0.35;
    }

    if (this.earthMaterial) {
      this.earthMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
    }
    if (this.saturnPlanetMaterial) {
      this.saturnPlanetMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
    }
  }

  public setTeachingLight(enable: boolean): void {
    this.teachingLight = enable;
    this.updateLightingState();
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
    for (const node of this.bodyNodes.values()) {
      if (node.orbitLine) {
        node.orbitLine.visible = show;
      }
    }
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
    this.updateLightingState();
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

        // 土星、天王星、海王星专属：更新投射到光环与行星本体的太阳方向与遮挡投影
        if (id === 'saturn' && node.ringMesh) {
          const sunDir = node.systemGroup.position.clone().negate().normalize();
          const localRingSunDir = sunDir.clone().applyQuaternion(node.ringMesh.quaternion.clone().invert());
          if (this.saturnRingMaterial) {
            this.saturnRingMaterial.uniforms.sunDirection.value.copy(localRingSunDir);
          }
          if (this.saturnPlanetMaterial) {
            const localPlanetSunDir = sunDir.clone().applyQuaternion(node.mesh.quaternion.clone().invert());
            this.saturnPlanetMaterial.uniforms.sunDirection.value.copy(localPlanetSunDir);
          }
        }
        if (id === 'uranus' && this.uranusRingMaterial && node.ringMesh) {
          const sunDir = node.systemGroup.position.clone().negate().normalize();
          const localSunDir = sunDir.clone().applyQuaternion(node.ringMesh.quaternion.clone().invert());
          this.uranusRingMaterial.uniforms.sunDirection.value.copy(localSunDir);
        }
        if (id === 'neptune' && this.neptuneRingMaterial && node.ringMesh) {
          const sunDir = node.systemGroup.position.clone().negate().normalize();
          const localSunDir = sunDir.clone().applyQuaternion(node.ringMesh.quaternion.clone().invert());
          this.neptuneRingMaterial.uniforms.sunDirection.value.copy(localSunDir);
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
        // PLANET_OBSERVE: 纯净行星全景观测，隐藏航天器以确保宏伟的天体、星环与微卫星视野不受遮挡
        this.vehicleGroup.visible = false;
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

    // 飞行状态变化监听：飞行结束切入 ORBIT_TARGET 时立即同步状态给 UI，飞行过程中同步实时插值进度
    const isTransitioningNow = this.cameraController.getSnapshot().isTransitioning;
    if (this.prevIsTransitioning !== isTransitioningNow) {
      this.prevIsTransitioning = isTransitioningNow;
      this.emitSnapshot();
    } else if (isTransitioningNow) {
      this.emitSnapshot();
    }

    // 6. 渲染一帧
    this.renderer.render(this.scene, this.camera);

    // 7. 计算并回调屏幕空间天体悬浮引导标识
    if (this.callbacks.onCelestialLabels) {
      const snap = this.cameraController.getSnapshot();
      const currentTargetId = snap.targetBodyId;
      const currentTargetNode = currentTargetId ? this.bodyNodes.get(currentTargetId) : undefined;
      const targetSystemPlanet = currentTargetNode?.data.type === 'moon' ? currentTargetNode.data.parentId : currentTargetId;

      const labels: CelestialLabelItem[] = [];
      const camPos = this.camera.position;
      const camDir = new THREE.Vector3();
      this.camera.getWorldDirection(camDir);

      const width = this.canvas.clientWidth || window.innerWidth;
      const height = this.canvas.clientHeight || window.innerHeight;
      const fovRad = THREE.MathUtils.degToRad(this.camera.fov);
      const tempPos = new THREE.Vector3();
      const toBody = new THREE.Vector3();

      for (const [id, node] of this.bodyNodes.entries()) {
        node.mesh.getWorldPosition(tempPos);
        toBody.subVectors(tempPos, camPos);
        const dist = toBody.length();

        // 核心视觉沉浸：当前正在观测、已选中或正在飞往的天体本尊，绝不展示浮动标签，留出 100% 纯净沉浸式天体特写
        if (id === currentTargetId || id === snap.selectedBodyId) {
          continue;
        }

        // 当近距特写观测某颗卫星时，母星本身作为壮丽背景，不展示母星的文本标签以防抢镜
        if (currentTargetNode?.data.type === 'moon' && id === targetSystemPlanet) {
          continue;
        }

        // 空间过滤：当镜头处于某一特定行星系时，仅投射太阳、母星与本系统内的卫星，杜绝数十AU外其它天体产生干扰堆叠
        if (targetSystemPlanet && targetSystemPlanet !== 'sun') {
          const isSun = node.data.type === 'star';
          const isSystemPlanet = id === targetSystemPlanet;
          const isSystemMoon = node.data.type === 'moon' && node.data.parentId === targetSystemPlanet;
          if (!isSun && !isSystemPlanet && !isSystemMoon) {
            continue;
          }
        } else {
          // 全景模式下，微卫星不单独投射，避免全景视角下数十颗小卫星重叠混乱
          if (node.data.type === 'moon') {
            continue;
          }
        }

        // 剔除相机后方的天体
        if (toBody.dot(camDir) <= 0) continue;

        const projected = tempPos.project(this.camera);
        if (projected.z < -1.0 || projected.z > 1.0) continue;
        if (projected.x < -1.05 || projected.x > 1.05 || projected.y < -1.05 || projected.y > 1.05) continue;

        // 计算屏幕空间投射半径，将标签优雅浮置于天体顶部边缘上方，绝不遮挡天体表面！
        let effectiveR = node.displayRadius;
        if (node.ringMesh && node.data.ringConfig) {
          effectiveR *= (node.data.ringConfig.outerRadiusRatio * 0.75);
        }
        const screenRadius = (effectiveR / Math.max(0.1, dist)) * (height / (2.0 * Math.tan(fovRad / 2.0)));

        const screenX = ((projected.x + 1) / 2) * width;
        const screenY = ((-projected.y + 1) / 2) * height - screenRadius - 8;

        // 视线遮挡剔除：如果卫星在母星背后，且屏幕投影落在母星盘面内部，则绝不在母星正面虚假投射
        if (node.data.type === 'moon' && targetSystemPlanet && targetSystemPlanet !== id) {
          const parentNode = this.bodyNodes.get(targetSystemPlanet);
          if (parentNode) {
            const parentWorldPos = new THREE.Vector3();
            parentNode.mesh.getWorldPosition(parentWorldPos);
            const distToParent = camPos.distanceTo(parentWorldPos);
            if (dist > distToParent) {
              const parentProjected = parentWorldPos.project(this.camera);
              const parentScreenX = ((parentProjected.x + 1) / 2) * width;
              const parentScreenY = ((-parentProjected.y + 1) / 2) * height;
              let parentEffectiveR = parentNode.displayRadius;
              if (parentNode.ringMesh && parentNode.data.ringConfig) {
                parentEffectiveR *= (parentNode.data.ringConfig.outerRadiusRatio * 0.72);
              }
              const parentScreenRadius = (parentEffectiveR / Math.max(0.1, distToParent)) * (height / (2.0 * Math.tan(fovRad / 2.0)));
              const distToParentCenterPx = Math.hypot(screenX - parentScreenX, ((-projected.y + 1) / 2) * height - parentScreenY);
              if (distToParentCenterPx < parentScreenRadius * 1.05) {
                continue; // 卫星被母星遮挡在背面，跳过标签展示
              }
            }
          }
        }

        labels.push({
          id,
          name: node.data.name,
          nameEn: node.data.nameEn,
          screenX,
          screenY,
          isVisible: true,
          type: node.data.type,
        });
      }

      this.callbacks.onCelestialLabels(labels);
    }
  };

  public dispose(): void {
    this.isRunning = false;
    cancelAnimationFrame(this.animFrameId);
    window.removeEventListener('resize', this.onResize);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('dblclick', this.onDoubleClick);
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

    if (this.saturnPlanetMaterial) {
      safeDisposeMaterial(this.saturnPlanetMaterial);
    }
    if (this.saturnRingMaterial) {
      safeDisposeMaterial(this.saturnRingMaterial);
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
