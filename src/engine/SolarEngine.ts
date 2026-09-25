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
  getNavDisplayRadius,
  getPlanetNavPosition,
  PLANET_SPIN_OFFSETS,
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
import type { BookmarkItemV3 } from '../contracts/bookmark';
import type { PhysicalSystemSnapshot } from '../contracts/physics';
import type { ObservationMode } from '../world-support/visibility';
import {
  getMoonTextureByBodyId,
  getTitanHazeTexture,
} from '../astronomy/MoonTextures';
import { soundEffects } from '../audio/SoundEffects';
import { VehicleLoader } from '../vehicles/VehicleLoader';
import { LandingController } from '../surface/LandingController';
import { RegionalAlbedoLayer } from '../surface/RegionalAlbedoLayer';
import { LANDING_SITES, type LandingTelemetry, type LandingAvailability, type LandingSite } from '../contracts/landing';
import {
  latLonDirection,
  stepOrientationQuat,
  quatAngle,
  horizonDip,
  pitchForHorizonElevation,
  smootherstep,
} from '../world-support/descentCurve';
import { TerrainHeightProvider } from '../surface/TerrainHeightProvider';
import { RasterTerrainSource } from '../surface/RasterTerrainSource';
import { LolaRegionalSource } from '../surface/LolaRegionalSource';
import { MolaRegionalSource } from '../surface/MolaRegionalSource';
import { JezeroTerrainSource } from '../surface/JezeroTerrainSource';
import {
  generateRockPlacements,
  buildRockGeometry,
  rockScenePosition,
} from '../surface/ProceduralRockField';
import { focalPixelsPx, projectedTexelPx, terrainRevealOpacity } from '../world-support/screenSpaceMetrics';
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
  material?: THREE.Material;
  coronaMesh?: THREE.Mesh;
}

/** S5-3：月面站点表面栈（按站懒建；group 挂 satMesh，激活时切换可见性与挖孔球） */
interface MoonSiteStack {
  siteId: string;
  group: THREE.Group;
  raster: RasterTerrainSource;
  lola: LolaRegionalSource;
  holedGeometry: THREE.BufferGeometry | null;
  valleyMesh?: THREE.Mesh;
  valleyMaterial?: THREE.MeshStandardMaterial;
  capMesh?: THREE.Mesh;
  lolaMaterials: THREE.MeshStandardMaterial[];
  rockFieldMaterial: THREE.MeshStandardMaterial | null;
  collarMaterial: THREE.MeshStandardMaterial | null;
  loadStarted: boolean;
  built: boolean;
}

/** S5-6：火星站点表面栈（镜像月面 MoonSiteStack；group 挂 mars mesh） */
interface MarsSiteStack {
  siteId: string;
  group: THREE.Group;
  dtm: JezeroTerrainSource;
  mola: MolaRegionalSource;
  holedGeometry: THREE.BufferGeometry | null;
  terrainMesh?: THREE.Mesh;
  terrainMaterial?: THREE.MeshStandardMaterial;
  capMesh?: THREE.Mesh;
  l1Materials: THREE.MeshStandardMaterial[];
  rockFieldMaterial: THREE.MeshStandardMaterial | null;
  collarMaterial: THREE.MeshStandardMaterial | null;
  loadStarted: boolean;
  built: boolean;
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
  /** 着陆状态机上一帧状态 (识别 ASCENDING->ORBIT 返轨边沿，避免抢占外部地表观察) */
  private prevLandingState: string = 'ORBIT';

  // P3b-A：降落任务与准备流水线（Pro P3b 审查 §3.3/§7——无定时器，帧驱动；
  // 异步/延迟动作一律绑定 missionId，用户输入或世界变化使旧许可失效）
  private landingMissionId = 0;
  private landingPrep: {
    missionId: number;
    phase: 'policy' | 'lighting' | 'capture';
    userInputRevisionAtStart: number;
  } | null = null;
  /** 最近一次准备阶段为光照做出的模拟时刻调整（HUD 如实提示；null=未调整） */
  private lastLandingLightingAdjustHours: number | null = null;
  /** P3b-A：同帧捕获的起始四元数（含滚转；验收核对用——导引当前值见 landingGuidedQuat） */
  private landingStartQuat: THREE.Quaternion | null = null;
  // P3b-B：速率受限的姿态导引（Pro §5）——从捕获 q0 出发逐帧向地平线投影目标收敛，
  // 用户打断后失效（保留用户视线），requestLandingReguide() 从当前姿态重新收敛
  private landingGuidedQuat: THREE.Quaternion | null = null;
  private landingGuideActive = false;
  /** DESCENDING 起点 userInputRevision 基线（B3：任何视角输入立即打断进 HOLD） */
  private landingUserRevAtDescend = 0;

  // 批次 R5：着陆控制器与月表 3D 浮雕网格
  private landingController: LandingController = new LandingController('taurus-littrow');

  // S4c：当前任务站点（下降流泛化——月/火多站共用一个状态机；startLunarLanding
  // 在准备前 switchSite 到相机目标天体的站点，此后全链消费本 getter）
  private get activeLandingSite(): LandingSite {
    return this.landingController.getSite();
  }
  private get activeLandingBodyId(): BodyId {
    return this.landingController.getSite().bodyId;
  }

  /** S5-3：月面站点资产地址（taurus 用单例默认；其他站显式 pack 目录） */
  private static readonly MOON_SITE_ASSET_URLS: Record<string, { dem?: string; l1?: string }> = {
    'taurus-littrow': {},
    'hadley-rille': { dem: '/data/dem/apollo15-v1', l1: '/data/dem/lola-l1-hadley-v1' },
    'tranquility-base': { dem: '/data/dem/apollo11-v1', l1: '/data/dem/lola-l1-tranquility-v1' },
  };

  /** S5-6：火星站点资产地址（jezero 用单例默认；sourceId=遥测溯源 id 即包目录名） */
  private static readonly MARS_SITE_ASSET_URLS: Record<string, { dem?: string; l1?: string; sourceId?: string }> = {
    jezero: {},
    'victoria-duck-bay': { dem: '/data/dem/victoria-hirise-v1', l1: '/data/dem/mola-l1-victoria-v1', sourceId: 'victoria-hirise-v1' },
    'gale-murray-buttes': { dem: '/data/dem/gale-hirise-v1', l1: '/data/dem/mola-l1-gale-v1', sourceId: 'gale-hirise-v1' },
  };

  /**
   * S5-6：幂等预取火星站点资产（DTM+L1）并懒建栈（镜像月面）。默认站在引擎
   * 初始化时调用；其他站在可用性解析命中该站时触发。失败仅告警——栈保持
   * 未建/隐藏，不伪造地形。
   */
  private ensureMarsSiteAssets(siteId: string): void {
    const stack = this.marsSiteStacks.get(siteId);
    if (!stack || stack.loadStarted) return;
    stack.loadStarted = true;
    const urls = SolarEngine.MARS_SITE_ASSET_URLS[siteId] ?? {};
    Promise.all([
      stack.dtm.load(urls.dem),
      stack.mola.load(urls.l1).catch(() => undefined), // L1 可选：失败回退两级栈
    ])
      .then(() => this.buildMarsSiteStack(stack))
      .catch((err: unknown) => {
        console.error(`[SolarEngine] 火星站点 ${siteId} DTM 装载失败，真实地表网格保持隐藏:`, err);
      });
  }

  /**
   * S5-3：幂等预取月面站点资产（DTM+L1）并懒建栈。默认站在引擎初始化时调用
   * （保持原有行为）；其他站在可用性解析命中该站时触发。失败仅告警——栈保持
   * 未建/隐藏，不伪造地形。
   */
  private ensureMoonSiteAssets(siteId: string): void {
    const stack = this.moonSiteStacks.get(siteId);
    if (!stack || stack.loadStarted) return;
    stack.loadStarted = true;
    const urls = SolarEngine.MOON_SITE_ASSET_URLS[siteId] ?? {};
    Promise.all([
      stack.raster.load(urls.dem),
      stack.lola.load(urls.l1).catch(() => undefined), // L1 可选：失败回退两级栈
    ])
      .then(() => this.buildMoonSiteStack(stack))
      .catch((err: unknown) => {
        console.error(`[SolarEngine] 月面站点 ${siteId} DTM 装载失败，真实地表网格保持隐藏:`, err);
      });
  }

