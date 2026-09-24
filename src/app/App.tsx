import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SolarEngine, WebGLDiagnosticInfo, CelestialLabelItem } from '../engine/SolarEngine';
import { BODIES } from '../astronomy/bodies';
import type { BodyId } from '../contracts/body';
import type { CameraStateSnapshot } from '../contracts/camera';
import type { VehicleId, ViewCameraMode } from '../contracts/vehicle';
import { VEHICLE_CATALOG } from '../vehicles/VehicleCatalog';
import { HangarModal } from '../vehicles/HangarModal';
import { PostcardModal } from '../vehicles/PostcardModal';
import { BookmarkModal } from './BookmarkModal';
import { MissionHUD } from './hud/MissionHUD';
import { LunarLandingHUD } from './LunarLandingHUD';
import { createHudStore } from './hud/store';
import './app.css';
import type { BookmarkItem } from '../contracts/bookmark';
import { normalizeObservationIntent } from '../contracts/bookmark';
import type { ObservationMode } from '../world-support/visibility';
import { generateDiscoveryPostcard } from '../utils/postcard';
import {
  Compass,
  Eye,
  ShieldCheck,
  Rocket,
  Camera,
  Bookmark,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  X,
} from 'lucide-react';
import { soundEffects } from '../audio/SoundEffects';

const PLANET_ORDER: BodyId[] = [
  'sun',
  'mercury',
  'venus',
  'earth',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
];

const PLANET_MOONS: Record<string, BodyId[]> = {
  earth: ['moon'],
  mars: ['phobos', 'deimos'],
  jupiter: ['amalthea', 'io', 'europa', 'ganymede', 'callisto'],
  saturn: ['mimas', 'enceladus', 'tethys', 'dione', 'rhea', 'titan', 'hyperion', 'iapetus'],
  uranus: ['miranda', 'ariel', 'umbriel', 'titania', 'oberon'],
  neptune: ['triton', 'proteus'],
};

