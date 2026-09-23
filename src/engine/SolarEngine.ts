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
import { normalizeWheelDelta, pinchLogDelta } from '../camera/inputKernels';
import {
  BODIES,
  getNavOrbitRadius,
  getNavDisplayRadius,
  getPlanetNavPosition,
} from '../astronomy/bodies';
import {
  BodyPoseProvider,
  PresentationPolicy,
} from '../astronomy/BodyPoseProvider';
import { AssetManager } from '../assets/AssetManager';
import {
  createEarthSurfaceMaterial,
  createEarthCloudMaterial,
  createAtmosphereHaloMaterial,
} from '../rendering/EarthMaterial';
import { SurfaceTileManager } from '../surface/SurfaceTileManager';
import { SurfaceDatasetManifest } from '../contracts/surface';
import { loadEarthTileManifest } from '../surface/manifestLoader';
import {
  createSaturnRingMaterial,
  createRingShadowPlanetMaterial,
  getUranusRingTexture,
  getNeptuneRingTexture,
} from '../rendering/RingMaterial';
import { createSunMaterial, createSunCoronaMaterial } from '../rendering/SunMaterial';
import { createJupiterMaterial } from '../rendering/JupiterMaterial';
import { createMarsMaterial } from '../rendering/MarsMaterial';
import { createVenusAtmosphereMaterial, createVenusRadarMaterial } from '../rendering/VenusMaterial';
import { createMercuryMaterial } from '../rendering/MercuryMaterial';
import { createIceGiantMaterial } from '../rendering/IceGiantMaterial';
import { createMoonMaterial } from '../rendering/MoonMaterial';
import { createAsteroidMoonMaterial } from '../rendering/AsteroidMoonMaterial';
import {
  createIoMaterial,
  createEuropaMaterial,
  createGanymedeMaterial,
  createCallistoMaterial,
} from '../rendering/GalileanMoonsMaterial';
import { buildIrregularMoonGeometry } from '../astronomy/IrregularMeshBuilder';
import type { BodyId, CelestialBodyData } from '../contracts/body';
import type { CameraCommand, CameraStateSnapshot } from '../contracts/camera';
import type { HudFrame } from '../contracts/hud';
import type { VehicleId, ViewCameraMode } from '../contracts/vehicle';
import type { BookmarkItemV2 } from '../contracts/bookmark';
import type { ObservationMode } from '../world-support/visibility';
import {
  getMoonTextureByBodyId,
  getTitanHazeTexture,
} from '../astronomy/MoonTextures';
import { soundEffects } from '../audio/SoundEffects';
import { VehicleLoader } from '../vehicles/VehicleLoader';
import { LandingController } from '../surface/LandingController';
import type { LandingTelemetry } from '../contracts/landing';
import { TerrainHeightProvider } from '../surface/TerrainHeightProvider';
import productionAssetsData from '../../sources/production-assets.json';

/**
 * 行星与卫星地质/风暴标志性景观初始观赏相位偏置表 (弧度)
 * 确保相机飞抵天体时，标志性特征（如海王星大暗斑、月球正面月海、火卫一斯蒂克尼巨坑、木卫一熔岩湖）处于向阳正面黄金视线
 */
const PLANET_SPIN_OFFSETS: Record<string, number> = {
  neptune: 2.65, // 将海王星标志性大暗斑 (Great Dark Spot) 与伴生滑行者白卷云正对向阳正面黄金视线
  uranus: 0.85,  // 优化极地烟雾帽与同心喷流带的立体晨昏侧光
  moon: 0.0,     // 确保月球正面（风暴洋、雨海、澄海与第谷辐射纹）正对进场黄金视角
  phobos: -0.46, // 确保火卫一斯蒂克尼巨型陨石坑处于向阳受光立体构图面
  deimos: -0.46, // 火卫二伏尔泰/斯威夫特撞击坑与浅色碎屑流受光面
  io: 0.65,       // 木卫一 Loki 熔岩湖与 Pele 巨型同心红环正对向阳黄金视角
  europa: -0.85,  // 木卫二 Conamara 混沌碎冰区与 Pwyll 冰裂纹放射核心受光面
  ganymede: 0.85, // 木卫三古老暗区 Galileo Regio 与年轻冰槽 Uruk Sulci 交界受光面
  callisto: 3.14, // 木卫四瓦尔哈拉 (Valhalla) 巨型同心环多重断崖盆地受光面
};

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
  onHudSnapshot?: (snapshot: HudFrame) => void;
  onSelectBody?: (bodyId: BodyId) => void;
  onCameraSnapshot?: (snapshot: CameraStateSnapshot) => void;
  onWebGLInfo?: (info: WebGLDiagnosticInfo) => void;
  onContextState?: (state: 'lost' | 'restored') => void;
  onCelestialLabels?: (labels: CelestialLabelItem[]) => void;
  onObservationModeChange?: (mode: ObservationMode) => void;
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
  poleFrame: THREE.Group;   // 固定地轴/极轴定向节点（rotation.z = axialTiltDeg）
  mesh: THREE.Mesh;         // 星球表面网格（在 poleFrame 下旋转 rotation.y）
  displayRadius: number;
  cloudMesh?: THREE.Mesh;
  haloMesh?: THREE.Mesh;
  ringMesh?: THREE.Mesh;
  orbitLine?: THREE.LineLoop;
  material?: THREE.Material;
  coronaMesh?: THREE.Mesh;
}

export class SolarEngine {
  private lastHudEmit = -Infinity;
  private hudSequence = 0;
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private cameraController: CameraController;
  private assetManager: AssetManager;
  private bodyPoseProvider = new BodyPoseProvider('NAV_SCHEMATIC');

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
  private jupiterMaterial: THREE.ShaderMaterial | null = null;
  private marsMaterial: THREE.ShaderMaterial | null = null;
  private venusAtmosphereMaterial: THREE.ShaderMaterial | null = null;
  private venusRadarMaterial: THREE.ShaderMaterial | null = null;
  private mercuryMaterial: THREE.ShaderMaterial | null = null;
  private uranusPlanetMaterial: THREE.ShaderMaterial | null = null;
  private neptunePlanetMaterial: THREE.ShaderMaterial | null = null;
  private moonMaterial: THREE.ShaderMaterial | null = null;
  private phobosMaterial: THREE.ShaderMaterial | null = null;
  private deimosMaterial: THREE.ShaderMaterial | null = null;
  private ioMaterial: THREE.ShaderMaterial | null = null;
  private europaMaterial: THREE.ShaderMaterial | null = null;
  private ganymedeMaterial: THREE.ShaderMaterial | null = null;
  private callistoMaterial: THREE.ShaderMaterial | null = null;
  private tempQuat: THREE.Quaternion = new THREE.Quaternion();
  private earthTileManager: SurfaceTileManager | null = null;
  private earthNightTexture: THREE.Texture | null = null;
  private observationMode: ObservationMode = 'physical';