  /**
   * S5-3：按站构建月面表面栈（DTM 窗网格 + 碎石场 + LOLA L1/裙圈 + 挖孔球 +
   * 孔底盖板[+ WAC EMP——仅 taurus 有该资产]）。构建期间临时把 provider 的激活
   * 月面站切到本站（buildDemWindowGeometry/collar 按激活站路由），完毕后恢复。
   */
  private buildMoonSiteStack(stack: MoonSiteStack): void {
    const satMesh = this.moonMesh;
    const satRadius = this.moonBaseRadius;
    if (!satMesh || stack.built || !stack.raster.isReady) return;
    const site = LANDING_SITES[stack.siteId];
    if (!site) return;
    stack.built = true;
    const heightProvider = TerrainHeightProvider.getInstance();
    const rasterSource = stack.raster;
    const lola = stack.lola;
    const prevActiveSite = this.activeMoonSiteId;
    heightProvider.setActiveMoonSite(stack.siteId);
    try {
      const valleyMat = new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        roughness: 0.95,
        metalness: 0.05,
        side: THREE.FrontSide,
        // P3-T5：DTM 与 L1 同为实测地形（高差米级），近距叠显时以深度偏移
        // 保证细级（5m）稳定胜出——LOD 层级排序，非掩盖缺陷
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      stack.valleyMaterial = valleyMat;
      const valleyMesh = new THREE.Mesh(new THREE.BufferGeometry(), valleyMat);
      valleyMesh.name = `${stack.siteId}-terrain`;
      valleyMesh.visible = false;
      valleyMesh.receiveShadow = true;
      valleyMesh.castShadow = true;
      stack.group.add(valleyMesh);
      stack.valleyMesh = valleyMesh;

      const geo = heightProvider.buildDemWindowGeometry(satRadius);
      const ortho = rasterSource.buildOrthoTexture();
      if (geo && ortho) {
        ortho.colorSpace = THREE.SRGBColorSpace; // I/F 影像产品按显示意图处理
        valleyMat.map = ortho;
        valleyMat.color.set(0xffffff);
        valleyMat.needsUpdate = true;
        valleyMesh.geometry.dispose();
        valleyMesh.geometry = geo;
        valleyMesh.visible = true;
      } else {
        console.error(`[SolarEngine] ${stack.siteId} DTM 已装载但网格构建失败`);
      }

      // S3a：程序碎石场（示意层——同 taurus 契约：确定性随机、贴实测 DTM、坡度偏好）
      try {
        const profile = site.rockField ?? { count: 400, radiusM: 1000, sizeMaxM: 2, slopeWeight: 0.3 };
        const sample = (lat: number, lon: number) => {
          const s = rasterSource.sampleHeight(lat, lon);
          return s.valid ? { heightM: s.heightM } : null;
        };
        const placements = generateRockPlacements({
          siteLat: site.centerLat,
          siteLon: site.centerLon,
          radiusM: profile.radiusM,
          count: profile.count,
          sizeMaxM: profile.sizeMaxM,
          clearZoneM: 20,
          maxSlopeDeg: 19,
          slopeWeight: profile.slopeWeight,
          sampleHeight: sample,
          seed: 20260924,
        });
        const rockMat = new THREE.MeshStandardMaterial({ color: 0x9a9186, roughness: 1, metalness: 0 });
        stack.rockFieldMaterial = rockMat;
        // S4b 勘误：scaleM 是米——须乘 metricScale 折算网格局部单位再 compose
        const rockMetricScale = satRadius / 1737400;
        const byVariant: typeof placements[] = [[], [], []];
        for (const p of placements) byVariant[p.variant].push(p);
        byVariant.forEach((list, v) => {
          if (!list.length) return;
          const inst = new THREE.InstancedMesh(buildRockGeometry(20260924, v), rockMat, list.length);
          const m = new THREE.Matrix4();
          const q = new THREE.Quaternion();
          const up = new THREE.Vector3(0, 1, 0);
          list.forEach((p, i) => {
            const pos = rockScenePosition(p.latDeg, p.lonDeg, p.heightM, satRadius);
            pos.setLength(pos.length() + 0.5 * p.scaleM[1] * rockMetricScale); // 露出 75%
            q.setFromAxisAngle(up, p.rotYRad);
            m.compose(
              pos,
              q,
              new THREE.Vector3(
                p.scaleM[0] * rockMetricScale,
                p.scaleM[1] * rockMetricScale,
                p.scaleM[2] * rockMetricScale
              )
            );
            inst.setMatrixAt(i, m);
          });
          inst.instanceMatrix.needsUpdate = true;
          inst.name = 'procedural-rockfield';
          inst.frustumCulled = false; // 实例跨数 km，包围球逐实例剔除不适用
          stack.group.add(inst);
        });
      } catch (e) {
        console.warn('[SolarEngine] 碎石场构建失败（不影响主链路）:', e);
      }

      // P3-T5：LOLA L1 中间层（结构同前；L1 不可用回退两级栈）
      let lolaReady = false;
      if (lola.isReady) lolaReady = true;
      else console.warn(`[SolarEngine] ${stack.siteId} LOLA L1 不可用（回退两级栈）:`, lola.error);
      const holed = heightProvider.buildHoledMoonSphereGeometry(
        satRadius,
        128,
        64,
        lolaReady ? lola.windowBounds ?? undefined : undefined
      );
      if (holed) {
        stack.holedGeometry = holed.geometry;
        if (stack.siteId === this.activeMoonSiteId) {
          satMesh.geometry.dispose(); // 原始球仅默认站首次构建时释放
          satMesh.geometry = holed.geometry;
        }
        if (lolaReady) {
          const nacWindow = rasterSource.windowBounds;
          // P3-T5b：L1 在 DTM 高精窗处挖孔；窗缘裙圈（NAC 内缘→LOLA 外缘）填缝
          const lolaHole = nacWindow
            ? {
                latMin: nacWindow.latMin - 0.12, latMax: nacWindow.latMax + 0.12,
                lonMin: nacWindow.lonMin - 0.12, lonMax: nacWindow.lonMax + 0.12,
              }
            : undefined;
          const lolaGeo = lola.buildRegionalGeometry(satRadius, 2, lolaHole);
          if (lolaGeo) {
            const lolaMat = new THREE.MeshStandardMaterial({
              color: 0xffffff,
              roughness: 0.95,
              metalness: 0.05,
            });
            stack.lolaMaterials = [lolaMat];
            // L1 网格 UV=全球等距圆柱：2K 全球图直接可用（WAC 换装仅 taurus）
            new THREE.TextureLoader().load('/assets/textures/moon/lroc_color_2k.jpg', (tex) => {
              tex.colorSpace = THREE.SRGBColorSpace;
              for (const mat of stack.lolaMaterials) {
                if (mat.map) continue;
                mat.map = tex;
                mat.needsUpdate = true;
              }
            });
            const lolaMesh = new THREE.Mesh(lolaGeo, lolaMat);
            lolaMesh.name = 'lola-l1-regional-terrain';
            stack.group.add(lolaMesh);
            const skirtGeo = lola.buildBoundarySkirt(satRadius, holed.holeBounds);
            if (skirtGeo) {
              const skirtMesh = new THREE.Mesh(skirtGeo, lolaMat); // 同材质：换装一次覆盖两网格
              skirtMesh.name = 'lola-l1-boundary-skirt';
              stack.group.add(skirtMesh);
            }
            if (nacWindow) {
              const nacHeightAt = (lat: number, lon: number): number => {
                const cl = Math.max(nacWindow.latMin, Math.min(nacWindow.latMax, lat));
                const co = Math.max(nacWindow.lonMin, Math.min(nacWindow.lonMax, lon));
                return rasterSource.sampleHeight(cl, co).heightM;
              };
              const rimGeo = lola.buildWindowRimSkirt(satRadius, nacWindow, nacHeightAt, 0.15);
              if (rimGeo) {
                // 裙圈是窗缘细级：polygonOffset 压过 L1 挖孔锯齿边（LOD 排序）
                const rimMat = lolaMat.clone();
                rimMat.polygonOffset = true;
                rimMat.polygonOffsetFactor = -1;
                rimMat.polygonOffsetUnits = -1;
                stack.lolaMaterials.push(rimMat);
                const rimMesh = new THREE.Mesh(rimGeo, rimMat);
                rimMesh.name = 'lola-l1-window-rim';
                stack.group.add(rimMesh);
              }
            }
            stack.collarMaterial = lolaMat; // WAC 换装目标沿用字段语义（taurus）
          } else {
            console.warn('[SolarEngine] L1 网格构建失败（保持两级栈）');
            lolaReady = false;
          }
        }
        if (!lolaReady) {
          const collarGeo = heightProvider.buildCollarGeometry(satRadius, holed.holeBounds);
          if (collarGeo) {
            const collarMat = new THREE.MeshStandardMaterial({
              color: 0xffffff,
              roughness: 0.95,
              metalness: 0.05,
            });
            stack.collarMaterial = collarMat;
            new THREE.TextureLoader().load('/assets/textures/moon/lroc_color_2k.jpg', (tex) => {
              if (collarMat.map) return;
              tex.colorSpace = THREE.SRGBColorSpace;
              collarMat.map = tex;
              collarMat.needsUpdate = true;
            });
            const collarMesh = new THREE.Mesh(collarGeo, collarMat);
            collarMesh.name = `${stack.siteId}-collar`;
            collarMesh.receiveShadow = true;
            stack.group.add(collarMesh);
          }
        }

        // P3b-E：孔底盖板——兜底面与本体共享材质；半径压到本站 DTM 窗最低高程
        // 以下留余量（taurus −4060.5m→−4200；hadley −2218.3m→−2350）
        const capBelowM = stack.siteId === 'hadley-rille' ? 2350 : stack.siteId === 'tranquility-base' ? 2100 : 4200;
        const capMesh = new THREE.Mesh(
          new THREE.SphereGeometry(satRadius * (1 - capBelowM / 1737400), 32, 24),
          satMesh.material
        );
        capMesh.name = 'moon-hole-cap';
        stack.capMesh = capMesh;
        stack.group.add(capMesh);

        // P3b-C/P3-T5：WAC EMP 区域反照率（仅 taurus 打包了该资产）
        if (stack.siteId === 'taurus-littrow') {
          this.regionalAlbedo = new RegionalAlbedoLayer(satRadius, holed.holeBounds, {
            attachMesh: !lolaReady,
          });
          void this.regionalAlbedo.load().then(() => {
            const layer = this.regionalAlbedo;
            if (!layer || !layer.isReady) {
              console.warn('[SolarEngine] WAC 区域反照率层不可用（全球图兜底）:', layer?.error);
              return;
            }
            const collarTex = layer.attach(satMesh);
            if (!collarTex) return;
            if (lolaReady) {
              this.lolaWacTexture = collarTex; // 门控开启时在 animate 内换装
            } else if (stack.collarMaterial) {
              stack.collarMaterial.map = collarTex;
              stack.collarMaterial.needsUpdate = true;
            }
          });
        }
      }
      if (stack.siteId === this.activeMoonSiteId) this.refreshActiveMoonStackRefs(stack);
    } finally {
      heightProvider.setActiveMoonSite(prevActiveSite);
    }
  }

  /** S5-3：激活站引用刷新（animate 渐显门控/WAC 换装消费的引擎字段指向激活栈） */
  private refreshActiveMoonStackRefs(stack: MoonSiteStack): void {
    this.lunarValleyMesh = stack.valleyMesh;
    this.lunarValleyMaterial = stack.valleyMaterial;
    this.moonHoleCapMesh = stack.capMesh;
    this.lolaMaterial = stack.lolaMaterials[0];
    this.lolaMaterials = stack.lolaMaterials;
    this.rockFieldMaterial = stack.rockFieldMaterial;
  }

  /**
   * S5-3：激活月面站——切换 group 可见性与挖孔球几何（出站几何保留供再激活）、
   * 刷新引擎激活引用、provider 查询路由改指本站栅格。站点资产未就绪时几何
   * 暂保持原状，构建完成后由 buildMoonSiteStack 补装。
   */
  private activateMoonSite(siteId: string): void {
    const stack = this.moonSiteStacks.get(siteId);
    if (!stack || this.activeMoonSiteId === siteId) return;
    this.activeMoonSiteId = siteId;
    for (const s of this.moonSiteStacks.values()) {
      s.group.visible = s.siteId === siteId;
    }
    if (this.moonMesh && stack.holedGeometry) {
      this.moonMesh.geometry = stack.holedGeometry;
    }
    this.refreshActiveMoonStackRefs(stack);
    TerrainHeightProvider.getInstance().setActiveMoonSite(siteId);
  }