export const App: React.FC = () => {
  const hudStore = useMemo(createHudStore, []);
  const [engineError, setEngineError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<SolarEngine | null>(null);

  const [selectedBodyId, setSelectedBodyId] = useState<BodyId>('earth');
  const [cameraSnapshot, setCameraSnapshot] = useState<CameraStateSnapshot | null>(null);
  const [webglInfo, setWebglInfo] = useState<WebGLDiagnosticInfo | null>(null);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [timeScale, setTimeScale] = useState<number>(50.0); // 太阳系行星默认 50x 便于观察公转动态

  // 观察模式开关
  const [showClouds, setShowClouds] = useState<boolean>(true);
  const [teachingLight, setTeachingLight] = useState<boolean>(false);
  const [showAtmosphere, setShowAtmosphere] = useState<boolean>(true);
  const [venusRadarMode, setVenusRadarMode] = useState<boolean>(false);
  const [titanInfraredMode, setTitanInfraredMode] = useState<boolean>(false);
  const [reduceMotion, setReduceMotion] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(soundEffects.getIsMuted());
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // 载具与伴飞视角系统（默认纯净无载具观察，支持在机库自由选择或结束伴飞）
  const [currentVehicleId, setCurrentVehicleId] = useState<VehicleId | null>(null);
  const [viewCameraMode, setViewCameraMode] = useState<ViewCameraMode>('PLANET_OBSERVE');
  const [showHangar, setShowHangar] = useState<boolean>(false);

  // 观察点与书签系统
  const [showBookmarkModal, setShowBookmarkModal] = useState<boolean>(false);

  // 3D 屏幕空间天体悬浮引导标识
  const [showLabels, setShowLabels] = useState<boolean>(true);
  const [celestialLabels, setCelestialLabels] = useState<CelestialLabelItem[]>([]);

  // 探索明信片系统
  const [showPostcardModal, setShowPostcardModal] = useState<boolean>(false);
  const [postcardDataUrl, setPostcardDataUrl] = useState<string>('');
  const [isGeneratingPostcard, setIsGeneratingPostcard] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // 地貌观察 / 物理观测模式 (P0 核心体验)
  const [observationMode, setObservationMode] = useState<ObservationMode>('physical');

  useEffect(() => {
    if (!containerRef.current) return;

    try {
      const engine = new SolarEngine(containerRef.current, {
        onHudSnapshot: hudStore.publish,
        onSelectBody: (id) => {
          setSelectedBodyId(id);
        },
        onCameraSnapshot: (snap) => setCameraSnapshot(snap),
        onWebGLInfo: (info) => setWebglInfo(info),
        onCelestialLabels: (labels) => setCelestialLabels(labels),
        onObservationModeChange: (mode) => setObservationMode(mode),
        onContextState: (state) => {
          if (state === 'lost') {
            showToast('⚠️ 显卡 WebGL 上下文中断，系统正在全力保护与恢复...');
          } else if (state === 'restored') {
            showToast('✨ 3D 渲染管线已恢复！');
          }
        },
      });

      engineRef.current = engine;
      (window as any).__solarEngine = engine;
      engine.setTimeScale(50.0);

      return () => {
        hudStore.publish(null);
        engine.dispose();
        engineRef.current = null;
        (window as any).__solarEngine = null;
      };
    } catch (err: any) {
      console.error('Failed to initialize SolarEngine:', err);
      setEngineError(err instanceof Error ? err.message : '3D 场景初始化失败');
    }
  }, []);

  const handleFlyTo = (id: BodyId) => {
    setSelectedBodyId(id);
    engineRef.current?.executeCameraCommand({ type: 'flyTo', bodyId: id });
  };

  const handleToggleObservationMode = () => {
    const nextMode = observationMode === 'physical' ? 'terrain-study' : 'physical';
    setObservationMode(nextMode);
    engineRef.current?.setObservationMode(nextMode);
    if (nextMode === 'terrain-study') {
      showToast('🔭 已切换至地貌观察模式：隐藏云层 · 参考照明 (模拟时间不变)');
    } else {
      showToast('🌍 已切换至物理观测模式：真实昼夜与云层');
    }
  };

  const handleOverview = () => {
    setSelectedBodyId('sun');
    engineRef.current?.executeCameraCommand({ type: 'overview' });
  };

  const togglePause = () => {
    const next = !isPaused;
    setIsPaused(next);
    engineRef.current?.setPaused(next);
  };

  const changeSpeed = (scale: number) => {
    setTimeScale(scale);
    engineRef.current?.setTimeScale(scale);
  };

  const toggleClouds = () => {
    const next = !showClouds;
    setShowClouds(next);
    engineRef.current?.setShowClouds(next);
  };

  const toggleTeachingLight = () => {
    const next = !teachingLight;
    setTeachingLight(next);
    engineRef.current?.setTeachingLight(next);
  };

  const toggleAtmosphere = () => {
    const next = !showAtmosphere;
    setShowAtmosphere(next);
    engineRef.current?.setShowAtmosphere(next);
  };

  const toggleVenusRadar = () => {
    const next = !venusRadarMode;
    setVenusRadarMode(next);
    engineRef.current?.setShowVenusSurface(next);
  };

  const toggleTitanInfrared = () => {
    const next = !titanInfraredMode;
    setTitanInfraredMode(next);
    engineRef.current?.setShowTitanInfrared(next);
  };

  const toggleMute = () => {
    const next = soundEffects.toggleMute();
    setIsMuted(next);
    showToast(next ? '🔇 深空音效：已静音' : '🔊 深空微波背景音：已开启');
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  const handleSelectVehicle = (id: VehicleId) => {
    setCurrentVehicleId(id);
    engineRef.current?.setVehicle(id);
    engineRef.current?.setViewCameraMode('VEHICLE_FORMATION');
    setViewCameraMode('VEHICLE_FORMATION');
    const vDef = VEHICLE_CATALOG[id];
    showToast(`🚀 已登船：${vDef.name}，正在伴飞！`);
  };

  const handleCameraModeChange = (mode: ViewCameraMode) => {
    setViewCameraMode(mode);
    engineRef.current?.setViewCameraMode(mode);
  };

  const handleGeneratePostcard = async () => {
    engineRef.current?.renderImmediate();
    const canvas = engineRef.current?.getRendererCanvas();
    if (!canvas) return;
    setIsGeneratingPostcard(true);
    try {
      const vDef = currentVehicleId ? VEHICLE_CATALOG[currentVehicleId] : undefined;
      const url = await generateDiscoveryPostcard({
        sourceCanvas: canvas,
        bodyName: activeBody.name,
        bodyNameEn: activeBody.nameEn,
        bodyType: activeBody.type === 'star' ? '恒星 Star' : activeBody.type === 'planet' ? '大行星 Planet' : '卫星 Moon',
        vehicleName: vDef ? vDef.name : undefined,
        vehicleAgency: vDef ? vDef.agency : undefined,
        observationTip: activeBody.observationTip,
        funFact: activeBody.funFact,
        sourceRef: activeBody.sourceRef,
      });
      setPostcardDataUrl(url);
      setShowPostcardModal(true);
    } catch (err) {
      console.error('Failed to generate postcard:', err);
    } finally {
      setIsGeneratingPostcard(false);
    }
  };

  const toggleReduceMotion = () => {
    const next = !reduceMotion;
    setReduceMotion(next);
    engineRef.current?.setReduceMotion(next);
    showToast(next ? '⚡ 减弱动态模式：已开启（平缓降噪，过渡 150ms）' : '🎬 动效漫游模式：已开启');
  };

  const handleClearVehicle = () => {
    setCurrentVehicleId(null);
    engineRef.current?.setVehicle(null);
    engineRef.current?.setViewCameraMode('PLANET_OBSERVE');
    setViewCameraMode('PLANET_OBSERVE');
    showToast('🪐 已结束伴飞，切回行星自由观察');
  };

  const handleRestoreBookmark = (bm: BookmarkItem) => {
    setSelectedBodyId(bm.targetBodyId);
    const nextVeh = bm.vehicleId ?? null;
    setCurrentVehicleId(nextVeh);
    engineRef.current?.setVehicle(nextVeh);
    setViewCameraMode(bm.viewCameraMode);
    engineRef.current?.setViewCameraMode(bm.viewCameraMode);

    // 同步展示策略（V2 规范：NAV_SCHEMATIC 导航示意 或 PHYSICAL_OBSERVATION 物理真实尺度）
    const policy = (bm as any).presentationPolicy || 'NAV_SCHEMATIC';
    engineRef.current?.setPresentationPolicy(policy, 1.2);

    // 恢复权威时间标尺 (simTimeHours)
    if (typeof (bm as any).simTimeHours === 'number' && Number.isFinite((bm as any).simTimeHours)) {
      engineRef.current?.setSimTimeHours((bm as any).simTimeHours);
    }

    setShowClouds(bm.layers.showClouds);
    engineRef.current?.setShowClouds(bm.layers.showClouds);

    setShowAtmosphere(bm.layers.showAtmosphere);
    engineRef.current?.setShowAtmosphere(bm.layers.showAtmosphere);

    setTeachingLight(bm.layers.teachingLight);
    engineRef.current?.setTeachingLight(bm.layers.teachingLight);

    // S2：轨迹线已移除——旧书签的 showOrbits 字段不再消费（引擎入口为惰性空操作）

    setVenusRadarMode(bm.layers.venusRadarMode);
    engineRef.current?.setShowVenusSurface(bm.layers.venusRadarMode);

    // 同步多重观察模式 (V3 规范：physical / terrain-study 统一语义，遗留标签在加载时已归一)
    if (bm.observationMode) {
      engineRef.current?.setObservationMode(normalizeObservationIntent(bm.observationMode));
    }

    // 若包含地表米制站点，优先切入站心观察 (V3 规范)：
    // 使用保存的眼高与朝向；非法站点安全回退球坐标恢复，不 clamp 掩盖
    const station = bm.surfaceStation;
    const stationValid =
      station &&
      BODIES[station.bodyId] &&
      Number.isFinite(station.latDeg) &&
      Math.abs(station.latDeg) <= 90 &&
      Number.isFinite(station.lonDeg) &&
      Math.abs(station.lonDeg) <= 180 &&
      Array.isArray(station.bodyFixedPosM) &&
      station.bodyFixedPosM.length === 3 &&
      station.bodyFixedPosM.every(Number.isFinite) &&
      Number.isFinite(station.eyeHeightM) &&
      station.eyeHeightM > 0;

    if (stationValid) {
      // 数据版本变化时明确提示，不静默按旧地形恢复
      if (station.bodyId === 'moon' && bm.sourceVersion && bm.sourceVersion !== '2026.09-P1-V3') {
        showToast('⚠️ 书签数据版本已变化，按当前地形数据恢复站点');
      }
      engineRef.current?.executeCameraCommand({
        type: 'enterSurfaceLook',
        bodyId: station.bodyId,
        lat: station.latDeg,
        lon: station.lonDeg,
        eyeHeightM: station.eyeHeightM,
        initialYawDeg: station.orientationDeg?.yawDeg,
        initialPitchDeg: station.orientationDeg?.pitchDeg,
      });
      if (bm.lookTarget?.kind === 'body') {
        engineRef.current?.executeCameraCommand({
          type: 'lookAtSkyTarget',
          targetBodyId: bm.lookTarget.bodyId,
        });
      }
    } else {
      if (station) {
        showToast('⚠️ 书签地表站点数据不合法，已回退到轨道观察恢复');
      }
      const lookTarget = (bm as any).lookTarget;
      engineRef.current?.executeCameraCommand({
        type: 'restoreBookmark',
        targetBodyId: bm.targetBodyId,
        spherical: bm.spherical,
        lookTarget,
      });
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const activeBody = BODIES[selectedBodyId] || BODIES.sun;
  const parentPlanetId = activeBody.type === 'moon' ? activeBody.parentId : activeBody.id;
  const currentMoons = (parentPlanetId && PLANET_MOONS[parentPlanetId]) || [];
  const activeVehicle = currentVehicleId ? VEHICLE_CATALOG[currentVehicleId] : null;

  return (
    <div
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: '#020408',
        color: '#f0f4f8',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* 3D 渲染画布容器 */}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* 顶部高密度导航细条 (Top Navigation Bar) */}
      <div className="app-top-container">
        <div className="app-top-row">
          {/* 左端：品牌与科普标识 */}
          <header className="app-header">
            <Compass size={18} color="#38bdf8" />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <h1 style={{ margin: 0, fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', color: '#f8fafc', whiteSpace: 'nowrap' }}>
                太阳系漫游 · 亲子探索
              </h1>
              <div className="app-header-subtitle" style={{ fontSize: 10, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 5 }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    backgroundColor: '#22c55e',
                  }}
                />
                <span style={{ whiteSpace: 'nowrap' }}>恒星 · 八大行星 · 示意比例</span>
              </div>
            </div>
          </header>

          {/* 右端：功能与工具栏（机库、书签、音效、全屏、诊断） */}
          <div className="app-toolbar">
            {/* 航天器机库 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <button
                onClick={() => setShowHangar(true)}
                className="app-toolbar-btn btn-hangar"
                data-testid="toolbar-hangar-btn"
                title="打开航天器机库选择搭乘载具"
                aria-label="打开航天器机库"
              >
                <Rocket size={13} color="#38bdf8" />
                <span>机库</span>
                <span
                  style={{
                    fontSize: 9,
                    padding: '1px 5px',
                    borderRadius: 4,
                    backgroundColor: activeVehicle ? 'rgba(34, 197, 94, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                    color: activeVehicle ? '#4ade80' : '#94a3b8',
                    border: activeVehicle ? '1px solid rgba(34, 197, 94, 0.4)' : '1px solid rgba(255, 255, 255, 0.15)',
                  }}
                >
                  {activeVehicle ? activeVehicle.name : '未登船'}
                </span>
              </button>
              {activeVehicle && (
                <button
                  onClick={handleClearVehicle}
                  className="app-toolbar-btn"
                  data-testid="toolbar-clear-vehicle-btn"
                  style={{ padding: '6px 7px', color: '#fca5a5' }}
                  title="结束伴飞 · 移除航天器"
                  aria-label="结束伴飞"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* 观察点书签 */}
            <button
              onClick={() => setShowBookmarkModal(true)}
              className="app-toolbar-btn"
              data-testid="toolbar-bookmark-btn"
              title="打开太阳系观察点与书签库"
              aria-label="打开太阳系观察点与书签库"
            >
              <Bookmark size={13} />
              <span>书签</span>
            </button>

            {/* 记录发现 · 探索明信片 */}
            <button
              onClick={handleGeneratePostcard}
              disabled={isGeneratingPostcard}
              className="app-toolbar-btn btn-postcard"
              title="将当前 3D 观测画面合成为专属探索发现明信片"
              aria-label="探索明信片"
            >
              <Camera size={13} />
              <span>{isGeneratingPostcard ? '截帧中...' : '明信片'}</span>
            </button>

            {/* 音效开关 */}
            <button
              onClick={toggleMute}
              className="app-toolbar-btn"
              title={isMuted ? '开启深空微波背景音与交互微响' : '静音深空环境音'}
              aria-label={isMuted ? '静音' : '音效'}
            >
              {isMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
              <span>{isMuted ? '静音' : '音效'}</span>
            </button>

            {/* 全屏模式切换 */}
            <button
              onClick={toggleFullscreen}
              className="app-toolbar-btn"
              title="切换全屏沉浸观测模式"
              aria-label="全屏模式切换"
            >
              {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              <span>{isFullscreen ? '窗口' : '全屏'}</span>
            </button>

            {/* WebGL 状态 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                background: 'rgba(8, 14, 24, 0.78)',
                backdropFilter: 'blur(16px)',
                padding: '5px 9px',
                borderRadius: 10,
                border: '1px solid rgba(255, 255, 255, 0.12)',
                fontSize: 10,
                color: '#38bdf8',
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              <ShieldCheck size={12} />
              <span>{webglInfo?.rendererName?.split(' ')[0] || 'WebGL2'}</span>
              <span style={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: '#22c55e' }} />
            </div>
          </div>
        </div>

        {/* 天体快速巡航细条 */}
        <nav className="app-nav-planets" aria-label="天体巡航选择">
          <button
            onClick={handleOverview}
            className={`app-planet-btn ${cameraSnapshot?.mode === 'TRANSITION' && selectedBodyId === 'sun' ? 'is-active' : ''}`}
            title="俯瞰整个太阳系全景"
            aria-label="俯瞰整个太阳系全景"
          >
            <Eye size={12} />
            <span>全景</span>
          </button>

          <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.15)', margin: '0 2px', flexShrink: 0 }} />

          {PLANET_ORDER.map((id) => {
            const body = BODIES[id];
            if (!body) return null;
            const isSelected = selectedBodyId === id || (activeBody.parentId === id);

            return (
              <button
                key={id}
                data-testid={`planet-btn-${id}`}
                onClick={() => handleFlyTo(id)}
                className={`app-planet-btn ${isSelected ? 'is-active' : ''}`}
                aria-label={`观测 ${body.name}`}
              >
                <div
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    backgroundColor: body.colorHex ? `#${body.colorHex.toString(16).padStart(6, '0')}` : '#fff',
                    boxShadow: isSelected ? '0 0 6px #38bdf8' : 'none',
                    flexShrink: 0,
                  }}
                />
                <span>{body.name}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* 卫星次级细条：紧跟在顶部行星栏下方 */}
      {currentMoons.length > 0 && (
        <div
          data-testid="moon-subbar"
          className="app-satellite-bar"
        >
          <span style={{ fontSize: 10, color: '#94a3b8', marginRight: 2, whiteSpace: 'nowrap' }}>🛰️ 卫星:</span>
          {currentMoons.map((satId) => {
            const sat = BODIES[satId];
            if (!sat) return null;
            const isSelected = selectedBodyId === satId;

            return (
              <button
                key={satId}
                data-testid={`moon-btn-${satId}`}
                onClick={() => handleFlyTo(satId)}
                className={`app-satellite-btn ${isSelected ? 'is-active' : ''}`}
                aria-label={`观测卫星 ${sat.name}`}
              >
                <span>{sat.name}</span>
              </button>
            );
          })}
          {selectedBodyId === 'earth' && (
            <>
              <div style={{ width: 1, height: 12, background: 'rgba(255,255,255,0.15)', margin: '0 4px', flexShrink: 0 }} />
              <button
                data-testid="earth-observation-mode-btn"
                onClick={handleToggleObservationMode}
                className={`app-satellite-btn ${observationMode === 'terrain-study' ? 'is-active' : ''}`}
                style={{
                  borderColor: observationMode === 'terrain-study' ? '#f59e0b' : 'rgba(255,255,255,0.25)',
                  color: observationMode === 'terrain-study' ? '#fcd34d' : '#cbd5e1',
                }}
                aria-label={observationMode === 'terrain-study' ? '切换为物理观测' : '切换为地貌观察'}
                title={observationMode === 'terrain-study' ? '地貌观察：隐藏云层并提供参考照明；模拟时间不变' : '物理观测：真实时间、昼夜阴晴与动态云层'}
              >
                <span>{observationMode === 'terrain-study' ? '🔭 地貌观察' : '🌍 物理观测'}</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* 3D 屏幕空间天体悬浮引导标识 */}
      {showLabels && celestialLabels.length > 0 && (
        <div
          data-testid="celestial-labels-layer"
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            overflow: 'hidden',
            zIndex: 8,
          }}
        >
          {celestialLabels
            .filter((lbl) => {
              // 沉浸式观星：当点击去到某个星球时，该星球自身标签绝不展示
              if (lbl.id === selectedBodyId) return false;
              if (lbl.id === cameraSnapshot?.targetBodyId) return false;
              if (lbl.id === cameraSnapshot?.selectedBodyId) return false;
              return true;
            })
            .map((lbl) => {
              const isSelected = selectedBodyId === lbl.id;
              return (
                <button
                  key={lbl.id}
                  data-testid={`celestial-label-${lbl.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFlyTo(lbl.id);
                  }}
                  style={{
                    position: 'absolute',
                    left: `${lbl.screenX}px`,
                    top: `${lbl.screenY}px`,
                    transform: 'translate(-50%, -100%)',
                    pointerEvents: 'auto',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '3px 8px',
                    borderRadius: 12,
                    background: isSelected
                      ? 'rgba(2, 132, 199, 0.90)'
                      : 'rgba(15, 23, 42, 0.75)',
                    border: isSelected
                      ? '1px solid #38bdf8'
                      : '1px solid rgba(255, 255, 255, 0.18)',
                    backdropFilter: 'blur(6px)',
                    color: isSelected ? '#ffffff' : '#cbd5e1',
                    fontSize: 10,
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                    boxShadow: isSelected
                      ? '0 0 12px rgba(56, 189, 248, 0.65)'
                      : '0 2px 8px rgba(0, 0, 0, 0.5)',
                    transition: 'background 0.15s ease, border 0.15s ease, transform 0.15s ease',
                    userSelect: 'none',
                  }}
                  title={`点击飞往 ${lbl.name} (${lbl.nameEn})`}
                >
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      backgroundColor: isSelected
                        ? '#ffffff'
                        : (lbl.type === 'moon' ? '#a78bfa' : '#38bdf8'),
                      display: 'inline-block',
                    }}
                  />
                  <span>{lbl.name}</span>
                </button>
              );
            })}
        </div>
      )}

      <MissionHUD
        store={hudStore} selectedBodyId={selectedBodyId}
        isPaused={isPaused} timeScale={timeScale} viewCameraMode={viewCameraMode}
        showClouds={showClouds} showAtmosphere={showAtmosphere}
        showLabels={showLabels} teachingLight={teachingLight} reduceMotion={reduceMotion}
        venusRadarMode={venusRadarMode} titanInfraredMode={titanInfraredMode}
        vehicleName={activeVehicle?.name ?? ''}
        onPause={togglePause} onSpeed={changeSpeed} onViewMode={handleCameraModeChange}
        onToggleClouds={toggleClouds} onToggleAtmosphere={toggleAtmosphere}
        onToggleLabels={() => setShowLabels(value => !value)} onToggleLight={toggleTeachingLight}
        onToggleReduceMotion={toggleReduceMotion} onToggleVenus={toggleVenusRadar} onToggleTitan={toggleTitanInfrared}
        onReframe={() => handleFlyTo(selectedBodyId)}
        onCancelTransition={() => engineRef.current?.executeCameraCommand({ type: 'cancelFlight' })}
      />

      {engineError && <div role="alert" style={{ position: 'absolute', top: '40%', left: '10%', right: '10%',
        maxWidth: 640, margin: 'auto', padding: 24, borderRadius: 8, background: '#121820', zIndex: 40 }}>
        <h2 style={{ fontSize: 20 }}>3D 场景未能启动</h2>
        <p style={{ lineHeight: 1.7 }}>{engineError}</p>
        <p style={{ lineHeight: 1.7 }}>需要支持 WebGL2 的浏览器与图形环境。这里不会以空白画面或模拟读数冒充成功。</p>
      </div>}

      {/* 批次 R5：月球着陆与地表停驻遥测仪表 HUD（P3b-A：入口由引擎权威可用性驱动） */}
      <LunarLandingHUD
        engine={engineRef.current}
      />

      {/* 航天器机库全屏模态窗口 */}
      {showHangar && (
        <HangarModal
          currentVehicleId={currentVehicleId}
          onSelectVehicle={handleSelectVehicle}
          onClearVehicle={handleClearVehicle}
          onClose={() => setShowHangar(false)}
        />
      )}

      {/* 探索发现明信片预览与下载窗口 */}
      {showPostcardModal && (
        <PostcardModal
          postcardDataUrl={postcardDataUrl}
          onClose={() => setShowPostcardModal(false)}
          bodyName={activeBody.name}
          vehicleName={activeVehicle ? activeVehicle.name : undefined}
        />
      )}

      {/* 观察点与书签模态窗口 */}
      <BookmarkModal
        isOpen={showBookmarkModal}
        onClose={() => setShowBookmarkModal(false)}
        onRestoreBookmark={handleRestoreBookmark}
        onCaptureSnapshot={(title) => engineRef.current?.captureObservationSnapshot(title) as BookmarkItem}
        currentSnapshot={cameraSnapshot}
        currentBodyId={selectedBodyId}
        currentVehicleId={currentVehicleId}
        currentViewCameraMode={viewCameraMode}
        currentPresentationPolicy={engineRef.current?.getPresentationPolicy()}
        currentSimTimeHours={engineRef.current?.getSimTimeHours() ?? 0}
        currentLayers={{
          showClouds,
          showAtmosphere,
          teachingLight,
          showOrbits: false,
          venusRadarMode,
        }}
        onToast={showToast}
      />

      {/* 交互提示气泡 Toast */}
      {toastMessage && (
        <div
          style={{
            position: 'absolute',
            top: 70,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(15, 23, 42, 0.92)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(56, 189, 248, 0.4)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            color: '#38bdf8',
            padding: '8px 18px',
            borderRadius: 20,
            fontSize: 12,
            fontWeight: 600,
            zIndex: 150,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};