  // 航天器伴飞系统
  private currentVehicleId: VehicleId | null = null;
  private vehicleGroup: THREE.Group = new THREE.Group();
  private currentVehicleMesh: THREE.Group | null = null;
  private vehicleLoadGeneration: number = 0;
  private viewCameraMode: ViewCameraMode = 'PLANET_OBSERVE';
  private prevIsTransitioning: boolean = false;

  // 批次 R5：着陆控制器与月表 3D 浮雕网格
  private landingController: LandingController = new LandingController('taurus-littrow');
  private lunarValleyMesh?: THREE.Mesh;
  private moonMesh?: THREE.Mesh;

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
    this.updateOrbitsVisibility('earth');

    // 7. 绑定输入事件
    this.bindEvents();

    // 8. 启动异步贴图预取与加载管线
    this.loadInitialTextures();

    // 9. 启动单一渲染循环
    this.lastTime = performance.now();
    this.animate();

    if (typeof window !== 'undefined') {
      (window as any).__SOLAR_ENGINE__ = this;
      (window as any).THREE = THREE;
    }
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
    const sunPoleFrame = new THREE.Group();
    sunPoleFrame.rotation.z = THREE.MathUtils.degToRad(sunData.axialTiltDeg || 0);
    sunGroup.add(sunPoleFrame);