  /**
   * S5-6：按站构建火星表面栈（镜像月面 buildMoonSiteStack；原 jezero 单站构建
   * 逻辑自天体初始化分支迁出）：DTM 窗网格 + 程序碎石场 + MOLA L1/饱和度裙圈 +
   * 挖孔球 + 孔底盖板。构建期间临时把 provider 激活火星站切到本站（collar
   * 几何按激活站路由），完毕后恢复。
   */
  private buildMarsSiteStack(stack: MarsSiteStack): void {
    const satMesh = this.marsMesh;
    const satRadius = this.marsBaseRadius;
    if (!satMesh || stack.built || !stack.dtm.isReady) return;
    const site = LANDING_SITES[stack.siteId];
    if (!site) return;
    stack.built = true;
    const heightProvider = TerrainHeightProvider.getInstance();
    const dtm = stack.dtm;
    const mola = stack.mola;
    const prevActiveSite = this.activeMarsSiteId;
    heightProvider.setActiveMarsSite(stack.siteId);
    try {
      const terrainMat = new THREE.MeshStandardMaterial({
        color: 0xb08d6f,
        roughness: 0.95,
        metalness: 0.02,
        side: THREE.FrontSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      stack.terrainMaterial = terrainMat;
      const terrainMesh = new THREE.Mesh(new THREE.BufferGeometry(), terrainMat);
      terrainMesh.name = `${stack.siteId}-terrain`;
      terrainMesh.visible = false;
      terrainMesh.receiveShadow = true;
      stack.group.add(terrainMesh);
      stack.terrainMesh = terrainMesh;

      const geo = dtm.buildDemWindowGeometry(satRadius);
      const ortho = dtm.buildOrthoTexture();
      if (!geo || !ortho) {
        console.error(`[SolarEngine] ${stack.siteId} DTM 已装载但网格构建失败`);
        return;
      }
      terrainMat.map = ortho;
      terrainMat.color.set(0xffffff);
      terrainMat.needsUpdate = true;
      terrainMesh.geometry.dispose();
      terrainMesh.geometry = geo;
      terrainMesh.visible = true;

      // 碎石场（示意层，同月面 S3b 契约：确定性随机、贴真实 DTM、坡度偏好）
      try {
        const profile = site.rockField ?? { count: 400, radiusM: 1000, sizeMaxM: 2, slopeWeight: 0.3 };
        const sample = (lat: number, lon: number) => {
          const s = dtm.sampleHeight(lat, lon);
          return s.valid ? { heightM: s.heightM } : null;
        };
        const placements = generateRockPlacements({
          siteLat: site.centerLat,
          siteLon: site.centerLon,
          radiusM: profile.radiusM,
          count: profile.count,
          sizeMaxM: profile.sizeMaxM,
          clearZoneM: 20,
          maxSlopeDeg: 19,
          slopeWeight: profile.slopeWeight,
          sampleHeight: sample,
          seed: 20260924,
          datumRadiusM: dtm.datumRadius,
        });
        const rockMat = new THREE.MeshStandardMaterial({ color: 0x6b5647, roughness: 1, metalness: 0 });
        stack.rockFieldMaterial = rockMat;
        // S4b 勘误：米 → 网格局部单位（同月面修复；火星 datum = 本站 HiRISE 局部球）
        const rockMetricScale = satRadius / dtm.datumRadius;
        const byVariant: typeof placements[] = [[], [], []];
        for (const p of placements) byVariant[p.variant].push(p);
        byVariant.forEach((list, v) => {
          if (!list.length) return;
          const inst = new THREE.InstancedMesh(buildRockGeometry(20260924, v), rockMat, list.length);
          const m = new THREE.Matrix4();
          const q = new THREE.Quaternion();
          const up = new THREE.Vector3(0, 1, 0);
          list.forEach((p, i) => {
            const pos = rockScenePosition(
              p.latDeg, p.lonDeg, p.heightM, satRadius, dtm.datumRadius
            );
            pos.setLength(pos.length() + 0.5 * p.scaleM[1] * rockMetricScale);
            q.setFromAxisAngle(up, p.rotYRad);
            m.compose(
              pos,
              q,
              new THREE.Vector3(
                p.scaleM[0] * rockMetricScale,
                p.scaleM[1] * rockMetricScale,
                p.scaleM[2] * rockMetricScale
              )
            );
            inst.setMatrixAt(i, m);
          });
          inst.instanceMatrix.needsUpdate = true;
          inst.name = 'procedural-rockfield-mars';
          inst.frustumCulled = false;
          stack.group.add(inst);
        });
      } catch (e) {
        console.warn('[SolarEngine] 火星碎石场构建失败（不影响主链路）:', e);
      }

      // S5-1：MOLA L1 中间层（463m/px 真实区域地形，GMM3 areoid）。就绪时
      // 球面孔扩大到 L1 裁窗边界、L1 网格成为该区域唯一有效不透明表面，
      // S4b 低清 collar 环带退役；不可用则回退两级栈（孔=DTM 窗+collar）。
      const molaReady = mola.isReady;
      if (!molaReady) {
        console.warn(`[SolarEngine] ${stack.siteId} MOLA L1 不可用（回退两级栈）:`, mola.error);
      }
      const wb = dtm.windowBounds;
      const holeSource = molaReady ? mola.windowBounds ?? wb : wb;
      const holed = holeSource
        ? heightProvider.buildHoledMoonSphereGeometry(satRadius, 128, 64, holeSource)
        : null;
      if (holed) {
        stack.holedGeometry = holed.geometry;
        if (stack.siteId === this.activeMarsSiteId) {
          satMesh.geometry.dispose(); // 原始球仅默认站首次构建时释放
          satMesh.geometry = holed.geometry;
        }
        if (molaReady) {
          // L1 在 HiRISE 高精窗处挖孔（无孔平板在眼高附近切过谷底呈"水面穿模"）；
          // 窗缘裙圈（HiRISE 内缘→MOLA 外缘）填缝
          const dtmHole = wb
            ? {
                latMin: wb.latMin - 0.12, latMax: wb.latMax + 0.12,
                lonMin: wb.lonMin - 0.12, lonMax: wb.lonMax + 0.12,
              }
            : undefined;
          const l1Geo = mola.buildRegionalGeometry(satRadius, 2, dtmHole);
          if (l1Geo) {
            const l1Mat = new THREE.MeshStandardMaterial({
              color: 0xffffff,
              roughness: 0.95,
              metalness: 0.02,
            });
            stack.l1Materials = [l1Mat];
            // L1 网格 UV=全球等距圆柱：2K 全球图直接可用
            new THREE.TextureLoader().load('/assets/textures/mars/2k_mars.jpg', (tex) => {
              tex.colorSpace = THREE.SRGBColorSpace;
              for (const mat of stack.l1Materials) {
                if (mat.map) continue;
                mat.map = tex;
                mat.needsUpdate = true;
              }
            });
            const l1Mesh = new THREE.Mesh(l1Geo, l1Mat);
            l1Mesh.name = 'mola-l1-regional-terrain';
            l1Mesh.receiveShadow = true;
            stack.group.add(l1Mesh);
            const skirtGeo = mola.buildBoundarySkirt(satRadius, holed.holeBounds);
            if (skirtGeo) {
              const skirtMesh = new THREE.Mesh(skirtGeo, l1Mat); // 同材质：换装一次覆盖两网格
              skirtMesh.name = 'mola-l1-boundary-skirt';
              skirtMesh.receiveShadow = true;
              stack.group.add(skirtMesh);
            }
            if (wb) {
              const dtmHeightAt = (lat: number, lon: number): number => {
                const cl = Math.max(wb.latMin, Math.min(wb.latMax, lat));
                const co = Math.max(wb.lonMin, Math.min(wb.lonMax, lon));
                return dtm.sampleHeight(cl, co).heightM;
              };
              const rimGeo = mola.buildWindowRimSkirt(satRadius, wb, dtmHeightAt, 0.15);
              if (rimGeo) {
                // 裙圈是窗缘细级：polygonOffset 压过 L1 挖孔锯齿边（LOD 排序）。
                // 饱和度渐变（展示层，不改动源影像）：内缘接灰度 HiRISE 正射、
                // 外缘接彩色 2K 全球图——跨 LOD 接缝的灰↔彩色差在 ~9km 裙圈内
                // 平滑过渡（S5-1 collar 接缝色差消除）
                const RIM_RINGS = 10, RIM_SEGS = 96;
                const perimeter = 4 * RIM_SEGS;
                const grayMix = new Float32Array(rimGeo.getAttribute('position').count);
                for (let v = 0; v < grayMix.length; v++) {
                  grayMix[v] = Math.floor(v / perimeter) / RIM_RINGS;
                }
                rimGeo.setAttribute('aGrayMix', new THREE.BufferAttribute(grayMix, 1));
                const rimMat = l1Mat.clone();
                rimMat.polygonOffset = true;
                rimMat.polygonOffsetFactor = -1;
                rimMat.polygonOffsetUnits = -1;
                rimMat.onBeforeCompile = (shader) => {
                  shader.vertexShader = `attribute float aGrayMix;\nvarying float vGrayMix;\n${shader.vertexShader}`.replace(
                    '#include <begin_vertex>',
                    '#include <begin_vertex>\n\tvGrayMix = aGrayMix;'
                  );
                  shader.fragmentShader = `varying float vGrayMix;\n${shader.fragmentShader}`.replace(
                    '#include <map_fragment>',
                    '#include <map_fragment>\n\tfloat grayLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));\n\tdiffuseColor.rgb = mix(vec3(grayLum), diffuseColor.rgb, vGrayMix);'
                  );
                };
                stack.l1Materials.push(rimMat);
                const rimMesh = new THREE.Mesh(rimGeo, rimMat);
                rimMesh.name = 'mola-l1-window-rim';
                rimMesh.receiveShadow = true;
                stack.group.add(rimMesh);
              }
            }
          } else {
            console.warn('[SolarEngine] MOLA L1 网格构建失败（保持两级栈）');
          }
        }
        if (!molaReady) {
          const collarGeo = heightProvider.buildCollarGeometry(
            satRadius, holed.holeBounds, 10, 96, 'mars'
          );
          if (collarGeo) {
            const collarMat = new THREE.MeshStandardMaterial({
              color: 0xffffff,
              roughness: 0.95,
              metalness: 0.02,
            });
            stack.collarMaterial = collarMat;
            new THREE.TextureLoader().load('/assets/textures/mars/2k_mars.jpg', (tex) => {
              tex.colorSpace = THREE.SRGBColorSpace;
              collarMat.map = tex;
              collarMat.needsUpdate = true;
            });
            const collarMesh = new THREE.Mesh(collarGeo, collarMat);
            collarMesh.name = `${stack.siteId}-collar`;
            collarMesh.receiveShadow = true;
            stack.group.add(collarMesh);
          }
        }
        // 孔底盖板：L1 就绪时压到 L1 裁窗最低高程以下留余量（MOLA datum
        // 3396km 球）；两级栈时维持 −2900m（HiRISE 局部球 datum）
        const capDepthM = molaReady
          ? Math.abs(mola.metaReady?.minimumHeightM ?? -2900) + 402
          : 2900;
        const capDatumM = molaReady
          ? mola.metaReady?.projection.referenceRadiusM ?? dtm.datumRadius
          : dtm.datumRadius;
        const capMesh = new THREE.Mesh(
          new THREE.SphereGeometry(satRadius * (1 - capDepthM / capDatumM), 32, 24),
          satMesh.material
        );
        capMesh.name = 'mars-hole-cap';
        stack.capMesh = capMesh;
        stack.group.add(capMesh);
      }
      if (stack.siteId === this.activeMarsSiteId) this.refreshActiveMarsStackRefs(stack);
    } finally {
      heightProvider.setActiveMarsSite(prevActiveSite);
    }
  }

  /** S5-6：激活站引用刷新（animate 渐显门控/雾/曝光消费的引擎字段指向激活栈） */
  private refreshActiveMarsStackRefs(stack: MarsSiteStack): void {
    this.marsTerrainMesh = stack.terrainMesh;
    this.marsTerrainMaterial = stack.terrainMaterial;
    this.marsHoleCapMesh = stack.capMesh;
    this.marsL1Materials = stack.l1Materials;
    this.marsCollarMaterial = stack.collarMaterial ?? undefined;
    this.marsRockFieldMaterial = stack.rockFieldMaterial;
  }

  /**
   * S5-6：激活火星站——切换 group 可见性与挖孔球几何（出站几何保留供再激活）、
   * 刷新引擎激活引用、provider 查询路由改指本站栅格。站点资产未就绪时几何
   * 暂保持原状，构建完成后由 buildMarsSiteStack 补装。
   */
  private activateMarsSite(siteId: string): void {
    const stack = this.marsSiteStacks.get(siteId);
    if (!stack || this.activeMarsSiteId === siteId) return;
    this.activeMarsSiteId = siteId;
    for (const s of this.marsSiteStacks.values()) {
      s.group.visible = s.siteId === siteId;
    }
    if (this.marsMesh && stack.holedGeometry) {
      this.marsMesh.geometry = stack.holedGeometry;
    }
    this.refreshActiveMarsStackRefs(stack);
    TerrainHeightProvider.getInstance().setActiveMarsSite(siteId);
  }

  /**
   * 相机目标天体 → 该天体可下降站点（descentEnabled !== false）；无则 null。
   * S5-3：同天体多站时按相机星下点与站点方向点积取最近（点积排序同时给出
   * 半球可见性与角距序——可见半球站优先，均在背面时取最近者走 travel-to-site）。
   */
  private resolveLandingSiteForCamera(camSnap: CameraStateSnapshot): { bodyId: BodyId; site: LandingSite } | null {
    for (const id of [camSnap.targetBodyId, camSnap.selectedBodyId]) {
      if (!id) continue;
      const candidates = Object.values(LANDING_SITES).filter(
        (s) => s.bodyId === id && s.descentEnabled !== false
      );
      if (!candidates.length) continue;
      if (candidates.length === 1) return { bodyId: id, site: candidates[0] };
      const pose = this.getBodyWorldPose(id);
      const rel = this.camera.position
        .clone()
        .sub(pose.pos)
        .applyQuaternion(pose.quaternion.clone().invert())
        .normalize();
      let best = candidates[0];
      let bestDot = -Infinity;
      for (const s of candidates) {
        const d = latLonDirection(s.centerLat, s.centerLon);
        const dot = rel.x * d[0] + rel.y * d[1] + rel.z * d[2];
        if (dot > bestDot) {
          bestDot = dot;
          best = s;
        }
      }
      return { bodyId: id, site: best };
    }
    return null;
  }
  private lunarValleyMesh?: THREE.Mesh;
  private lunarValleyMaterial?: THREE.MeshStandardMaterial;
  private moonHoleCapMesh?: THREE.Mesh;
  private lolaMaterial?: THREE.MeshStandardMaterial;
  private lolaMaterials: THREE.MeshStandardMaterial[] = [];
  private lolaWacTexture?: THREE.Texture;
  /** S3a 程序碎石场（示意层）：材质驱动距离淡入 */
  private rockFieldMaterial: THREE.MeshStandardMaterial | null = null;
  private moonMesh?: THREE.Mesh;
  // S4b：耶泽罗火星地表（结构与月面两级栈同构；无 L1 中间层——S5 MOLA 接入）
  private marsTerrainMesh?: THREE.Mesh;
  private marsTerrainMaterial?: THREE.MeshStandardMaterial;
  private marsCollarMaterial?: THREE.MeshStandardMaterial;
  private marsL1Materials: THREE.MeshStandardMaterial[] = [];
  private marsHaloMesh?: THREE.Mesh;
  private marsHoleCapMesh?: THREE.Mesh;
  private marsRockFieldMaterial: THREE.MeshStandardMaterial | null = null;
  // S5-3：月面多站点栈——每站一组表面网格（DTM 窗/L1/裙边/盖板/碎石）挂各自的
  // group；激活站持有挖孔球几何与 animate 消费引用。taurus-littrow 默认激活
  // （单例栅格，行为同前）；其他站懒装载（可用性解析命中即预取）。
  private moonSiteStacks = new Map<string, MoonSiteStack>();
  private activeMoonSiteId = 'taurus-littrow';
  private moonBaseRadius = 0.5;
  // S5-6：火星多站点栈（镜像月面）。jezero 默认激活（单例，行为同前）；
  // victoria/gale 懒装载（可用性解析命中即预取）。
  private marsSiteStacks = new Map<string, MarsSiteStack>();
  private activeMarsSiteId = 'jezero';
  private marsMesh?: THREE.Mesh;
  private marsBaseRadius = 0.5;
  // S4c：火星尘色大气（示意层）——天空单色浸染（星图×尘色）+ 地表线性雾。
  // 非散射模拟：真实火星白昼天空亮黄褐且星不可见，此处为轻量近似，消除
  // "无大气天体般的纯黑星空 + 生硬地平线"观感；月面无大气保持纯黑星空=真实。
  private dustSkyMix = 0;
  private surfaceExposureMix = 0;
  private readonly marsDustColor = new THREE.Color(0xc9a67e);
  private readonly clearSkyColor = new THREE.Color(0xffffff);
  private dustFog: THREE.Fog | null = null;
  // P3b-C：WAC EMP 区域反照率层（中远景影像；DTM 装载后创建，SSE 门控显隐）
  private regionalAlbedo: RegionalAlbedoLayer | null = null;
  private drawingBufferSizeTmp: THREE.Vector2 = new THREE.Vector2();

  // 动画与时钟
  private isRunning: boolean = true;
  private animFrameId: number = 0;
  private lastTime: number = 0;
  private simTimeHours: number = 0;
  private timeScale: number = 1.0;
  private isPaused: boolean = false;
  private isBackgroundPaused: boolean = false;
  /** 主引擎渲染帧计数 (animate 实际执行次数；供性能验收区分引擎帧与独立 rAF) */
  private renderFrameCount: number = 0;

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
      const mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> = new THREE.Mesh(
        sphereGeo,
        defaultMat
      );
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

      // S2（Pro 260924）：行星公转轨道线整体移除——真实位置、自转、公转与时间
      // 计算全部保留，只去掉主场景中穿过天体与星空的冗余轨迹示意。

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
        this.marsHaloMesh = haloMesh;

        // S5-6：火星多站点栈注册（原 jezero 单站构建逻辑移至 buildMarsSiteStack；
        // jezero 默认激活，victoria/gale 懒装载）。每站三级栈：DTM 窗网格
        // （HiRISE 2m）+ MOLA L1 区域地形（463m/px）+ 窗缘裙圈 + 挖孔全球球 +
        // 孔底盖板 + 程序碎石场（示意层）。MOLA 不可用时回退两级栈（collar
        // 低清过渡）。数据未就绪前全部保持隐藏——不伪造地形。
        this.marsMesh = mesh;
        this.marsBaseRadius = displayRadius;
        const heightProvider = TerrainHeightProvider.getInstance();
        for (const site of Object.values(LANDING_SITES)) {
          if (site.bodyId !== 'mars') continue;
          const isDefault = site.id === this.activeMarsSiteId;
          const urls = SolarEngine.MARS_SITE_ASSET_URLS[site.id] ?? {};
          const stack: MarsSiteStack = {
            siteId: site.id,
            group: new THREE.Group(),
            dtm: isDefault
              ? JezeroTerrainSource.getInstance()
              : new JezeroTerrainSource(site.id, urls.sourceId ?? `${site.id}-hirise-v1`),
            mola: isDefault ? MolaRegionalSource.getInstance() : new MolaRegionalSource(),
            holedGeometry: null,
            l1Materials: [],
            rockFieldMaterial: null,
            collarMaterial: null,
            loadStarted: false,
            built: false,
          };
          stack.group.name = `mars-site-${site.id}`;
          stack.group.visible = isDefault;
          mesh.add(stack.group);
          this.marsSiteStacks.set(site.id, stack);
          heightProvider.registerMarsRaster(site.id, stack.dtm, isDefault);
          if (isDefault) this.ensureMarsSiteAssets(site.id); // 默认站预载（原行为）
        }
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
      // S5-5：火卫一/二免受火星尘雾浸染——地表尘色雾是近地大气效应，数十 km 外
      // 的火卫不应被洗掉（S4c 已知限制的修复；月面无雾不受影响）
      if (satId === 'phobos' || satId === 'deimos') satMat.fog = false;
      const satMesh = new THREE.Mesh(satGeo, satMat);
      satMesh.userData = { bodyId: satId };
      satMesh.rotation.y = PLANET_SPIN_OFFSETS[satId] || 0;
      satPoleFrame.add(satMesh);
      this.pickableMeshes.push(satMesh);

      if (satId === 'moon') {
        this.moonMesh = satMesh;
        this.moonBaseRadius = satRadius;
        // 异步载入真实 NASA LROC 月球正射反照率贴图
        new THREE.TextureLoader().load('/assets/textures/moon/lroc_color_2k.jpg', (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          satMat.map = tex;
          satMat.needsUpdate = true;
        });

        // S5-3：月面多站点栈注册（原 taurus 单站构建逻辑移至 buildMoonSiteStack；
        // FrontSide 单侧渲染 + 外向绕序的 P1 勘误结论对两站同样适用）
        const heightProvider = TerrainHeightProvider.getInstance();
        for (const site of Object.values(LANDING_SITES)) {
          if (site.bodyId !== 'moon') continue;
          const isDefault = site.id === this.activeMoonSiteId;
          const stack: MoonSiteStack = {
            siteId: site.id,
            group: new THREE.Group(),
            raster: isDefault ? RasterTerrainSource.getInstance() : new RasterTerrainSource(),
            lola: isDefault ? LolaRegionalSource.getInstance() : new LolaRegionalSource(),
            holedGeometry: null,
            lolaMaterials: [],
            rockFieldMaterial: null,
            collarMaterial: null,
            loadStarted: false,
            built: false,
          };
          stack.group.name = `moon-site-${site.id}`;
          stack.group.visible = isDefault;
          satMesh.add(stack.group);
          this.moonSiteStacks.set(site.id, stack);
          heightProvider.registerMoonRaster(site.id, stack.raster, isDefault);
          if (isDefault) this.ensureMoonSiteAssets(site.id); // 默认站预载（原行为）
        }
      }

      // S2（Pro 260924）：卫星公转轨道线随行星轨迹线一并移除（真实星环保留）

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
        this.syncEarthCloudVisibility();
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
        // S1（Pro 260924）：挖孔底盖板同步换装——盖板若仍持旧 satMat（另一套
        // 明暗模型），孔洞区域与四周月面亮度不同 + 深度精度不足时逐帧互抢，
        // 表现为"黑色形状区域闪烁"。共享同一材质实例，明暗恒一致。
        const cap = this.moonHoleCapMesh;
        if (cap) cap.material = this.moonMaterial;
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
        // S4b：火星孔底盖板同步换装（同月面 S1 结论——盖板与本体共享材质实例，
        // 明暗恒一致，避免孔洞区域色差闪烁）
        const cap = this.marsHoleCapMesh;
        if (cap) cap.material = this.marsMaterial;
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
    // P2：用户改选其它天体时收回过期的着陆准备（不自动重发；S4c 按活动站点判）
    if (cmd.type === 'select' && cmd.bodyId !== this.activeLandingBodyId) {
      this.landingController.cancelPreparation();
      this.landingPrep = null;
    }
    // P3b-A：准备期内的任何相机命令（用户导航/改选）使旧自动启动许可失效——
    // 重置准备流水线从当前状态重新走（Pro §8.1；若世界已不可用，step 会收回）
    if (this.landingPrep && this.landingController.getState() === 'PREPARING') {
      this.landingPrep = {
        missionId: this.landingPrep.missionId,
        phase: 'policy',
        userInputRevisionAtStart: this.cameraController.getUserInputRevision(),
      };
    }
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
      // R3-a（260925 审计七）：全景 = 显式导航示意域——物理观察残留（下降/
      // 返轨后未回导航）时恢复 NAV，否则太阳保持物理模式隐藏、全景无太阳
      if (
        cmd.type === 'overview' &&
        this.bodyPoseProvider.getPolicy() === 'PHYSICAL_OBSERVATION' &&
        this.landingController.getState() === 'ORBIT'
      ) {
        this.setPresentationPolicy('NAV_SCHEMATIC');
      }
    } else if (cmd.type === 'select') {
      soundEffects.playClick();
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
   * P3b-A：降落入口权威可用性（HUD 与本 API 共用）。先到达，再降落——
   * 不以"选中月球 + 着陆状态机空闲"冒充到达（Pro P3b 审查 §3.1/§4.1）。
   */
  public getLandingAvailability(): LandingAvailability {
    const ctlState = this.landingController.getState();
    if (ctlState !== 'ORBIT') {
      return { action: 'none', reason: 'mission-active' };
    }
    const camSnap = this.cameraController.getSnapshot();
    if (camSnap.isTransitioning) {
      return { action: 'none', reason: 'travel-in-progress' };
    }
    if (camSnap.mode === 'SURFACE_LOOK') {
      // S4b observe 路径进入的火星地表（控制器空闲）仍发布退出入口；
      // 下降流自身的 SURFACE_LOOK 在上方 ctlState 分支即返回 mission-active
      if (camSnap.targetBodyId === 'mars' || camSnap.selectedBodyId === 'mars') {
        return { action: 'exit-observe', reason: 'mission-active', detail: '耶泽罗地表观察中' };
      }
      return { action: 'none', reason: 'mission-active' };
    }
    // S4c：按相机目标天体解析可下降站点（moon→taurus-littrow，mars→jezero）
    const resolved = this.resolveLandingSiteForCamera(camSnap);
    if (!resolved) {
      return { action: 'none', reason: 'not-at-body' };
    }
    const { bodyId, site } = resolved;
    // 到达判定：相机与天体中心的实际渲染距离（整球取景属可访问——不设公里级门槛
    // 使正常取景失效）。×10 而非几何严格的 ×6：现存 displayRadius(0.368) 与
    // 球体几何/取景半径(0.687) 口径不一致（预存在问题，已登记待专项），
    // 正常 flyTo 取景距离(~2.9)在严格阈值下会被误判为未到达。
    const bodyPose = this.getBodyWorldPose(bodyId);
    const dist = this.camera.position.distanceTo(bodyPose.pos);
    if (dist > bodyPose.surfaceRadius * 10) {
      return { action: 'none', reason: 'not-at-body' };
    }
    // 比例框架：仅在有进行中的过渡时等待（空闲时为 NAV 是正常状态——
    // 切换到 PHYSICAL 由准备流水线负责，不作为入口前置条件）
    if (this.bodyPoseProvider.getTransitionProgress() > 0 && this.bodyPoseProvider.getTransitionProgress() < 1) {
      return { action: 'wait', reason: 'frame-transition', detail: '比例框架过渡中…' };
    }
    // 资产就绪（按天体路由，fail-closed：未就绪等待并展示原因，不伪造地形）
    if (bodyId === 'mars') {
      // S5-6：火星多站——资产状态按解析站点路由；解析命中即幂等预取（懒装载触发点）
      this.ensureMarsSiteAssets(site.id);
      const dtm = this.marsSiteStacks.get(site.id)?.dtm ?? JezeroTerrainSource.getInstance();
      if (dtm.error) {
        return { action: 'wait', reason: 'assets-error', detail: `HiRISE DTM 装载失败：${dtm.error}`, siteId: site.id };
      }
      if (!dtm.isReady) {
        return { action: 'wait', reason: 'assets-loading', detail: '正在装载真实 HiRISE DTM 地形…', siteId: site.id };
      }
    } else {
      // S5-3：月面多站——资产状态按解析站点路由；解析命中即幂等预取（懒装载触发点）
      this.ensureMoonSiteAssets(site.id);
      const raster = this.moonSiteStacks.get(site.id)?.raster ?? RasterTerrainSource.getInstance();
      if (raster.state === 'failed') {
        return { action: 'wait', reason: 'assets-error', detail: `DTM 装载失败：${raster.error ?? '未知原因'}`, siteId: site.id };
      }
      if (!raster.isReady) {
        return { action: 'wait', reason: 'assets-loading', detail: '正在装载真实 DTM 地形…', siteId: site.id };
      }
    }
    // 落区可见性：相机与站点是否同半球（背面 → 前往着陆区，沿球外绕行，不穿球不改起点）
    const rel = this.camera.position.clone().sub(bodyPose.pos).applyQuaternion(bodyPose.quaternion.clone().invert()).normalize();
    const siteDir = latLonDirection(site.centerLat, site.centerLon);
    const dot = rel.x * siteDir[0] + rel.y * siteDir[1] + rel.z * siteDir[2];
    if (dot < 0) {
      return { action: 'travel-to-site', reason: 'far-side-site', detail: '着陆区在天体背面，需先前往着陆区上空', siteId: site.id };
    }
    return { action: 'land', reason: 'ready', siteId: site.id };
  }

  /** P3b-A：前往着陆区上空（球外绕行到达站点同侧；不修改落区与起点） */
  public travelToLandingSite(): void {
    const resolved = this.resolveLandingSiteForCamera(this.cameraController.getSnapshot()) ?? {
      bodyId: this.activeLandingBodyId,
      site: this.activeLandingSite,
    };
    const bodyPose = this.getBodyWorldPose(resolved.bodyId);
    const siteDir = new THREE.Vector3(...latLonDirection(resolved.site.centerLat, resolved.site.centerLon));
    const siteWorld = siteDir.clone().applyQuaternion(bodyPose.quaternion).normalize();
    const dist = this.camera.position.distanceTo(bodyPose.pos);
    const target = bodyPose.pos.clone().addScaledVector(siteWorld, dist);
    this.cameraController.executeCommand({
      type: 'flyTo',
      bodyId: resolved.bodyId,
      durationSec: 2.8,
      targetPos: [target.x, target.y, target.z],
      exact: true,
    });
  }

  /** P3b-A：准备流水线状态（HUD 提示光照调整等信息；startQuat 供验收核对首帧姿态） */
  public getLandingPreparationStatus(): {
    active: boolean;
    phase: 'policy' | 'lighting' | 'capture' | null;
    lightingAdjustedSimHours: number | null;
    startQuat: [number, number, number, number] | null;
  } {
    return {
      active: !!this.landingPrep,
      phase: this.landingPrep?.phase ?? null,
      lightingAdjustedSimHours: this.lastLandingLightingAdjustHours,
      startQuat: this.landingStartQuat
        ? [this.landingStartQuat.x, this.landingStartQuat.y, this.landingStartQuat.z, this.landingStartQuat.w]
        : null,
    };
  }

  /**
   * 启动月球 Taurus–Littrow 真实降落（P3b-A 重构）。
   * 可用性由 getLandingAvailability() 权威判定；不可用直接拒绝且不改变任何世界状态
   * （相机/时间/比例策略）。可用则进入准备流水线（策略过渡 → 光照选时 → 同帧捕获），
   * 完成后由控制器以完整起点（含 q0 提取的 yaw/pitch）开始下降。
   */
  public startLunarLanding(): boolean {
    const avail = this.getLandingAvailability();
    if (avail.action !== 'land') {
      return false; // 入口拒绝：世界状态保持不变（UI 也不应显示可执行入口）
    }
    // S4c：解析目标站点并切换控制器（下降流泛化——月/火同链路）；
    // S5-3：月面多站——同步激活该站表面栈（挖孔球/group/查询路由切换）
    const resolved = this.resolveLandingSiteForCamera(this.cameraController.getSnapshot());
    if (!resolved || !this.landingController.switchSite(resolved.site.id)) {
      return false;
    }
    if (resolved.bodyId === 'moon') {
      this.ensureMoonSiteAssets(resolved.site.id);
      this.activateMoonSite(resolved.site.id);
    }
    // S5-6：火星多站——同步激活该站表面栈（挖孔球/group/查询路由切换）
    if (resolved.bodyId === 'mars') {
      this.ensureMarsSiteAssets(resolved.site.id);
      this.activateMarsSite(resolved.site.id);
    }
    const missionId = ++this.landingMissionId;
    // 旧流程的 select 命令在此触发相机目标切换→updateEphemerisPoses 物理分支以
    // 天体系线性化参考（月面 mesh 按真实比例摆放）。P3b-A 重写时一度删除该命令，
    // 导致物理模式下月面仍按 NAV 半径摆放（实测回归）——保留。
    // 注意顺序：select 必须在 landingPrep 设置之前（executeCameraCommand 的准备期
    // 失效钩子只在 prep 存在时触发）。
    this.cameraController.executeCommand({ type: 'select', bodyId: resolved.bodyId });
    if (this.callbacks.onSelectBody) {
      this.callbacks.onSelectBody(resolved.bodyId);
    }
    this.landingPrep = {
      missionId,
      phase: 'policy',
      userInputRevisionAtStart: this.cameraController.getUserInputRevision(),
    };
    this.lastLandingLightingAdjustHours = null;
    soundEffects.playWarp();
    this.setPresentationPolicy('PHYSICAL_OBSERVATION');
    this.landingController.startDescent();
    return true;
  }

  /**
   * P3b-A：准备流水线（animate 帧驱动，无定时器）。任一步骤前检查用户输入与世界状态：
   * 用户在准备期操作相机 → 旧许可失效，从当前状态重新准备（保持缓存，不回拉机位）；
   * 世界变化导致不再可用 → 收回准备。全部就绪后同帧捕获完整起点并开始下降。
   */
  private stepLandingPreparation(): void {
    const prep = this.landingPrep;
    if (!prep) {
      // 无引擎准备上下文（如外部直接调用控制器）时收回，避免卡死在 PREPARING
      this.landingController.cancelPreparation();
      return;
    }
    // 用户输入 → 许可失效，重新准备（Pro §4.1/§8.1：重新从当前机位准备，不回拉）
    if (this.cameraController.getUserInputRevision() !== prep.userInputRevisionAtStart) {
      this.landingPrep = {
        missionId: prep.missionId,
        phase: 'policy',
        userInputRevisionAtStart: this.cameraController.getUserInputRevision(),
      };
      return;
    }
    // 世界变化导致不可用（选了别的天体/开始导航飞行）→ 收回。
    // 注意 1：不能直接调 getLandingAvailability()——PREPARING 本身会被它判为 mission-active
    // 形成自灭回环；此处只查真实的失效条件。
    // 注意 2：不做距离守卫——策略过渡期月球场面位置/尺度瞬变、相机跟随滞后，
    // 距离瞬时超限会被误杀（实测）；用户飞离必然伴随 isTransitioning，已被覆盖。
    const camSnap = this.cameraController.getSnapshot();
    if (camSnap.isTransitioning) {
      this.landingPrep = null;
      this.landingController.cancelPreparation();
      return;
    }
    if (camSnap.targetBodyId !== this.activeLandingBodyId && camSnap.selectedBodyId !== this.activeLandingBodyId) {
      this.landingPrep = null;
      this.landingController.cancelPreparation();
      return;
    }

    if (prep.phase === 'policy') {
      if (this.bodyPoseProvider.getPolicy() !== 'PHYSICAL_OBSERVATION') {
        this.setPresentationPolicy('PHYSICAL_OBSERVATION');
        return;
      }
      if (this.bodyPoseProvider.getTransitionProgress() < 1) return; // 等待过渡完成（帧驱动）
      prep.phase = 'lighting';
      return;
    }
    if (prep.phase === 'lighting') {
      // 光照选时前置到准备阶段（用户已批准的推荐白昼取舍）；此后下降过程不再改时间。
      const before = this.simTimeHours;
      this.ensureLandingLighting(this.activeLandingBodyId, this.activeLandingSite.id);
      if (Math.abs(this.simTimeHours - before) > 1e-9) {
        this.lastLandingLightingAdjustHours = this.simTimeHours;
        this.emitSnapshot();
      }
      prep.phase = 'capture';
      return;
    }
    if (prep.phase === 'capture') {
      // 资源门槛（按天体路由的 DTM ready + 站点 measured-dem）——就绪前不捕获不开始
      const site = this.activeLandingSite;
      const hp = TerrainHeightProvider.getInstance();
      const dataReady = this.activeLandingBodyId === 'mars'
        ? (this.marsSiteStacks.get(site.id)?.dtm ?? JezeroTerrainSource.getInstance()).isReady // S5-6：按站点路由
        : hp.isRasterReady;
      if (!dataReady || hp.getHeightSample(this.activeLandingBodyId, site.centerLat, site.centerLon).fidelity !== 'measured-dem') {
        return;
      }
      // 同帧完整起点：位置（地面投射 + 基准面净空 H）+ 姿态 q0 四元数（含滚转）。
      // P3b-B：clearance 一律 datum 口径（不扣地面高程）——规划无 DTM 窗口基准跳变；
      // 姿态导引在引擎侧以角速率受限收敛（见 animate DESCENDING 分支），不再传 yaw/pitch。
      const groundPose = this.computeGroundPose(this.activeLandingBodyId);
      this.landingStartQuat = this.camera.quaternion.clone();
      this.landingGuidedQuat = this.camera.quaternion.clone();
      this.landingGuideActive = true;
      this.landingUserRevAtDescend = this.cameraController.getUserInputRevision();
      try {
        this.landingPrep = null;
        this.landingController.completePreparation(
          () => this.timeScale,
          (scale) => this.setTimeScale(scale),
          {
            latDeg: groundPose.latDeg,
            lonDeg: groundPose.lonDeg,
            clearanceM: Math.max(2, groundPose.clearanceM),
          }
        );
      } catch (err) {
        // 对跖等路径能力上限：拒绝启动（Pro §3.2——不修改起点规避）
        console.error('[SolarEngine] 下降起点路径不可解，已取消准备：', err);
        this.landingController.cancelPreparation();
      }
    }
  }

  /**
   * P3b-A：按站点局部基 (u/e/n) 与 yaw/pitch 构造 SURFACE_LOOK 目标四元数
   * （与 CameraController.updateCameraTransform 的 yaw/pitch 重建公式一致）。
   */
  private buildSurfaceLookQuaternion(
    latDeg: number,
    lonDeg: number,
    yawDeg: number,
    pitchDeg: number
  ): THREE.Quaternion {
    const moonPose = this.getBodyWorldPose(this.activeLandingBodyId);
    const latRad = THREE.MathUtils.degToRad(latDeg);
    const lonRad = THREE.MathUtils.degToRad(lonDeg);
    const cosLat = Math.cos(latRad);
    const u = new THREE.Vector3(cosLat * Math.cos(lonRad), Math.sin(latRad), -cosLat * Math.sin(lonRad)).normalize();
    const e = new THREE.Vector3(-Math.sin(lonRad), 0, -Math.cos(lonRad)).normalize();
    const n = new THREE.Vector3().crossVectors(u, e).normalize();
    const uW = u.applyQuaternion(moonPose.quaternion).normalize();
    const eW = e.applyQuaternion(moonPose.quaternion).normalize();
    const nW = n.applyQuaternion(moonPose.quaternion).normalize();
    const yawRad = THREE.MathUtils.degToRad(yawDeg);
    const pitchRad = THREE.MathUtils.degToRad(pitchDeg);
    const forward = new THREE.Vector3().addScaledVector(nW, Math.cos(yawRad)).addScaledVector(eW, Math.sin(yawRad)).normalize();
    const lookDir = new THREE.Vector3().addScaledVector(forward, Math.cos(pitchRad)).addScaledVector(uW, Math.sin(pitchRad)).normalize();
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), lookDir, uW);
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }

  /**
   * P3b-A：从当前相机实际四元数提取起点局部基 (u/e/n) 的 yaw/pitch。
   * 与 CameraController.updateCameraTransform 的表面姿态公式严格互逆：
   * forward = n·cos(yaw) + e·sin(yaw)；lookDir = forward·cos(pitch) + u·sin(pitch)
   * → yaw = atan2(f·e, f·n)，pitch = asin(f·u)。
   */
  private extractMoonSurfaceOrientation(latDeg: number, lonDeg: number): { yawDeg: number; pitchDeg: number } {
    const moonPose = this.getBodyWorldPose(this.activeLandingBodyId);
    const latRad = THREE.MathUtils.degToRad(latDeg);
    const lonRad = THREE.MathUtils.degToRad(lonDeg);
    const cosLat = Math.cos(latRad);
    const u = new THREE.Vector3(cosLat * Math.cos(lonRad), Math.sin(latRad), -cosLat * Math.sin(lonRad)).normalize();
    const e = new THREE.Vector3(-Math.sin(lonRad), 0, -Math.cos(lonRad)).normalize();
    const n = new THREE.Vector3().crossVectors(u, e).normalize();
    const uW = u.applyQuaternion(moonPose.quaternion).normalize();
    const eW = e.applyQuaternion(moonPose.quaternion).normalize();
    const nW = n.applyQuaternion(moonPose.quaternion).normalize();
    const f = new THREE.Vector3();
    this.camera.getWorldDirection(f);
    const pitchDeg = THREE.MathUtils.radToDeg(Math.asin(Math.max(-1, Math.min(1, f.dot(uW)))));
    const yawDeg = THREE.MathUtils.radToDeg(Math.atan2(f.dot(eW), f.dot(nW)));
    return {
      yawDeg: ((yawDeg % 360) + 360) % 360,
      pitchDeg: Math.max(-85, Math.min(85, pitchDeg)),
    };
  }