    const sunRadius = getNavDisplayRadius(sunData.radiusKm, sunData.type);
    const sunGeo = new THREE.SphereGeometry(sunRadius, 48, 48);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffaa22 });
    const sunMesh = new THREE.Mesh(sunGeo, sunMat);
    sunMesh.userData = { bodyId: 'sun' };
    sunPoleFrame.add(sunMesh);
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
      poleFrame: sunPoleFrame,
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

      // 2. 地轴/极轴定向节点（纯倾角，固定地轴方向，不随自转绕世界Y进动）
      const poleFrame = new THREE.Group();
      poleFrame.rotation.z = THREE.MathUtils.degToRad(data.axialTiltDeg || 0);
      systemGroup.add(poleFrame);

      // 3. 行星表面网格（挂在 poleFrame 下，绕本地 Y 轴自转）
      const displayRadius = getNavDisplayRadius(data.radiusKm, data.type);
      const sphereGeo = new THREE.SphereGeometry(displayRadius, 48, 36);
      const defaultMat = new THREE.MeshStandardMaterial({
        color: data.colorHex ?? 0x888888,
        roughness: 0.85,
        metalness: 0.05,
      });
      const mesh = new THREE.Mesh(sphereGeo, defaultMat);
      mesh.userData = { bodyId: id };
      mesh.rotation.y = PLANET_SPIN_OFFSETS[id] || 0;
      poleFrame.add(mesh);
      this.pickableMeshes.push(mesh);

      const node: BodyRenderNode = {
        data,
        systemGroup,
        poleFrame,
        mesh,
        displayRadius,
        material: defaultMat,
      };

      // 4. 行星公转轨道线（优雅半透明椭圆）
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

      // 5. 地球专属多层：独立自旋云层、大气光晕与高精多分辨率地理瓦片金字塔 (挂载在 poleFrame)
      if (id === 'earth') {
        const cloudGeo = new THREE.SphereGeometry(displayRadius * 1.012, 48, 36);
        const defaultCloudMat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.4,
          wireframe: false,
        });
        const cloudMesh = new THREE.Mesh(cloudGeo, defaultCloudMat);
        poleFrame.add(cloudMesh);
        node.cloudMesh = cloudMesh;

        const haloGeo = new THREE.SphereGeometry(displayRadius * 1.025, 48, 36);
        this.earthHaloMaterial = createAtmosphereHaloMaterial(0x38bdf8, 2.8, 0.75);
        const haloMesh = new THREE.Mesh(haloGeo, this.earthHaloMaterial);
        poleFrame.add(haloMesh);
        node.haloMesh = haloMesh;

        // 批次 R2：初始化高精度地球多级地理经纬度双根四叉树瓦片管理器
        const earthTileManifest: SurfaceDatasetManifest = {
          bodyId: 'earth',
          datasetId: 'nasa-blue-marble-200409-tiles',
          version: '2.0.0',
          source: 'NASA Earth Observatory / Blue Marble Next Generation',
          sourceDate: '2004-09',
          projection: 'equirectangular-dual-root',
          referenceRadiusKm: data.radiusKm,
          maxLevel: 9,
          tileSizePixels: 512,
          colorSpace: 'sRGB',
          tileRootPath: '/assets/tiles/earth',
        };
        this.earthTileManager = new SurfaceTileManager({
          manifest: earthTileManifest,
          radius: displayRadius, // 瓦片地表全权作为物理地表
          maxMemoryTiles: 256,
          sseThreshold: 2.0,
        });
        this.earthTileManager.setObservationMode(this.observationMode);
        if (this.earthNightTexture) {
          this.earthTileManager.setNightTexture(this.earthNightTexture);
        }
        poleFrame.add(this.earthTileManager.group);
        node.mesh.visible = false; // 由 EarthTileManager 独占接管地表渲染，彻底消除双球穿插与 Z-fighting

        // 异步载入真实离线构建生成的 manifest.json (R2: 只读构建输出 manifest，不手写分离)
        loadEarthTileManifest().then((realManifest) => {
          if (this.earthTileManager) {
            this.earthTileManager.updateManifest(realManifest);
          }
        });
      }

      // 6. 金星专属：浓厚硫酸大气层外壳与金黄色散射高层大气晕（挂载在 poleFrame）
      if (id === 'venus') {
        const atmGeo = new THREE.SphereGeometry(displayRadius * 1.015, 48, 36);
        const atmMat = new THREE.MeshStandardMaterial({
          color: 0xf5d08a,
          roughness: 0.9,
          metalness: 0.0,
          transparent: false,
        });
        const atmMesh = new THREE.Mesh(atmGeo, atmMat);
        atmMesh.userData = { bodyId: 'venus' };
        poleFrame.add(atmMesh);
        node.cloudMesh = atmMesh;

        const haloGeo = new THREE.SphereGeometry(displayRadius * 1.028, 48, 36);
        const haloMesh = new THREE.Mesh(haloGeo, createAtmosphereHaloMaterial(0xfde047, 2.6, 0.65));
        poleFrame.add(haloMesh);
        node.haloMesh = haloMesh;
      }

      // 火星：火星微细红尘与稀薄二氧化碳高层大气光晕（挂载在 poleFrame）
      if (id === 'mars') {
        const haloGeo = new THREE.SphereGeometry(displayRadius * 1.015, 48, 36);
        const haloMesh = new THREE.Mesh(haloGeo, createAtmosphereHaloMaterial(0xfca5a5, 3.8, 0.28));
        poleFrame.add(haloMesh);
        node.haloMesh = haloMesh;
      }

      // 木星：巨行星微弱暖白/琥珀散射高层大气辉光（挂载在 poleFrame）
      if (id === 'jupiter') {
        const haloGeo = new THREE.SphereGeometry(displayRadius * 1.018, 48, 36);
        const haloMesh = new THREE.Mesh(haloGeo, createAtmosphereHaloMaterial(0xf5dca8, 2.8, 0.38));
        poleFrame.add(haloMesh);
        node.haloMesh = haloMesh;
      }

      // 7. 土星专属：土星光环几何体与金色晕（光环挂载在 poleFrame 赤道面，不随表面自转）
      if (id === 'saturn' && data.ringConfig) {
        const innerR = displayRadius * data.ringConfig.innerRadiusRatio;
        const outerR = displayRadius * data.ringConfig.outerRadiusRatio;
        const ringGeo = new THREE.RingGeometry(innerR, outerR, 96);
        // 使环几何体位于 X-Z 平面（法线对准地轴极轴 Y 轴）
        ringGeo.rotateX(Math.PI / 2);

        const defaultRingMat = new THREE.MeshBasicMaterial({
          color: 0xd0b885,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.75,
        });
        const ringMesh = new THREE.Mesh(ringGeo, defaultRingMat);
        poleFrame.add(ringMesh);
        node.ringMesh = ringMesh;

        const haloGeo = new THREE.SphereGeometry(displayRadius * 1.018, 48, 36);
        const haloMesh = new THREE.Mesh(haloGeo, createAtmosphereHaloMaterial(0xfef08a, 2.5, 0.45));
        poleFrame.add(haloMesh);
        node.haloMesh = haloMesh;
      }

      // 天王星与海王星：甲烷散射天青与深蓝光晕及光环（挂载在 poleFrame）
      if (id === 'uranus') {
        const haloGeo = new THREE.SphereGeometry(displayRadius * 1.022, 48, 36);
        const haloMesh = new THREE.Mesh(haloGeo, createAtmosphereHaloMaterial(0x38bdf8, 2.6, 0.55));
        poleFrame.add(haloMesh);
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
          poleFrame.add(ringMesh);
          node.ringMesh = ringMesh;
        }
      }

      if (id === 'neptune') {
        const haloGeo = new THREE.SphereGeometry(displayRadius * 1.022, 48, 36);
        const haloMesh = new THREE.Mesh(haloGeo, createAtmosphereHaloMaterial(0x2563eb, 2.6, 0.65));
        poleFrame.add(haloMesh);
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
          poleFrame.add(ringMesh);
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

      // 卫星地轴/极轴定向节点（固定地轴自转轴倾角，杜绝进动漂移）
      const satPoleFrame = new THREE.Group();
      satPoleFrame.rotation.z = THREE.MathUtils.degToRad(satData.axialTiltDeg || 0);
      satGroup.add(satPoleFrame);

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
      satMesh.rotation.y = PLANET_SPIN_OFFSETS[satId] || 0;
      satPoleFrame.add(satMesh);
      this.pickableMeshes.push(satMesh);

      if (satId === 'moon') {
        this.moonMesh = satMesh;
        // 异步载入真实 NASA LROC 月球正射反照率贴图
        new THREE.TextureLoader().load('/assets/textures/moon/lroc_color_2k.jpg', (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          satMat.map = tex;
          satMat.needsUpdate = true;
        });

        // 挂载 Taurus–Littrow 高精 3D 浮雕地形网格 (Apollo 17 区域)
        const heightProvider = TerrainHeightProvider.getInstance();
        const valleyGeo = heightProvider.buildTaurusLittrowGeometry(satRadius);
        const valleyMat = new THREE.MeshStandardMaterial({
          color: 0x94a3b8,
          roughness: 0.95,
          metalness: 0.05,
          side: THREE.DoubleSide,
        });
        const valleyMesh = new THREE.Mesh(valleyGeo, valleyMat);
        valleyMesh.name = 'taurus-littrow-terrain';
        valleyMesh.receiveShadow = true;
        valleyMesh.castShadow = true;
        satMesh.add(valleyMesh);
        this.lunarValleyMesh = valleyMesh;
      }

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
        satPoleFrame.add(satCloudMesh);

        const haloGeo = new THREE.SphereGeometry(satRadius * 1.035, 32, 24);
        satHalo = new THREE.Mesh(haloGeo, createAtmosphereHaloMaterial(0xf97316, 2.0, 0.88));
        satPoleFrame.add(satHalo);
      }

      this.bodyNodes.set(satId, {
        data: satData,
        systemGroup: satGroup,
        poleFrame: satPoleFrame,
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
      if (nightTex) {
        this.earthNightTexture = nightTex;
        if (this.earthTileManager) {
          this.earthTileManager.setNightTexture(nightTex);
        }
      }
      if (earthNode && earthNode.cloudMesh && cloudsTex) {
        this.earthCloudMaterial = createEarthCloudMaterial(cloudsTex);
        const sunDir = earthNode.systemGroup.position.clone().negate().normalize();
        this.earthCloudMaterial.uniforms.sunDirection.value.copy(sunDir);
        safeDisposeMaterial(earthNode.cloudMesh.material);
        earthNode.cloudMesh.material = this.earthCloudMaterial;
        earthNode.cloudMesh.visible = this.observationMode === 'physical';
      }
    }).catch((e) => console.error('[Texture] Earth load failed:', e));

    // 4. 月球专属：NASA LROC 多光谱正射拼图、Lommel-Seeliger 多孔玄武岩表土与满月冲日激增材质
    this.assetManager.loadTexture('moon-svs-2025-2k', token, () => true).then((moonTex) => {
      if (!moonTex) return;
      const moonNode = this.bodyNodes.get('moon');
      if (moonNode) {
        this.moonMaterial = createMoonMaterial(moonTex);
        this.moonMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
        safeDisposeMaterial(moonNode.mesh.material);
        moonNode.mesh.material = this.moonMaterial;
      }
    }).catch((e) => console.error('[Texture] Moon load failed:', e));

    // 4.1 挂载全 23 颗天然卫星高拟真科学地貌纹理与专属材质
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
      if (!tex) continue;

      if (satId === 'phobos') {
        this.phobosMaterial = createAsteroidMoonMaterial(tex, 'phobos');
        this.phobosMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
        safeDisposeMaterial(satNode.mesh.material);
        satNode.mesh.material = this.phobosMaterial;
      } else if (satId === 'deimos') {
        this.deimosMaterial = createAsteroidMoonMaterial(tex, 'deimos');
        this.deimosMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
        safeDisposeMaterial(satNode.mesh.material);
        satNode.mesh.material = this.deimosMaterial;
      } else if (satId === 'io') {
        this.ioMaterial = createIoMaterial(tex);
        this.ioMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
        safeDisposeMaterial(satNode.mesh.material);
        satNode.mesh.material = this.ioMaterial;
      } else if (satId === 'europa') {
        this.europaMaterial = createEuropaMaterial(tex);
        this.europaMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
        safeDisposeMaterial(satNode.mesh.material);
        satNode.mesh.material = this.europaMaterial;
      } else if (satId === 'ganymede') {
        this.ganymedeMaterial = createGanymedeMaterial(tex);
        this.ganymedeMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
        safeDisposeMaterial(satNode.mesh.material);
        satNode.mesh.material = this.ganymedeMaterial;
      } else if (satId === 'callisto') {
        this.callistoMaterial = createCallistoMaterial(tex);
        this.callistoMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
        safeDisposeMaterial(satNode.mesh.material);
        satNode.mesh.material = this.callistoMaterial;
      } else {
        const mat = satNode.mesh.material as THREE.MeshStandardMaterial;
        mat.color.set(0xffffff);
        mat.map = tex;
        mat.roughness = satId === 'enceladus' ? 0.35 : 0.88;
        mat.metalness = 0.02;
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

    // 5. 金星（浓厚硫酸大气多重散射与麦哲伦雷达穿透专属材质）
    Promise.all([
      this.assetManager.loadTexture('venus-atmosphere-sss-2k', token, () => true),
      this.assetManager.loadTexture('venus-surface-sss-2k', token, () => true),
    ]).then(([atmTex, surfTex]) => {
      const venusNode = this.bodyNodes.get('venus');
      if (venusNode) {
        if (surfTex) {
          this.venusRadarMaterial = createVenusRadarMaterial(surfTex);
          this.venusRadarMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
          safeDisposeMaterial(venusNode.mesh.material);
          venusNode.mesh.material = this.venusRadarMaterial;
        }
        if (venusNode.cloudMesh && atmTex) {
          this.venusAtmosphereMaterial = createVenusAtmosphereMaterial(atmTex);
          this.venusAtmosphereMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
          safeDisposeMaterial(venusNode.cloudMesh.material);
          venusNode.cloudMesh.material = this.venusAtmosphereMaterial;
        }
      }
    }).catch((e) => console.error('[Texture] Venus load failed:', e));

    // 6. 水星专属：Lommel-Seeliger 多孔风化表土散射与真空剃刀晨昏线材质
    this.assetManager.loadTexture('mercury-sss-2k', token, () => true).then((mercuryTex) => {
      const node = this.bodyNodes.get('mercury');
      if (mercuryTex && node) {
        this.mercuryMaterial = createMercuryMaterial(mercuryTex);
        this.mercuryMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
        safeDisposeMaterial(node.mesh.material);
        node.mesh.material = this.mercuryMaterial;
      }
    }).catch((e) => console.error('[Texture] Mercury load failed:', e));

    // 6. 火星专属：粗糙岩石矿物散射、极地冰盖与晨昏蓝光着色器材质
    this.assetManager.loadTexture('mars-sss-2k', token, () => true).then((marsTex) => {
      const node = this.bodyNodes.get('mars');
      if (marsTex && node) {
        this.marsMaterial = createMarsMaterial(marsTex);
        this.marsMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
        safeDisposeMaterial(node.mesh.material);
        node.mesh.material = this.marsMaterial;
      }
    }).catch((e) => console.error('[Texture] Mars load failed:', e));

    // 7. 木星专属：气态巨行星 Minnaert 边缘变暗着色器材质
    this.assetManager.loadTexture('jupiter-sss-2k', token, () => true).then((jupiterTex) => {
      const node = this.bodyNodes.get('jupiter');
      if (jupiterTex && node) {
        this.jupiterMaterial = createJupiterMaterial(jupiterTex);
        this.jupiterMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
        safeDisposeMaterial(node.mesh.material);
        node.mesh.material = this.jupiterMaterial;
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

    // 9. 天王星与海王星专属：冰巨星甲烷选择性吸收与深邃散射材质
    this.assetManager.loadTexture('uranus-sss-2k', token, () => true).then((uranusTex) => {
      const node = this.bodyNodes.get('uranus');
      if (uranusTex && node) {
        this.uranusPlanetMaterial = createIceGiantMaterial(uranusTex, 'uranus');
        this.uranusPlanetMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
        safeDisposeMaterial(node.mesh.material);
        node.mesh.material = this.uranusPlanetMaterial;
      }
    }).catch((e) => console.error('[Texture] Uranus load failed:', e));

    this.assetManager.loadTexture('neptune-sss-2k', token, () => true).then((neptuneTex) => {
      const node = this.bodyNodes.get('neptune');
      if (neptuneTex && node) {
        this.neptunePlanetMaterial = createIceGiantMaterial(neptuneTex, 'neptune');
        this.neptunePlanetMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
        safeDisposeMaterial(node.mesh.material);
        node.mesh.material = this.neptunePlanetMaterial;
      }
    }).catch((e) => console.error('[Texture] Neptune load failed:', e));
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.onResize);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('lostpointercapture', this.onPointerUp);
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
    const width = this.canvas.parentElement?.clientWidth || window.innerWidth;
    const height = this.canvas.parentElement?.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private onPointerDown = (e: PointerEvent): void => {
    // 忽略鼠标非左键点击，且不记入 activePointers
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

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

    // 双指触控捏合缩放（连续无量纲对数比值）
    if (this.activePointers.size === 2) {
      const pts = Array.from(this.activePointers.values());
      const currentDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (this.lastPinchDistance > 0 && currentDist > 0) {
        const logDelta = pinchLogDelta(this.lastPinchDistance, currentDist);
        this.cameraController.executeCommand({ type: 'zoomInput', logDelta });
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
      // 批次 R5 铁律：下降过程中用户拖拽立即打断进入 HOLD 状态，相机停驻并保留控制
      if (this.landingController.getState() === 'DESCENDING') {
        this.landingController.holdDescent();
      }

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

    if (this.activePointers.size === 1) {
      // 关键修复：从双指退回单指时重置单指基准点，防镜头跳跃
      const remaining = Array.from(this.activePointers.values())[0];
      this.lastPointerX = remaining.x;
      this.lastPointerY = remaining.y;
      this.pointerStartX = remaining.x;
      this.pointerStartY = remaining.y;
      this.lastPinchDistance = 0;
    } else if (this.activePointers.size === 0) {
      this.lastPinchDistance = 0;
      if (this.isPointerDown) {
        this.isPointerDown = false;
        // 若未发生拖拽位移，视为一次精准点击拾取
        if (!this.hasDragged) {
          this.handlePick(e.clientX, e.clientY);
        }
      }
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const viewportHeight = Math.max(100, rect.height || window.innerHeight);
    const normalizedPx = normalizeWheelDelta(e.deltaY, e.deltaMode, viewportHeight, 16);
    // 连续对数缩放增益：每次 100px 滚轮刻度约改变目标间距 14%
    const logDelta = normalizedPx * 0.0014;
    if (this.landingController.getState() === 'DESCENDING') {
      this.landingController.holdDescent();
    }
    this.cameraController.executeCommand({ type: 'zoomInput', logDelta });
    this.emitSnapshot();
  };

  private handlePick(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const pickables: THREE.Object3D[] = [...this.pickableMeshes];
    if (this.earthTileManager) {
      pickables.push(this.earthTileManager.group);
    }
    const intersects = this.raycaster.intersectObjects(pickables, true);

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

  public getCameraSnapshot(): CameraStateSnapshot {
    return this.cameraController.getSnapshot();
  }

  public executeCameraCommand(cmd: CameraCommand): void {
    if (cmd.type === 'flyTo' && !cmd.targetPos) {
      const node = this.bodyNodes.get(cmd.bodyId);
      if (node) {
        const wp = new THREE.Vector3();
        if (node.data.parentId) {
          const parentNode = this.bodyNodes.get(node.data.parentId);
          if (parentNode) {
            wp.copy(parentNode.systemGroup.position).add(node.systemGroup.position);
          }
        }
        if (wp.lengthSq() < 0.001) {
          node.mesh.updateWorldMatrix(true, false);
          node.mesh.getWorldPosition(wp);
        }
        cmd = { ...cmd, targetPos: [wp.x, wp.y, wp.z] };
      }
    }
    if (cmd.type === 'flyTo' || cmd.type === 'overview' || cmd.type === 'restoreBookmark') {
      soundEffects.playWarp();
      if (cmd.type === 'flyTo') {
        this.updateOrbitsVisibility(cmd.bodyId);
      } else if (cmd.type === 'overview') {
        this.updateOrbitsVisibility('sun');
      } else if (cmd.type === 'restoreBookmark') {
        this.updateOrbitsVisibility(cmd.targetBodyId);
      }
    } else if (cmd.type === 'select') {
      soundEffects.playClick();
      this.updateOrbitsVisibility(cmd.bodyId);
      if (this.callbacks.onSelectBody) {
        this.callbacks.onSelectBody(cmd.bodyId);
      }
    }
    this.cameraController.executeCommand(cmd);
    this.emitSnapshot();
  }

  public setPlanetSpinOffset(bodyId: string, offset: number): void {
    PLANET_SPIN_OFFSETS[bodyId] = offset;
  }

  public setPaused(paused: boolean): void {
    this.isPaused = paused;
  }

  public setTimeScale(scale: number): void {
    this.timeScale = scale;
  }

  public getTimeScale(): number {
    return this.timeScale;
  }

  /**
   * 启动月球 Taurus–Littrow 陶拉斯—利特罗山谷真实降落序列 (批次 R5)
   */
  public startLunarLanding(): void {
    // 1. 确保聚焦月球并切入物理比例模式
    this.cameraController.executeCommand({ type: 'select', bodyId: 'moon' });
    if (this.callbacks.onSelectBody) {
      this.callbacks.onSelectBody('moon');
    }
    this.setPresentationPolicy('PHYSICAL_OBSERVATION');
    soundEffects.playWarp();

    // 2. 启动降落状态机
    this.landingController.startDescent(
      () => this.timeScale,
      (scale) => this.setTimeScale(scale)
    );
  }

  public pauseLanding(): void {
    this.landingController.holdDescent();
  }

  public resumeLanding(): void {
    this.landingController.resumeDescent();
  }

  public returnToLunarOrbit(): void {
    this.landingController.returnToOrbit();
  }

  public lookAtEarthFromMoon(): void {
    this.cameraController.executeCommand({
      type: 'lookAtSkyTarget',
      targetBodyId: 'earth',
    });
  }

  public resetMoonSurfaceLook(): void {
    this.cameraController.executeCommand({
      type: 'setSurfaceLook',
      yawDeg: 225.0,
      pitchDeg: 12.0,
    });
  }

  public getLandingController(): LandingController {
    return this.landingController;
  }

  public getLandingTelemetry(): LandingTelemetry {
    return this.landingController.getTelemetry();
  }

  public getMoonMesh(): THREE.Mesh | undefined {
    return this.moonMesh;
  }

  public getLunarValleyMesh(): THREE.Mesh | undefined {
    return this.lunarValleyMesh;
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
    if (this.jupiterMaterial) {
      this.jupiterMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
    }
    if (this.marsMaterial) {
      this.marsMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
    }
    if (this.venusAtmosphereMaterial) {
      this.venusAtmosphereMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
    }
    if (this.venusRadarMaterial) {
      this.venusRadarMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
    }
    if (this.mercuryMaterial) {
      this.mercuryMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
    }
    if (this.uranusPlanetMaterial) {
      this.uranusPlanetMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
    }
    if (this.neptunePlanetMaterial) {
      this.neptunePlanetMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
    }
    if (this.moonMaterial) {
      this.moonMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
    }
    if (this.phobosMaterial) {
      this.phobosMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
    }
    if (this.deimosMaterial) {
      this.deimosMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
    }
    if (this.ioMaterial) {
      this.ioMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
    }
    if (this.europaMaterial) {
      this.europaMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
    }
    if (this.ganymedeMaterial) {
      this.ganymedeMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
    }
    if (this.callistoMaterial) {
      this.callistoMaterial.uniforms.teachingLight.value = this.teachingLight ? 1.0 : 0.0;
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

  /**
   * 空间自适应轨道线显示：
   * 1. 当处于局部系统特写（如地月系、土星系）时，默认仅显示本系统内卫星同心轨道，隐藏穿插切割主体的全局日心轨道线；
   * 2. 当处于太阳系全景时，显示八大行星绕日轨道；
   * 3. 用户手动关闭轨道线时完全隐藏。
   */
  private updateOrbitsVisibility(targetId?: BodyId): void {
    if (!this.showOrbits) {
      this.orbitLinesGroup.visible = false;
      for (const node of this.bodyNodes.values()) {
        if (node.orbitLine) node.orbitLine.visible = false;
      }
      return;
    }

    const currentId = targetId || this.cameraController.getSnapshot().targetBodyId || 'earth';
    const currentBody = BODIES[currentId];
    const systemPlanet = currentBody?.type === 'moon' ? currentBody.parentId : currentId;

    if (systemPlanet === 'sun') {
      this.orbitLinesGroup.visible = true;
      for (const node of this.bodyNodes.values()) {
        if (node.orbitLine) {
          node.orbitLine.visible = node.data.type === 'planet';
        }
      }
    } else {
      this.orbitLinesGroup.visible = false;
      for (const node of this.bodyNodes.values()) {
        if (node.orbitLine) {
          node.orbitLine.visible = node.data.type === 'moon' && node.data.parentId === systemPlanet;
        }
      }
    }
  }

  public setShowOrbits(show: boolean): void {
    this.showOrbits = show;
    this.updateOrbitsVisibility();
  }

  public setShowVenusSurface(radar: boolean): void {
    this.venusRadarMode = radar;
    soundEffects.playRadarPing();
    const venusNode = this.bodyNodes.get('venus');
    if (venusNode) {
      if (venusNode.cloudMesh) {
        // 雷达模式下隐藏浓厚大气，展现熔岩表面
        venusNode.cloudMesh.visible = !radar;
      }
      if (venusNode.haloMesh) {
        venusNode.haloMesh.visible = !radar && this.showAtmosphere;
      }
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

  public setPresentationPolicy(policy: PresentationPolicy, durationSec = 1.2): void {
    this.bodyPoseProvider.setPresentationPolicy(policy, durationSec);
  }

  public getPresentationPolicy(): PresentationPolicy {
    return this.bodyPoseProvider.getPresentationPolicy();
  }

  public getBodyPoseProvider(): BodyPoseProvider {
    return this.bodyPoseProvider;
  }

  public setVehicle(id: VehicleId | null): void {
    const gen = ++this.vehicleLoadGeneration;

    if (this.currentVehicleMesh) {
      this.vehicleGroup.remove(this.currentVehicleMesh);
      VehicleLoader.disposeVehicleObject(this.currentVehicleMesh);
      this.currentVehicleMesh = null;
    }

    this.currentVehicleId = id;
    if (!id) return;

    VehicleLoader.loadVehicle(id, gen).then((group) => {
      if (gen !== this.vehicleLoadGeneration || this.currentVehicleId !== id) {
        if (group) {
          VehicleLoader.disposeVehicleObject(group);
        }
        return;
      }
      if (!group) return;

      this.currentVehicleMesh = group;
      this.vehicleGroup.add(group);
    });
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
    this.emitHudFrame(performance.now(), true);
  }

  /** Sample actual scene transforms; keep simulation and presentation clocks separate. */
  private emitHudFrame(now: number, force = false): void {
    if (!this.callbacks.onHudSnapshot || (!force && now - this.lastHudEmit < 100)) return;
    this.lastHudEmit = now;
    const position = new THREE.Vector3();
    const bodies: HudFrame['bodies'][number][] = [];
    for (const [id, node] of this.bodyNodes) {
      node.mesh.getWorldPosition(position);
      bodies.push({ id, position: [position.x, position.y, position.z] });
    }
    this.callbacks.onHudSnapshot({
      sequence: ++this.hudSequence,
      simTimeHours: this.simTimeHours,
      isPaused: this.isPaused,
      timeScale: this.timeScale,
      camera: this.cameraController.getSnapshot(),
      observerPosition: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      bodies,
    });
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

    // 0. 更新展示策略平滑过渡（物理局部空间 vs 导航示意模式）
    this.bodyPoseProvider.updateTransition(deltaSec);

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
    this.updateEphemerisPoses(deltaSec);

    // 3. 更新载具空间位置与伴飞/随船/绕飞姿态
    if (this.currentVehicleMesh && this.currentVehicleId) {
      const origDim = (this.currentVehicleMesh.userData.maxDim as number) || (this.currentVehicleMesh.userData.originalMaxDim as number) || 5.0;

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

    // 批次 R5：着陆控制器生命周期驱动 (50km 轨道 -> 1.7m 月表人眼视高)
    const landingState = this.landingController.getState();
    if (landingState === 'DESCENDING' || landingState === 'ASCENDING') {
      this.landingController.update(deltaSec, (s) => this.setTimeScale(s));
      const traj = this.landingController.evaluateTrajectory();
      this.cameraController.executeCommand({
        type: 'enterSurfaceLook',
        bodyId: 'moon',
        lat: traj.lat,
        lon: traj.lon,
        eyeHeightM: traj.altitudeAGLM,
        initialYawDeg: traj.cameraYawDeg,
        initialPitchDeg: traj.cameraPitchDeg,
      });
    } else if (landingState === 'ORBIT' && this.cameraController.getSnapshot().mode === 'SURFACE_LOOK') {
      this.cameraController.executeCommand({
        type: 'flyTo',
        bodyId: 'moon',
        durationSec: 1.5,
      });
    }

    // 5. 更新单一相机控制器
    this.cameraController.update(deltaSec, (id: BodyId) => this.getBodyWorldPose(id));

    // 飞行状态变化监听：飞行结束切入 ORBIT_TARGET 时立即同步状态给 UI，飞行过程中同步实时插值进度
    const isTransitioningNow = this.cameraController.getSnapshot().isTransitioning;
    if (this.prevIsTransitioning !== isTransitioningNow) {
      this.prevIsTransitioning = isTransitioningNow;
      this.emitSnapshot();
    }

    // 6. 渲染一帧
    this.renderer.render(this.scene, this.camera);

    this.emitHudFrame(now);

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

  public getEarthTileManager(): SurfaceTileManager | null {
    return this.earthTileManager;
  }

  /**
   * 切换观测模式 (物理观测 vs 地貌观察)
   * physical: 真实时间/昼夜/云层，保持物理天体真实感
   * terrain-study: 隐藏云层，提供全向参考照明，模拟时间保持不变
   */
  public setObservationMode(mode: ObservationMode): void {
    this.observationMode = mode;
    if (this.earthTileManager) {
      this.earthTileManager.setObservationMode(mode);
    }
    const earthNode = this.bodyNodes.get('earth');
    if (earthNode && earthNode.cloudMesh) {
      earthNode.cloudMesh.visible = mode === 'physical';
    }
    if (this.callbacks.onObservationModeChange) {
      this.callbacks.onObservationModeChange(mode);
    }
  }

  public getObservationMode(): ObservationMode {
    return this.observationMode;
  }

  /**
   * 飞向地球特定地表区域 (focusEarthRegion)
   * 严格遵循 R2 规范：由唯一 CameraController 统一执行地理命令
   */
  public focusEarthRegion(regionKey: 'pearl-river-delta' | string): void {
    if (regionKey === 'pearl-river-delta') {
      // 核心修复：执行地理对焦前立即刷新天体瞬时姿态与相机控制器世界位置，杜绝时钟修改后的姿态延迟
      this.updateEphemerisPoses(0);
      this.cameraController.update(0, (id: BodyId) => this.getBodyWorldPose(id));

      // 珠江口大湾区核心伶仃洋与香港/澳门/深圳/珠海 (经度 113.8°E, 纬度 22.3°N)
      // 近地观察净高度 0.05 场景单位 (对应地表近地高精观察，真实细节展开)
      this.cameraController.executeCommand({
        type: 'focusRegion',
        bodyId: 'earth',
        lat: 22.3,
        lon: 113.8,
        altitude: 0.05,
        durationSec: 2.2,
      });
    }
  }

  public getCameraController(): CameraController {
    return this.cameraController;
  }

  public getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  public getBodyNode(id: BodyId): BodyRenderNode | undefined {
    return this.bodyNodes.get(id);
  }

  /**
   * 获取指定天体在当前世界空间中的绝对坐标与四元数姿态（解耦 Three.js 异步矩阵更新）
   */
  public getBodyWorldPose(id: BodyId) {
    const node = this.bodyNodes.get(id);
    if (!node) {
      return {
        pos: new THREE.Vector3(0, 0, 0),
        radius: 5.0,
        surfaceRadius: 5.0,
        framingRadius: 5.0,
        quaternion: new THREE.Quaternion(),
      };
    }

    const worldPos = new THREE.Vector3();
    if (node.data.parentId) {
      const parentNode = this.bodyNodes.get(node.data.parentId);
      if (parentNode) {
        worldPos.copy(parentNode.systemGroup.position).add(node.systemGroup.position);
      }
    } else {
      worldPos.copy(node.systemGroup.position);
    }
    if (worldPos.lengthSq() < 0.001) {
      node.mesh.updateWorldMatrix(true, false);
      node.mesh.getWorldPosition(worldPos);
    }
    node.mesh.updateWorldMatrix(true, false);
    const quat = new THREE.Quaternion();
    node.mesh.getWorldQuaternion(quat);

    const pose = this.bodyPoseProvider.getBodyPose(id, this.simTimeHours);
    return {
      pos: worldPos,
      radius: pose.renderFramingRadius,
      surfaceRadius: pose.renderSurfaceRadius,
      framingRadius: pose.renderFramingRadius,
      quaternion: quat,
    };
  }

  /**
   * 刷新所有天体的开普勒公转位置、自转四元数、光照向量与高精瓦片状态
   */
  public updateEphemerisPoses(deltaSec: number = 0): void {
    const isPhysicalObservation = this.bodyPoseProvider.getPolicy() === 'PHYSICAL_OBSERVATION';
    const sunNode = this.bodyNodes.get('sun');
    if (sunNode) {
      sunNode.systemGroup.visible = !isPhysicalObservation;
    }

    for (const [id, node] of this.bodyNodes.entries()) {
      if (node.data.type === 'star') {
        // 太阳位于原点，缓慢自转
        const sunRotRad = ((2.0 * Math.PI) / node.data.rotationPeriodHours) * this.simTimeHours;
        node.mesh.rotation.y = sunRotRad;
        continue;
      }

      if (node.data.type === 'planet') {
        if (isPhysicalObservation && id !== 'earth') {
          node.systemGroup.visible = false;
          continue;
        } else {
          node.systemGroup.visible = true;
        }

        // 计算行星在太阳系全景中的开普勒公转坐标
        const [px, py, pz] = getPlanetNavPosition(id, this.simTimeHours);
        node.systemGroup.position.set(px, py, pz);

        // 计算行星自身自转（融合标志性特征观赏初相位偏置）
        const spinOffset = PLANET_SPIN_OFFSETS[id] || 0;
        const rotRad = ((2.0 * Math.PI) / node.data.rotationPeriodHours) * this.simTimeHours + spinOffset;
        node.mesh.rotation.y = rotRad;

        // 地球专属：更新光照向量、自旋云层流动与高精地理瓦片金字塔
        if (id === 'earth') {
          const sunDir = this.bodyPoseProvider.getPhysicalSunDirection('earth', this.simTimeHours);
          if (this.earthMaterial) {
            this.earthMaterial.uniforms.sunDirection.value.copy(sunDir);
          }
          if (this.earthCloudMaterial && node.cloudMesh) {
            this.earthCloudMaterial.uniforms.sunDirection.value.copy(sunDir);
            node.cloudMesh.rotation.y = rotRad * 1.04 + (this.simTimeHours * 0.01);
          }
          if (this.earthTileManager) {
            this.earthTileManager.group.rotation.y = rotRad;
            this.earthTileManager.update(
              this.camera,
              sunDir,
              this.teachingLight ? 1.0 : 0.0,
              deltaSec
            );
          }
        }

        // 金星专属：高层大气 4 天超自转与实时同步太阳向量
        if (id === 'venus') {
          const sunDir = this.bodyPoseProvider.getPhysicalSunDirection('venus', this.simTimeHours);
          if (this.venusAtmosphereMaterial) {
            this.venusAtmosphereMaterial.uniforms.sunDirection.value.copy(sunDir);
          }
          if (this.venusRadarMaterial) {
            this.venusRadarMaterial.uniforms.sunDirection.value.copy(sunDir);
          }
          if (node.cloudMesh) {
            // 金星高层硫酸云以 4 天（约 96 小时）高速逆向超自转
            const venusCloudRotRad = ((2.0 * Math.PI) / -96.0) * this.simTimeHours;
            node.cloudMesh.rotation.y = venusCloudRotRad;
          }
        }

        // 木星专属：实时同步太阳光照方向向量至 Minnaert 着色器
        if (id === 'jupiter' && this.jupiterMaterial) {
          const sunDir = this.bodyPoseProvider.getPhysicalSunDirection('jupiter', this.simTimeHours);
          this.jupiterMaterial.uniforms.sunDirection.value.copy(sunDir);
        }

        // 火星专属：实时同步太阳光照方向向量至 MarsMaterial 着色器
        if (id === 'mars' && this.marsMaterial) {
          const sunDir = this.bodyPoseProvider.getPhysicalSunDirection('mars', this.simTimeHours);
          this.marsMaterial.uniforms.sunDirection.value.copy(sunDir);
        }

        // 水星专属：实时同步太阳光照方向向量至 MercuryMaterial 着色器
        if (id === 'mercury' && this.mercuryMaterial) {
          const sunDir = this.bodyPoseProvider.getPhysicalSunDirection('mercury', this.simTimeHours);
          this.mercuryMaterial.uniforms.sunDirection.value.copy(sunDir);
        }

        // 天王星专属：实时同步太阳光照方向向量至 IceGiantMaterial 着色器
        if (id === 'uranus' && this.uranusPlanetMaterial) {
          const sunDir = this.bodyPoseProvider.getPhysicalSunDirection('uranus', this.simTimeHours);
          this.uranusPlanetMaterial.uniforms.sunDirection.value.copy(sunDir);
        }

        // 海王星专属：实时同步太阳光照方向向量至 IceGiantMaterial 着色器
        if (id === 'neptune' && this.neptunePlanetMaterial) {
          const sunDir = this.bodyPoseProvider.getPhysicalSunDirection('neptune', this.simTimeHours);
          this.neptunePlanetMaterial.uniforms.sunDirection.value.copy(sunDir);
        }

        // 土星、天王星、海王星专属：更新投射到光环与行星本体的太阳方向与遮挡投影
        if (id === 'saturn' && node.ringMesh) {
          const sunDir = this.bodyPoseProvider.getPhysicalSunDirection('saturn', this.simTimeHours);
          node.ringMesh.getWorldQuaternion(this.tempQuat).invert();
          const localRingSunDir = sunDir.clone().applyQuaternion(this.tempQuat);
          if (this.saturnRingMaterial) {
            this.saturnRingMaterial.uniforms.sunDirection.value.copy(localRingSunDir);
          }
          if (this.saturnPlanetMaterial) {
            node.mesh.getWorldQuaternion(this.tempQuat).invert();
            const localPlanetSunDir = sunDir.clone().applyQuaternion(this.tempQuat);
            this.saturnPlanetMaterial.uniforms.sunDirection.value.copy(localPlanetSunDir);
          }
        }
        if (id === 'uranus' && this.uranusRingMaterial && node.ringMesh) {
          const sunDir = this.bodyPoseProvider.getPhysicalSunDirection('uranus', this.simTimeHours);
          node.ringMesh.getWorldQuaternion(this.tempQuat).invert();
          const localSunDir = sunDir.clone().applyQuaternion(this.tempQuat);
          this.uranusRingMaterial.uniforms.sunDirection.value.copy(localSunDir);
        }
        if (id === 'neptune' && this.neptuneRingMaterial && node.ringMesh) {
          const sunDir = this.bodyPoseProvider.getPhysicalSunDirection('neptune', this.simTimeHours);
          node.ringMesh.getWorldQuaternion(this.tempQuat).invert();
          const localSunDir = sunDir.clone().applyQuaternion(this.tempQuat);
          this.neptuneRingMaterial.uniforms.sunDirection.value.copy(localSunDir);
        }
      }

      if (node.data.type === 'moon') {
        if (isPhysicalObservation && node.data.parentId !== 'earth') {
          node.systemGroup.visible = false;
          continue;
        } else {
          node.systemGroup.visible = true;
        }

        // 由 BodyPoseProvider 统一解算卫星局部位置与展示半径（支持物理观察与导航示意平滑过渡）
        const pose = this.bodyPoseProvider.getBodyPose(id, this.simTimeHours);
        node.systemGroup.position.copy(pose.position);

        // 若展示半径发生过渡（如月球在物理观察模式与示意模式切换），动态按比例平滑缩放网格
        if (node.displayRadius > 0 && pose.displayRadius > 0) {
          const scaleRatio = pose.displayRadius / node.displayRadius;
          node.mesh.scale.setScalar(scaleRatio);
          if (node.cloudMesh) node.cloudMesh.scale.setScalar(scaleRatio);
          if (node.haloMesh) node.haloMesh.scale.setScalar(scaleRatio);
        }

        // 潮汐锁定与特征景观自转相位
        const moonOrbitAngle = Math.atan2(pose.position.z, pose.position.x);
        const spinOffset = PLANET_SPIN_OFFSETS[id] || 0;
        node.mesh.rotation.y = -moonOrbitAngle + spinOffset;

        // 精确解算卫星在世界空间中的绝对坐标（母星世界坐标 + 卫星局部轨道偏移）
        const satWorldPos = new THREE.Vector3();
        if (node.data.parentId) {
          const parentNode = this.bodyNodes.get(node.data.parentId);
          if (parentNode) {
            satWorldPos.copy(parentNode.systemGroup.position).add(node.systemGroup.position);
          }
        }
        if (satWorldPos.lengthSq() < 0.001) {
          node.mesh.updateWorldMatrix(true, false);
          node.mesh.getWorldPosition(satWorldPos);
        }

        // 核心修复：基于统一物理空间公里矢量获取太阳光方向，杜绝非线性地月间距造成的 170° 巨额光照偏差 (R3)
        const satSunDir = this.bodyPoseProvider.getPhysicalSunDirection(id, this.simTimeHours);

        // 月球专属：更新世界空间太阳方向向量至 MoonMaterial
        if (id === 'moon' && this.moonMaterial) {
          this.moonMaterial.uniforms.sunDirection.value.copy(satSunDir);
        }

        // 火卫一专属：更新世界空间太阳方向向量至 AsteroidMoonMaterial
        if (id === 'phobos' && this.phobosMaterial) {
          this.phobosMaterial.uniforms.sunDirection.value.copy(satSunDir);
        }

        // 火卫二专属：更新世界空间太阳方向向量至 AsteroidMoonMaterial
        if (id === 'deimos' && this.deimosMaterial) {
          this.deimosMaterial.uniforms.sunDirection.value.copy(satSunDir);
        }

        // 木卫一专属：更新世界空间太阳方向向量至 IoMaterial
        if (id === 'io' && this.ioMaterial) {
          this.ioMaterial.uniforms.sunDirection.value.copy(satSunDir);
        }

        // 木卫二专属：更新世界空间太阳方向向量至 EuropaMaterial
        if (id === 'europa' && this.europaMaterial) {
          this.europaMaterial.uniforms.sunDirection.value.copy(satSunDir);
        }

        // 木卫三专属：更新世界空间太阳方向向量至 GanymedeMaterial
        if (id === 'ganymede' && this.ganymedeMaterial) {
          this.ganymedeMaterial.uniforms.sunDirection.value.copy(satSunDir);
        }

        // 木卫四专属：更新世界空间太阳方向向量至 CallistoMaterial
        if (id === 'callisto' && this.callistoMaterial) {
          this.callistoMaterial.uniforms.sunDirection.value.copy(satSunDir);
        }
      }

      // 更新大气光晕的向日方向
      if (node.haloMesh && (node.haloMesh.material as THREE.ShaderMaterial).uniforms?.sunDirection) {
        const worldPos = new THREE.Vector3();
        node.mesh.getWorldPosition(worldPos);
        const sunDir = worldPos.negate().normalize();
        (node.haloMesh.material as THREE.ShaderMaterial).uniforms.sunDirection.value.copy(sunDir);
      }
    }
  }

  /**
   * 捕获当前同一次观察快照 (captureObservationSnapshot)
   * 严格遵循 R3 规范：捕获真实模拟时钟、展示策略、相机机位与 lookTarget、图层开关与载具 (不再硬编码 NAV/0.0)
   */
  public captureObservationSnapshot(title = '当前观察点'): BookmarkItemV2 {
    const camSnap = this.cameraController.getSnapshot();
    const currentTargetId = camSnap.targetBodyId || camSnap.selectedBodyId || 'earth';
    const policy = this.bodyPoseProvider.getPolicy();
    const epochDate = new Date(Date.parse(BodyPoseProvider.BASE_EPOCH_ISO) + this.simTimeHours * 3600 * 1000);

    return {
      id: `bm-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      schemaVersion: 2,
      title,
      targetBodyId: currentTargetId,
      presentationPolicy: policy,
      epochIso: epochDate.toISOString(),
      spherical: {
        radius: camSnap.spherical.radius,
        phi: camSnap.spherical.phi,
        theta: camSnap.spherical.theta,
      },
      lookTarget: camSnap.lookTarget,
      viewCameraMode: this.viewCameraMode,
      vehicleId: this.currentVehicleId,
      layers: {
        showClouds: this.showClouds,
        showAtmosphere: this.showAtmosphere,
        teachingLight: this.teachingLight,
        showOrbits: this.showOrbits,
        venusRadarMode: this.venusRadarMode,
      },
      simTimeHours: this.simTimeHours,
      createdAtIso: new Date().toISOString(),
    };
  }

  public setSimTimeHours(hours: number): void {
    if (Number.isFinite(hours)) {
      this.simTimeHours = hours;
      // 立即刷新所有天体公转与自转姿态，保证后续相机指令获取到最新瞬时四元数
      this.updateEphemerisPoses(0);
      this.cameraController.update(0, (id: BodyId) => this.getBodyWorldPose(id));
    }
  }

  public getSimTimeHours(): number {
    return this.simTimeHours;
  }


  public dispose(): void {
    this.isRunning = false;
    cancelAnimationFrame(this.animFrameId);
    window.removeEventListener('resize', this.onResize);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('lostpointercapture', this.onPointerUp);
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

    if (this.earthTileManager) {
      this.earthTileManager.dispose();
      this.earthTileManager = null;
    }

    this.renderer.dispose();

    if (this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
  }
}