  /**
   * P3-T4：确保下降时刻站点有光照。仰角必须与渲染同源——直接读 getBodyWorldPose
   * （网格世界四元数 + 渲染太阳位置）：此前用物理系 API 选时与渲染系不一致，
   * 选出的"白昼"实测是月夜（168.08h 渲染仰角 −17.2°）。扫描采用临时推进
   * simTimeHours + updateEphemerisPoses(0) 的实测法（focusEarthRegion 同款），
   * 结束时一次性落到选定时刻。当前已在 [12°,45°] 则不调整。
   */
  private ensureLandingLighting(bodyId: BodyId = 'moon', siteId: string = 'taurus-littrow'): void {
    const site = LANDING_SITES[siteId];
    const siteLocal = new THREE.Vector3(...latLonDirection(site.centerLat, site.centerLon));
    const elevationNow = (): number => {
      const body = this.getBodyWorldPose(bodyId);
      const sun = this.getBodyWorldPose('sun');
      const sunDir = new THREE.Vector3().subVectors(sun.pos, body.pos).normalize();
      const siteWorld = siteLocal.clone().applyQuaternion(body.quaternion);
      const d = siteWorld.dot(sunDir);
      return (Math.asin(Math.max(-1, Math.min(1, d))) * 180) / Math.PI;
    };
    const cur = elevationNow();
    if (cur >= 12 && cur <= 45) return;

    const original = this.simTimeHours;
    let bestT: number | null = null;
    let bestScore = Infinity;
    for (let t = original + 4; t < original + 720; t += 4) {
      this.simTimeHours = t; // 扫描期直接写字段，避免逐次触发时刻回调
      this.updateEphemerisPoses(0);
      const e = elevationNow();
      if (e >= 12 && e <= 45) {
        const score = Math.abs(e - 28);
        if (score < bestScore) {
          bestScore = score;
          bestT = t;
        }
      }
    }
    this.setSimTimeHours(bestT != null ? bestT : original);
    this.updateEphemerisPoses(0);
  }

  /**
   * 当前相机在天体 body-fixed 系下的地面投射与净空（用于下降起点连续）。
   * P3b-B：clearanceM 为基准面净空 H =（镜头到天体中心距离 − 基准球半径），不扣地面
   * 高程——单腿以 datum 规划，跨 DTM 窗口边界无基准跳变（Pro §3.4）。
   * S4c：按天体参数化（datum 取活动站点契约值；行星无逐帧缩放，卫星取世界有效半径）。
   */
  private computeGroundPose(bodyId: BodyId): { latDeg: number; lonDeg: number; clearanceM: number } {
    const bodyPose = this.getBodyWorldPose(bodyId);
    const site = this.activeLandingSite;
    const rel = this.camera.position.clone().sub(bodyPose.pos);
    const local = rel.applyQuaternion(bodyPose.quaternion.clone().invert());
    const len = local.length();
    if (len < 1e-9) {
      return { latDeg: site.centerLat, lonDeg: site.centerLon, clearanceM: 50000 };
    }
    const latDeg = THREE.MathUtils.radToDeg(Math.asin(Math.max(-1, Math.min(1, local.y / len))));
    const lonDeg = THREE.MathUtils.radToDeg(Math.atan2(-local.z, local.x));

    const datumM = site.datumRadiusKm * 1000;
    const node = this.bodyNodes.get(bodyId);
    // 场景单位 → 米：物理观察下卫星 mesh 被缩放，取 mesh 世界有效半径；行星恒 scale 1
    const sceneRadius =
      node && node.mesh ? node.displayRadius * node.mesh.scale.x : bodyPose.surfaceRadius;
    const metersPerScene = sceneRadius > 0 ? datumM / sceneRadius : datumM / 1;
    const datumClearanceM = (len - sceneRadius) * metersPerScene;
    return { latDeg, lonDeg, clearanceM: datumClearanceM };
  }

  public pauseLanding(): void {
    this.landingController.holdDescent();
  }

  public resumeLanding(): void {
    this.landingController.resumeDescent();
  }

  /** P3b-B（Pro §8.2）：恢复导引视线——从用户当前画面以角速率受限方式重新收敛（无 SNAP） */
  public requestLandingReguide(): void {
    const st = this.landingController.getState();
    if (st !== 'HOLD' && st !== 'DESCENDING') return;
    this.landingGuidedQuat = this.camera.quaternion.clone();
    this.landingGuideActive = true;
    this.landingUserRevAtDescend = this.cameraController.getUserInputRevision();
  }

  public returnToLunarOrbit(): void {
    // P3b-B（Pro §8.5）：升空导引从当前实际画面出发（速率受限收敛），不倒放
    this.landingGuidedQuat = this.camera.quaternion.clone();
    this.landingGuideActive = true;
    this.landingController.returnToOrbit();
  }

  /**
   * P3b-B：单帧下降/升空画面（Pro §3.4/§5）。
   * 位置：基准高 H 连续——相机相对基准球高度恒为规划值，眼高按局部高程与站点
   * 高程加权（w=smoothstep 于站点上空 500m..3km 频带），跨 DTM 窗口边界无基准跳变。
   * 姿态：地平线投影目标（δ 俯角钉在画面 u=0.32 行，实际 FOV）+ 角速率受限收敛
   * （4–10°/s 比例律），替代 12s 开环混合——任何起点姿态无 SNAP 接入。
   * positionFrozen=true（HOLD 恢复导引）：轨迹冻结，仅姿态收敛，收敛完自动停发。
   */
  private applyLandingFrame(deltaSec: number, positionFrozen: boolean): void {
    const traj = this.landingController.evaluateTrajectory();
    const site = this.activeLandingSite;
    const hp = TerrainHeightProvider.getInstance();

    const elevHere = hp.getHeightMeters(this.activeLandingBodyId, traj.lat, traj.lon);
    const band = traj.datumAltitudeM - site.elevationDatumOffsetM;
    const w = smootherstep(Math.max(0, Math.min(1, (band - 500) / 2500)));
    const eyeHeightM = Math.max(
      0.5,
      (1 - w) * (traj.datumAltitudeM - elevHere) + w * (traj.datumAltitudeM - site.elevationDatumOffsetM)
    );

    let orientationQuat: [number, number, number, number] | undefined;
    if (this.landingGuideActive && this.landingGuidedQuat) {
      const radiusM = site.datumRadiusKm * 1000;
      const dip = horizonDip(radiusM, Math.max(0, traj.datumAltitudeM));
      const pitchGoalDeg = THREE.MathUtils.clamp(
        THREE.MathUtils.radToDeg(
          pitchForHorizonElevation(-dip, THREE.MathUtils.degToRad(this.camera.fov), 0.32)
        ),
        -85,
        85
      );
      const qTarget = this.buildSurfaceLookQuaternion(traj.lat, traj.lon, traj.tangentHeadingDeg, pitchGoalDeg);
      const cur: [number, number, number, number] = [
        this.landingGuidedQuat.x,
        this.landingGuidedQuat.y,
        this.landingGuidedQuat.z,
        this.landingGuidedQuat.w,
      ];
      const tgt: [number, number, number, number] = [qTarget.x, qTarget.y, qTarget.z, qTarget.w];
      const remaining = quatAngle(cur, tgt);
      const rate = Math.max(
        THREE.MathUtils.degToRad(4),
        Math.min(THREE.MathUtils.degToRad(10), remaining / 2)
      );
      const stepped = stepOrientationQuat(cur, tgt, deltaSec, rate);
      this.landingGuidedQuat.set(stepped[0], stepped[1], stepped[2], stepped[3]);
      orientationQuat = stepped;
      if (positionFrozen && quatAngle(stepped, tgt) < THREE.MathUtils.degToRad(0.05)) {
        this.landingGuideActive = false; // HOLD 导引收敛完成：停发命令，相机交还用户
      }
    }

    this.cameraController.executeCommand({
      type: 'enterSurfaceLook',
      bodyId: this.activeLandingBodyId,
      lat: traj.lat,
      lon: traj.lon,
      eyeHeightM,
      ...(orientationQuat ? { orientationQuat } : {}),
    });
  }

  public lookAtEarthFromMoon(): void {
    this.cameraController.executeCommand({
      type: 'lookAtSkyTarget',
      targetBodyId: 'earth',
    });
  }

  /**
   * S4b：进入耶泽罗地表观察（火星第一站，v1）。与月面下降不同：无导引轨迹/
   * 悬停/升空状态机——直达站点 1.7m 人眼视高原地观察。光照同月面规则选时
   * （站点白昼 12°–45° 仰角）；比例框架切物理观察（火星为参考天体）。
   */
  public startJezeroSurfaceObserve(): boolean {
    const avail = this.getLandingAvailability();
    if (avail.action !== 'observe') {
      return false; // 入口拒绝：世界状态保持不变
    }
    const site = LANDING_SITES['jezero'];
    this.cameraController.executeCommand({ type: 'select', bodyId: 'mars' });
    if (this.callbacks.onSelectBody) {
      this.callbacks.onSelectBody('mars');
    }
    this.setPresentationPolicy('PHYSICAL_OBSERVATION');
    this.ensureLandingLighting('mars', 'jezero');
    soundEffects.playWarp();
    this.cameraController.executeCommand({
      type: 'enterSurfaceLook',
      bodyId: 'mars',
      lat: site.centerLat,
      lon: site.centerLon,
      eyeHeightM: 1.7,
      // 朝东南平视——毅力号着陆点在站点东南 ~894m（坑底缓坡开阔方向）
      initialYawDeg: 115,
      initialPitchDeg: 2,
    });
    return true;
  }

  /** S4b：退出火星地表观察——从当前机位连续飞回火星轨道取景 */
  public exitJezeroSurfaceObserve(): void {
    const snap = this.cameraController.getSnapshot();
    if (snap.mode !== 'SURFACE_LOOK') return;
    this.cameraController.executeCommand({
      type: 'flyTo',
      bodyId: 'mars',
      durationSec: 2.5,
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

  /** S4b：耶泽罗火星地表网格（探针/验收用；数据就绪前 undefined-safe） */
  public getMarsTerrainMesh(): THREE.Mesh | undefined {
    return this.marsTerrainMesh;
  }

  /**
   * R1（260925 基础体验恢复）：统一完整帧渲染入口——实时主循环、截图与
   * 明信片共用本方法，画面由同一条管线产生（审计：探针曾用单遍
   * renderer.render 另画一张图，验收与实机不是同一管线）。
   *
   * 分层条件（审计修复）：仅当相机贴近锚定天体（距其中心 < 1.5×当前世界
   * 有效半径——SURFACE_LOOK/下降近段）才分远/近两 pass，且两 pass 之间
   * clearDepth：不同 near 的投影深度数值不可比，也不得混合比较（改前近
   * pass 不清深度，普通浏览即出现黑片/穿插）。贴近表面时锚定系统几何必然
   * 整体位于其他天体之前（其他天体 ≥ 轨道距离），先远后近+清深度的语义
   * 成立。普通轨道浏览恒单 pass 一致投影——月球在地球前方就由深度测试
   * 天然正确遮挡，不按"目标名称"分层（改前按锚定分组，普通浏览下分组
   * 本身即错误）。载具恒在近 pass；全部暂改状态 finally 恢复。
   */
  private farCamera: THREE.PerspectiveCamera | null = null;
  /** 上一帧分层诊断（探针/验收读取：触发条件与远近深度区间） */
  public lastFrameRenderInfo: {
    layered: boolean;
    anchorBodyId: BodyId | null;
    anchorDistOverRadius: number;
    farNearPlane: number | null;
  } = { layered: false, anchorBodyId: null, anchorDistOverRadius: Infinity, farNearPlane: null };

  public renderFrame(): void {
    const snap = this.cameraController.getSnapshot();
    const anchorBodyId: BodyId | null =
      snap.anchor?.kind === 'surface'
        ? snap.anchor.bodyId
        : snap.targetBodyId ?? null;

    // 世界有效半径（卫星物理过渡随 mesh.scale 插值；行星恒 scale 1——
    // 与 computeGroundPose 同口径，不用初始导航半径估深度边界）
    const worldRadiusOf = (node: BodyRenderNode): number => {
      const s = node.mesh.scale.x;
      return node.displayRadius * (Number.isFinite(s) && s > 0 ? s : 1);
    };

    const anchorNode = anchorBodyId ? this.bodyNodes.get(anchorBodyId) : undefined;
    let anchorDistOverRadius = Infinity;
    if (anchorNode) {
      const wp = new THREE.Vector3();
      anchorNode.mesh.getWorldPosition(wp);
      const r = worldRadiusOf(anchorNode);
      if (r > 0) anchorDistOverRadius = this.camera.position.distanceTo(wp) / r;
    }
    const layered = anchorDistOverRadius < 1.5;

    if (!layered) {
      this.lastFrameRenderInfo = {
        layered: false, anchorBodyId, anchorDistOverRadius, farNearPlane: null,
      };
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // ---- 近表面双 pass：远（星空+非锚定天体）→ clearDepth → 近（锚定+载具） ----
    // 只统计实际参与渲染的远层天体（物理观察下被隐藏的系统不进深度边界估计）
    const farVisible: BodyRenderNode[] = [];
    let minFarDist = Infinity;
    for (const [id, node] of this.bodyNodes) {
      if (id === anchorBodyId || !node.systemGroup.visible) continue;
      const wp = new THREE.Vector3();
      node.systemGroup.getWorldPosition(wp);
      minFarDist = Math.min(minFarDist, this.camera.position.distanceTo(wp) - worldRadiusOf(node));
      farVisible.push(node);
    }

    if (!farVisible.length || !Number.isFinite(minFarDist) || minFarDist <= 0.01) {
      // 无远天体或锚定异常：退回单 pass
      this.lastFrameRenderInfo = {
        layered: false, anchorBodyId, anchorDistOverRadius, farNearPlane: null,
      };
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (!this.farCamera) {
      this.farCamera = new THREE.PerspectiveCamera(this.camera.fov, this.camera.aspect, 0.1, this.camera.far);
    }
    const fc = this.farCamera;
    fc.fov = this.camera.fov;
    fc.aspect = this.camera.aspect;
    fc.near = Math.max(0.01, minFarDist * 0.5);
    fc.far = this.camera.far;
    fc.position.copy(this.camera.position);
    fc.quaternion.copy(this.camera.quaternion);
    fc.updateProjectionMatrix();
    fc.updateMatrixWorld();

    const prevAutoClear = this.renderer.autoClear;
    const vehicleOnCamera = !!(this.currentVehicleMesh && this.vehicleGroup.parent === this.camera);
    const hiddenPoles: BodyRenderNode[] = [];
    this.renderer.autoClear = false;
    try {
      // 远 pass：锚定系统与载具暂隐（结束即恢复——载具必须在近 pass 有机会绘制，
      // 改前两遍都隐藏导致贴相机载具整帧消失）
      for (const n of this.bodyNodes.values()) {
        if (n === anchorNode) {
          n.poleFrame.visible = false;
          hiddenPoles.push(n);
        }
      }
      if (vehicleOnCamera) this.currentVehicleMesh!.visible = false;
      this.renderer.clear(true, true, true);
      this.renderer.render(this.scene, fc);
      for (const n of hiddenPoles) n.poleFrame.visible = true;
      if (vehicleOnCamera) this.currentVehicleMesh!.visible = true;

      // 近 pass：清深度后绘制锚定系统——"锚定几何整体在远层之前"由贴面
      // 前提保证；地形正确遮挡星空与远方天体（月面看地球方向不受影响）
      this.renderer.clearDepth();
      for (const n of farVisible) {
        n.poleFrame.visible = false;
        hiddenPoles.push(n);
      }
      this.renderer.render(this.scene, this.camera);
    } finally {
      for (const n of hiddenPoles) n.poleFrame.visible = true;
      this.renderer.autoClear = prevAutoClear;
    }

    this.lastFrameRenderInfo = {
      layered: true, anchorBodyId, anchorDistOverRadius, farNearPlane: fc.near,
    };
  }

  /** 兼容旧内部名（animate 主循环调用） */
  private renderLayered(): void {
    this.renderFrame();
  }

  /** P3b-C：WAC 区域反照率层诊断（验收脚本/HUD 用，只读） */
  public getRegionalAlbedoStatus(): {
    ready: boolean;
    error: string | null;
    gate: { layerTexelPx: number; baseTexelPx: number; visible: boolean } | null;
    provenance: {
      layerId: string;
      sourceProduct: string;
      nativeSpacingMeters: number;
      bounds: { lonMin: number; lonMax: number; latMin: number; latMax: number };
    } | null;
    meshVisible: boolean | null;
    collarSwapped: boolean | null;
    l1TerrainAttached: boolean;
    wacStagedOnL1: boolean;
  } {
    const layer = this.regionalAlbedo;
    if (!layer) {
      return { ready: false, error: null, gate: null, provenance: null, meshVisible: null, collarSwapped: null, l1TerrainAttached: false, wacStagedOnL1: false };
    }
    const mesh = this.getMoonMesh()?.children.find((c) => c.name === 'wac-emp-regional-albedo');
    const collar = this.getMoonMesh()?.children.find((c) => c.name === 'taurus-littrow-collar') as THREE.Mesh | undefined;
    return {
      ready: layer.isReady,
      error: layer.error,
      gate: layer.lastGateDiagnostics,
      provenance: layer.provenance
        ? {
            layerId: layer.provenance.layerId,
            sourceProduct: layer.provenance.sourceProduct,
            nativeSpacingMeters: layer.provenance.nativeSpacingMeters,
            bounds: layer.provenance.bounds,
          }
        : null,
      meshVisible: mesh ? mesh.visible : null,
      // P3-T5：L1 模式下"换装"语义 = L1 表面材质已由 2K 全球图换为 WAC
      //（同源影像、同一 UV 裁剪变换）；两级栈回退时沿用 NAC 裙边网格判定
      collarSwapped: this.lolaMaterial
        ? this.lolaMaterial.map?.image?.width === layer.provenance?.width
        : collar
          ? !!collar.material &&
            (collar.material as THREE.MeshStandardMaterial).map?.image?.width === layer.provenance?.width
          : null,
      l1TerrainAttached: !!this.getMoonMesh()?.getObjectByName('lola-l1-regional-terrain'),
      wacStagedOnL1: !!this.lolaWacTexture,
    };
  }

  public setShowClouds(show: boolean): void {
    this.showClouds = show;
    this.syncEarthCloudVisibility();
  }

  /**
   * 云层可见性唯一仲裁：用户云层开关与观察模式共同决定
   * 物理观测尊重用户图层选择；地貌观察强制隐藏；切回物理时恢复用户选择（P0-b 规范）
   */
  private syncEarthCloudVisibility(): void {
    const earthNode = this.bodyNodes.get('earth');
    if (earthNode && earthNode.cloudMesh) {
      earthNode.cloudMesh.visible = this.showClouds && this.observationMode === 'physical';
    }
  }

  /** 环境光基线三态（观察/伴飞/教学光）——updateLightingState 与火星尘雾补偿共用 */
  private ambientBaselineIntensity(): number {
    if (this.viewCameraMode === 'PLANET_OBSERVE') {
      return this.teachingLight ? 0.75 : 0.22;
    }
    return 0.35;
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
   * S2（Pro 260924）：主场景公转轨迹线已整体移除（真实位置/自转/公转/时间计算
   * 全保留）。setShowOrbits 保留为惰性兼容入口——旧设置与书签恢复不会报错，
   * 也不再重新创建任何轨迹线。
   */
  public setShowOrbits(_show: boolean): void {
    void _show;
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

  /**
   * R1：即时渲染（明信片/截图等）——与实时主循环同一完整帧入口
   * （renderFrame），不再单独走单遍渲染产生另一条管线的画面。
   */
  public renderImmediate(): void {
    this.renderFrame();
  }

  /**
   * S4c：火星地表尘色大气（示意层）。激活条件 = 火星 SURFACE_LOOK 或火星下降
   * 任务进行中；指数平滑淡入淡出（跨态过渡无跳变）。天空 = 星图纹理乘尘色
   * （MeshBasicMaterial.color 浸染，星星被洗入尘色背景）；地面 = 线性雾
   * （Standard 材质，600m 起 / ~9km 全雾——地平线 3.4km 处明显尘化）。
   * 退出火星地表即渐变回纯黑星空（月面语义不受影响）。
   */
  private updateMarsDustAtmosphere(deltaSec: number): void {
    const snap = this.cameraController.getSnapshot();
    const marsGround =
      (snap.mode === 'SURFACE_LOOK' && (snap.targetBodyId === 'mars' || snap.selectedBodyId === 'mars')) ||
      (this.landingController.getState() !== 'ORBIT' && this.activeLandingBodyId === 'mars');
    const target = marsGround ? 1 : 0;
    this.dustSkyMix += (target - this.dustSkyMix) * Math.min(1, deltaSec * 1.6);
    const mix = this.dustSkyMix;

    // S5-6b：地表环境光补偿（展示层，物理依据=尘雾天空的间接漫射光）。火星有
    // 大气散射，逆光/背光面由亮黄褐天空获得可观间接照明——Gale 触地逆光构图下
    // 岩塔背光面曾呈死黑（ambient 0.22×暗反照率在 ACES 下≈0）。随尘雾混入把
    // 环境光升至基线+0.20；月面无大气保持纯直射对比不受影响。每帧重算基线，
    // 教学光/伴飞模式切换后自动重对齐
    this.ambientLight.intensity = this.ambientBaselineIntensity() + 0.2 * mix;

    if (this.skyboxMesh) {
      const mat = this.skyboxMesh.material as THREE.MeshBasicMaterial;
      mat.color.copy(this.clearSkyColor).lerp(this.marsDustColor, mix);
    }
    if (mix > 0.02) {
      const marsPose = this.getBodyWorldPose('mars');
      // S5-6：datum 按激活站产品局部球（未装载站 fallback jezero 静态值）
      const marsDatumM = this.marsSiteStacks.get(this.activeMarsSiteId)?.dtm.datumRadius
        ?? JezeroTerrainSource.DATUM_RADIUS_M;
      const metersPerScene = marsDatumM / Math.max(1e-9, marsPose.surfaceRadius);
      if (!this.dustFog) {
        this.dustFog = new THREE.Fog(this.marsDustColor.getHex());
      }
      this.dustFog.color.copy(this.marsDustColor);
      // S5-1 勘误：near/far 为视空间场景单位——米须除以 metersPerScene
      // （原 600*metersPerScene=2.1e9 场景单位，雾从未实际生效，仅天穹浸染起效）
      this.dustFog.near = 600 / metersPerScene;
      this.dustFog.far = (9000 / metersPerScene) / Math.max(0.4, mix); // 淡入期雾拉远，避免突变
      this.scene.fog = this.dustFog;
    } else if (this.dustFog && this.scene.fog === this.dustFog) {
      this.scene.fog = null;
    }

    // S5-1：大气光晕是轨道视角资产（行星边缘菲涅尔辉光）。地表视角相机在
    // 1.015R 壳内，BackSide 壳反而包裹整个视野——自定义 shader 内视输出垃圾
    // （暗楔形+整体压暗）。地表/下降期隐藏，尘色天空由天穹浸染+雾接管；
    // 恢复时尊重用户大气显示开关。
    if (this.marsHaloMesh) {
      this.marsHaloMesh.visible = marsGround ? false : this.showAtmosphere;
    }
  }

  /**
   * S5-1：地表视角曝光补偿（展示层）。ACES 色调映射在低太阳仰角+暗反照率
   * 纹理（耶泽罗玄武岩质地表 ~0.25）下把触地画面压暗 2-3 档（实测地面像素
   * ~71/255）。SURFACE_LOOK（及 <50km 下降段——地表已充满视野）把
   * toneMappingExposure 从基线 1.1 平滑升至 ~2.8，返轨/升空平滑回落。
   * 只调显示曝光，不改动光照物理量与数据。
   */
  private updateSurfaceExposure(deltaSec: number): void {
    const snap = this.cameraController.getSnapshot();
    let active = snap.mode === 'SURFACE_LOOK';
    if (!active) {
      const st = this.landingController.getState();
      if (st === 'DESCENDING' || st === 'HOLD') {
        active = this.landingController.evaluateTrajectory().datumAltitudeM < 50000;
      }
    }
    const target = active ? 1 : 0;
    this.surfaceExposureMix += (target - this.surfaceExposureMix) * Math.min(1, deltaSec * 0.8);
    const exposure = 1.1 * (1 + 1.55 * this.surfaceExposureMix); // 1.1 → ≈2.8
    if (Math.abs(this.renderer.toneMappingExposure - exposure) > 1e-4) {
      this.renderer.toneMappingExposure = exposure;
    }
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
    this.renderFrameCount++;

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

    // S4c：火星地表尘色大气（示意层，见字段注释）；月面/轨道不受影响
    this.updateMarsDustAtmosphere(deltaSec);
    this.updateSurfaceExposure(deltaSec);

    // 着陆控制器生命周期驱动（R5 建立，P2 重写下降段，P3b-B 单腿连续轨迹 + 地平线投影姿态）
    // P1 修复：仅在本控制器刚刚完成"升空返轨"(ASCENDING -> ORBIT 边沿)时才收回 SURFACE_LOOK；
    // 书签恢复等外部进入的地表观察不被空闲的着陆状态机逐帧抢占 (用户保有控制权)
    const landingState = this.landingController.getState();
    const userRev = this.cameraController.getUserInputRevision();
    if (landingState === 'PREPARING' || landingState === 'DESCENDING' || landingState === 'ASCENDING') {
      this.landingController.update(deltaSec, (s) => this.setTimeScale(s));
      if (landingState === 'PREPARING') {
        // P3b-A：准备流水线（策略过渡 → 光照选时 → 同帧捕获），帧驱动无定时器
        this.stepLandingPreparation();
      } else if (landingState === 'DESCENDING') {
        // B3（Pro §8.3）：任何用户视角输入立即打断进 HOLD——以 userInputRevision
        // 为权威（拖拽/滚轮已各自兜底，此处覆盖其余输入路径）
        if (this.prevLandingState !== 'DESCENDING') {
          this.landingUserRevAtDescend = userRev;
        } else if (userRev !== this.landingUserRevAtDescend) {
          this.landingGuideActive = false;
          this.landingController.holdDescent();
        } else {
          this.applyLandingFrame(deltaSec, false);
        }
      } else if (landingState === 'ASCENDING') {
        // 升空同样可被用户打断视线（不冻结爬升，只交出姿态）
        if (this.prevLandingState !== 'ASCENDING') {
          this.landingUserRevAtDescend = userRev;
        } else if (userRev !== this.landingUserRevAtDescend) {
          this.landingGuideActive = false;
        }
        this.applyLandingFrame(deltaSec, false);
      }
    } else if (landingState === 'HOLD') {
      // B3：悬停时相机在冻结锚点上自由环顾——把实际视线同步进遥测（HUD 如实显示）
      const holdTraj = this.landingController.evaluateTrajectory();
      const holdOrientation = this.extractMoonSurfaceOrientation(holdTraj.lat, holdTraj.lon);
      this.landingController.setSurfaceOrientation(holdOrientation.yawDeg, holdOrientation.pitchDeg);
      // 用户按"恢复导引视线"后仅收敛姿态，收敛完成或用户再次转头即停（不与用户争抢相机）
      if (this.landingGuideActive && this.landingGuidedQuat) {
        if (userRev !== this.landingUserRevAtDescend) {
          this.landingGuideActive = false;
        } else {
          this.applyLandingFrame(deltaSec, true);
        }
      }
    } else if (
      landingState === 'ORBIT' &&
      this.prevLandingState === 'ASCENDING' &&
      this.cameraController.getSnapshot().mode === 'SURFACE_LOOK'
    ) {
      this.cameraController.executeCommand({
        type: 'flyTo',
        bodyId: this.activeLandingBodyId,
        durationSec: 1.5,
      });
    }
    if (landingState === 'SURFACE_LOOK' && this.prevLandingState === 'DESCENDING') {
      // B2（Pro §5.5）：接地边沿——从最终画面提取实际视线写入姿态基。
      // 不回填默认 225°/12°：SURFACE_LOOK 渲染基与下降末帧视线一致，无 SNAP。
      const site = this.activeLandingSite;
      const orientation = this.extractMoonSurfaceOrientation(site.centerLat, site.centerLon);
      this.landingController.setSurfaceOrientation(orientation.yawDeg, orientation.pitchDeg);
      this.cameraController.executeCommand({
        type: 'setSurfaceLook',
        yawDeg: orientation.yawDeg,
        pitchDeg: orientation.pitchDeg,
      });
      this.landingGuideActive = false;
    }
    this.prevLandingState = landingState;
    if (landingState !== 'PREPARING' && this.landingPrep) {
      // 准备被取消（HUD 取消按钮等）或已开始下降：清理引擎侧准备上下文，
      // 旧 missionId 的任何残留状态不再生效（Pro §8.6）
      this.landingPrep = null;
    }
    if (landingState === 'ORBIT') {
      this.landingStartQuat = null; // 任务结束/取消：起始四元数失效
      this.landingGuidedQuat = null;
      this.landingGuideActive = false;
    }

    // P3b-C：WAC 区域反照率层 SSE 门控（实际 drawingBuffer 与 FOV，带迟滞；
    // viewDepth 用近端地表距离=保守下界——斜视时门控偏早开而非漏开）
    if (this.regionalAlbedo?.isReady) {
      const moonPose = this.getBodyWorldPose('moon');
      const moonNode = this.bodyNodes.get('moon');
      const sceneRadius =
        moonNode?.mesh ? moonNode.displayRadius * moonNode.mesh.scale.x : moonNode?.displayRadius ?? 0.368;
      const metersPerScene = 1737400 / Math.max(1e-9, sceneRadius);
      const surfaceDistM = Math.max(
        1,
        (this.camera.position.distanceTo(moonPose.pos) - sceneRadius) * metersPerScene
      );
      this.renderer.getDrawingBufferSize(this.drawingBufferSizeTmp);
      this.regionalAlbedo.update(
        surfaceDistM,
        this.drawingBufferSizeTmp.y,
        THREE.MathUtils.degToRad(this.camera.fov),
        deltaSec
      );

      // P3-T5：L1 影像换装——SSE 门控开启且 WAC 纹理就绪时，L1 表面由 2K 全球图
      // 换装 WAC 实测反照率（同一不透明表面上换图，非叠加层；只升不降）。
      // S5-3：WAC 资产仅 taurus 打包——非 taurus 激活站不得换装
      if (this.lolaWacTexture && this.activeMoonSiteId === 'taurus-littrow' && this.regionalAlbedo.gateOpen) {
        for (const mat of this.lolaMaterials) {
          if (mat.map !== this.lolaWacTexture) {
            mat.map = this.lolaWacTexture;
            mat.needsUpdate = true;
          }
        }
      }
    }

    // P3b-E：DTM 地形块距离渐显（用户反馈 2026-09-24：远看亚像素闪烁光点 +
    // 末段方块边缘突现）。块按自身屏幕张角 8→36px smoothstep 渐显；36px 为块在
    // WAC 门控开启距离处的张角——几何与影像在门控开启时同步就位，此前几何先于
    // 影像逐渐显形；<8px 隐藏，消除走样闪烁。挖孔底盖板（moon-hole-cap）兜底。
    if (this.lunarValleyMesh && this.lunarValleyMaterial) {
      const windowM = RasterTerrainSource.getInstance().demWindowMeters;
      if (windowM) {
        const moonPose = this.getBodyWorldPose('moon');
        const moonNode = this.bodyNodes.get('moon');
        const sceneRadius =
          moonNode?.mesh ? moonNode.displayRadius * moonNode.mesh.scale.x : moonNode?.displayRadius ?? 0.368;
        const metersPerScene = 1737400 / Math.max(1e-9, sceneRadius);
        const site = LANDING_SITES['taurus-littrow'];
        const siteWorld = new THREE.Vector3(...latLonDirection(site.centerLat, site.centerLon))
          .applyQuaternion(moonPose.quaternion)
          .multiplyScalar(sceneRadius)
          .add(moonPose.pos);
        const siteDistM = Math.max(1, this.camera.position.distanceTo(siteWorld) * metersPerScene);
        this.renderer.getDrawingBufferSize(this.drawingBufferSizeTmp);
        const blockPx = projectedTexelPx(
          windowM,
          focalPixelsPx(this.drawingBufferSizeTmp.y, THREE.MathUtils.degToRad(this.camera.fov)),
          siteDistM
        );
        const opacity = terrainRevealOpacity(blockPx);
        this.lunarValleyMaterial.transparent = opacity < 1;
        this.lunarValleyMaterial.opacity = opacity;

        // P3-T5b：L1 同律渐显——按网格纹元屏幕张角（decimate 2 × 236.9m ≈ 474m）
        // 0.35→1.3px smoothstep（~1470km 起、~395km 全显，先于 WAC 门控 361km）。
        // 远距隐藏消除亚像素走样"星星点点"（用户反馈 2026-09-24：目标区域提前
        // 点亮）；孔下盖板兜底，隐藏期间不露星空。
        const lolaCellM = (LolaRegionalSource.getInstance().metaReady?.nativeSpacingMeters ?? 236.901) * 2;
        const cellPx = projectedTexelPx(lolaCellM, focalPixelsPx(this.drawingBufferSizeTmp.y, THREE.MathUtils.degToRad(this.camera.fov)), siteDistM);
        const l1Opacity = terrainRevealOpacity(cellPx, 0.35, 1.3);
        for (const mat of this.lolaMaterials) {
          mat.transparent = l1Opacity < 1;
          mat.opacity = l1Opacity;
        }

        // S3a 碎石场距离淡入：<6km 全显，6–9km smoothstep 渐隐（远距亚像素无意义）
        if (this.rockFieldMaterial) {
          const t = Math.min(1, Math.max(0, (9000 - siteDistM) / 3000));
          const op = t * t * (3 - 2 * t);
          this.rockFieldMaterial.transparent = op < 1;
          this.rockFieldMaterial.opacity = op;
        }
      }
    }

    // S4b：耶泽罗火星地形距离渐显（与月面 DTM 同律：块屏幕张角 8→36px smoothstep）。
    // collar 与窗口同律渐显（同属本地实测面）；远距全球球可见、孔底盖板兜底——
    // 隐藏期不透星空、无亚像素走样。火星网格无逐帧缩放（行星不经卫星比例过渡），
    // 场景半径直接取 pose 口径。
    const activeMarsStack = this.marsSiteStacks.get(this.activeMarsSiteId); // S5-6：按激活站
    if (this.marsTerrainMesh && this.marsTerrainMaterial && activeMarsStack) {
      const dtm = activeMarsStack.dtm;
      const meta = dtm.metaReady;
      if (meta) {
        const marsPose = this.getBodyWorldPose('mars');
        const sceneRadius = marsPose.surfaceRadius;
        const metersPerScene = dtm.datumRadius / Math.max(1e-9, sceneRadius);
        const site = LANDING_SITES[activeMarsStack.siteId];
        const siteWorld = new THREE.Vector3(...latLonDirection(site.centerLat, site.centerLon))
          .applyQuaternion(marsPose.quaternion)
          .multiplyScalar(sceneRadius)
          .add(marsPose.pos);
        const siteDistM = Math.max(1, this.camera.position.distanceTo(siteWorld) * metersPerScene);
        this.renderer.getDrawingBufferSize(this.drawingBufferSizeTmp);
        const blockPx = projectedTexelPx(
          Math.max(meta.windowSizeM[0], meta.windowSizeM[1]),
          focalPixelsPx(this.drawingBufferSizeTmp.y, THREE.MathUtils.degToRad(this.camera.fov)),
          siteDistM
        );
        const opacity = terrainRevealOpacity(blockPx);
        this.marsTerrainMaterial.transparent = opacity < 1;
        this.marsTerrainMaterial.opacity = opacity;
        if (this.marsCollarMaterial) {
          this.marsCollarMaterial.transparent = opacity < 1;
          this.marsCollarMaterial.opacity = opacity;
        }
        // S5-1：MOLA L1 同律渐显——按网格纹元屏幕张角（decimate 2 × 463m ≈ 926m）
        // 0.35→1.3px smoothstep，先于 DTM 全显（LOD 顺序：全球球→L1→DTM）。
        // 远距隐藏消除亚像素走样；孔下盖板兜底，隐藏期间不露星空。
        const molaCellM = (activeMarsStack.mola.metaReady?.nativeSpacingMeters ?? 463) * 2;
        const molaCellPx = projectedTexelPx(
          molaCellM,
          focalPixelsPx(this.drawingBufferSizeTmp.y, THREE.MathUtils.degToRad(this.camera.fov)),
          siteDistM
        );
        const l1Opacity = terrainRevealOpacity(molaCellPx, 0.35, 1.3);
        for (const mat of this.marsL1Materials) {
          mat.transparent = l1Opacity < 1;
          mat.opacity = l1Opacity;
        }
        if (this.marsRockFieldMaterial) {
          const t = Math.min(1, Math.max(0, (9000 - siteDistM) / 3000));
          const op = t * t * (3 - 2 * t);
          this.marsRockFieldMaterial.transparent = op < 1;
          this.marsRockFieldMaterial.opacity = op;
        }
      }
    }

    // 5. 更新单一相机控制器
    this.cameraController.update(deltaSec, (id: BodyId) => this.getBodyWorldPose(id));

    // 飞行状态变化监听：飞行结束切入 ORBIT_TARGET 时立即同步状态给 UI，飞行过程中同步实时插值进度
    const isTransitioningNow = this.cameraController.getSnapshot().isTransitioning;
    if (this.prevIsTransitioning !== isTransitioningNow) {
      this.prevIsTransitioning = isTransitioningNow;
      this.emitSnapshot();
    }

    // 6. 渲染一帧（S3a 分层深度：Pro 260924——近地形与遥远天体各自深度处理）
    // 单一权威相机姿态；远 pass 用同姿态派生相机（近面 = 最近远天体距离之半）。
    // 顺序：先远 pass（星空+非锚定天体，含地球云/大气/瓦片分层），清深度后再
    // 近 pass（锚定天体系统）——近物自然遮挡远物；远 pass 内部图层（云 0.012
    // 单位间隔）在合理近面下深度可分，消除触地看地球的鳞片互抢。
    this.renderLayered();

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
   * terrain-study: 隐藏云层，提供全向参考照明（瓦片 shader 内实现），模拟时间保持不变
   */
  public setObservationMode(mode: ObservationMode): void {
    this.observationMode = mode;
    if (this.earthTileManager) {
      this.earthTileManager.setObservationMode(mode);
    }
    this.syncEarthCloudVisibility();
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
    // P1：物理观察模式下，以当前相机目标所在的行星系统为线性化参考系（地月/木星系/土星系同一规则）
    if (isPhysicalObservation) {
      const camSnap = this.cameraController.getSnapshot();
      const focusId = camSnap.targetBodyId || camSnap.selectedBodyId || 'earth';
      const focusData = BODIES[focusId];
      if (focusData?.type === 'moon' && focusData.parentId) {
        this.bodyPoseProvider.setPhysicalReferenceBody(focusData.parentId);
      } else if (focusData?.type === 'planet' || focusData?.type === 'star') {
        // R3-a（260925 审计七）：太阳也可作为物理参考——观察太阳时它作为基准
        // 标尺保持 NAV 形态正常显示（改前 star 无分支，reference 残留旧值，
        // 物理模式下前往太阳仍被强制隐藏）
        this.bodyPoseProvider.setPhysicalReferenceBody(focusId);
      }
    }
    const referenceBodyId = this.bodyPoseProvider.getPhysicalReferenceBody();
    const sunNode = this.bodyNodes.get('sun');
    if (sunNode) {
      if (!isPhysicalObservation || referenceBodyId === 'sun') {
        // R3-a：导航示意域，或物理模式且太阳即参考天体（作基准标尺）——NAV 形态
        sunNode.systemGroup.visible = true;
        sunNode.systemGroup.scale.setScalar(1);
      } else {
        // R3-b：物理模式下从其他天体看太阳——按真实角尺寸渲染（0.267° 太阳角
        // 半径；NAV 放大球不进入局部物理观看空间——审计五/七）。方向即相机到
        // 原点方向（近似星历下正确）；仅整体缩放，不改位置
        sunNode.systemGroup.visible = true;
        const dist = this.camera.position.length();
        const sunAngularRadius = Math.atan(696000 / 149597870);
        const navRadius = sunNode.displayRadius;
        const scale = Math.max(1e-6, (dist * Math.tan(sunAngularRadius)) / navRadius);
        sunNode.systemGroup.scale.setScalar(scale);
      }
    }

    for (const [id, node] of this.bodyNodes.entries()) {
      if (node.data.type === 'star') {
        // 太阳位于原点，缓慢自转
        const sunRotRad = ((2.0 * Math.PI) / node.data.rotationPeriodHours) * this.simTimeHours;
        node.mesh.rotation.y = sunRotRad;
        continue;
      }

      if (node.data.type === 'planet') {
        if (isPhysicalObservation && id !== referenceBodyId) {
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
        if (isPhysicalObservation && node.data.parentId !== referenceBodyId) {
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
        // P1 勘误（仅月球）：body-fixed 约定 BODY-FIXED-RENDER-X0-YN-Z90E 中 +X 即本初子午线，
        // 潮汐锁定下应指向母星。原式 -moonOrbitAngle+spinOffset 实测将子地球点置于
        // lon≈183°（2026-09-23 物理模式实测：Taurus-Littrow 站点地球仰角 -54.8°，
        // 解析真值 +53.7°，恰 180° 镜像，与 HUD 自身标注矛盾）。加 π 使本初子午线
        // 朝向地球，与约定声明、真实月面地理（近侧朝地球）及 PLANET_SPIN_OFFSETS
        // 的注释意图一致。其余卫星的观赏偏置按旧相位整体调定，暂不同步翻转（见交接）。
        const lockPhase = id === 'moon' ? Math.PI : 0;
        node.mesh.rotation.y = -moonOrbitAngle + lockPhase + spinOffset;

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
   * 严格遵循 V3 与 R3 规范：捕获真实模拟时钟、展示策略、相机机位与 lookTarget、图层开关、载具、多重观察模式与地表站点
   */
  public captureObservationSnapshot(title = '当前观察点'): BookmarkItemV3 {
    const camSnap = this.cameraController.getSnapshot();
    const currentTargetId = camSnap.targetBodyId || camSnap.selectedBodyId || 'earth';
    const policy = this.bodyPoseProvider.getPolicy();
    const epochDate = new Date(Date.parse(BodyPoseProvider.BASE_EPOCH_ISO) + this.simTimeHours * 3600 * 1000);

    // V3 地表站点：来自 CameraController 权威米制站点状态 (真实 body-fixed 坐标/法线/地面高程/眼高/朝向)，
    // 不再使用零坐标与固定法线占位
    const surfaceStation = this.cameraController.getSurfaceStationPose()?.station;

    return {
      id: `bm-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      schemaVersion: 3,
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
      surfaceStation,
      observationMode: this.observationMode,
      quality: 'analytic-approximation',
      sourceVersion: '2026.09-P2-DTM', // P2 起站点高程来自真实 NAC DTM
      viewCameraMode: this.viewCameraMode,
      vehicleId: this.currentVehicleId,
      layers: {
        showClouds: this.showClouds,
        showAtmosphere: this.showAtmosphere,
        teachingLight: this.teachingLight,
        showOrbits: false, // S2：轨迹线已移除——字段保留 v3 书签兼容，恒 false
        venusRadarMode: this.venusRadarMode,
      },
      simTimeHours: this.simTimeHours,
      createdAtIso: new Date().toISOString(),
    };
  }

  /**
   * 获取全系统瞬时物理快照 (PhysicalSystemSnapshot)
   */
  public getPhysicalSystemSnapshot(): PhysicalSystemSnapshot {
    return this.bodyPoseProvider.getPhysicalSystemSnapshot(this.simTimeHours);
  }

  /** 主引擎渲染帧计数 (验收性能采样用) */
  public getRenderFrameCount(): number {
    return this.renderFrameCount;
  }

  /** 相机控制器访问 (验收只读诊断用；相机仍由唯一控制器写入) */
  public getSurfaceStationPose() {
    return this.cameraController.getSurfaceStationPose();
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
