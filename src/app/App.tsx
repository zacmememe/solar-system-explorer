import React, { useEffect, useRef, useState } from 'react';
import { SolarEngine, WebGLDiagnosticInfo, CelestialLabelItem } from '../engine/SolarEngine';
import { BODIES } from '../astronomy/bodies';
import type { BodyId } from '../contracts/body';
import type { CameraStateSnapshot } from '../contracts/camera';
import type { VehicleId, ViewCameraMode } from '../contracts/vehicle';
import { VEHICLE_CATALOG } from '../vehicles/VehicleCatalog';
import { HangarModal } from '../vehicles/HangarModal';
import { PostcardModal } from '../vehicles/PostcardModal';
import { BookmarkModal } from './BookmarkModal';
import { TrajectoryArcHUD } from './TrajectoryArcHUD';
import type { BookmarkItem } from '../contracts/bookmark';
import { generateDiscoveryPostcard } from '../utils/postcard';
import {
  Play,
  Pause,
  Compass,
  Eye,
  ShieldCheck,
  Info,
  Cloud,
  Sun,
  Sparkles,
  CircleDot,
  Radio,
  Rocket,
  Camera,
  Bookmark,
  Activity,
  Tag,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
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
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<SolarEngine | null>(null);

  const [selectedBodyId, setSelectedBodyId] = useState<BodyId>('earth');
  const [cameraSnapshot, setCameraSnapshot] = useState<CameraStateSnapshot | null>(null);
  const [webglInfo, setWebglInfo] = useState<WebGLDiagnosticInfo | null>(null);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [timeScale, setTimeScale] = useState<number>(50.0); // 太阳系行星默认 50x 便于观察公转动态
  const [showDetails, setShowDetails] = useState<boolean>(false);

  // 观察模式开关
  const [showClouds, setShowClouds] = useState<boolean>(true);
  const [teachingLight, setTeachingLight] = useState<boolean>(false);
  const [showAtmosphere, setShowAtmosphere] = useState<boolean>(true);
  const [showOrbits, setShowOrbits] = useState<boolean>(true);
  const [venusRadarMode, setVenusRadarMode] = useState<boolean>(false);
  const [titanInfraredMode, setTitanInfraredMode] = useState<boolean>(false);
  const [reduceMotion, setReduceMotion] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(soundEffects.getIsMuted());
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // 载具与伴飞视角系统
  const [currentVehicleId, setCurrentVehicleId] = useState<VehicleId | null>('apollo-lm');
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

  // SpaceX 风格 HUD 仪表折叠状态
  const [leftHudCollapsed, setLeftHudCollapsed] = useState<boolean>(false);
  const [rightHudCollapsed, setRightHudCollapsed] = useState<boolean>(false);

  useEffect(() => {
    if (!containerRef.current) return;

    try {
      const engine = new SolarEngine(containerRef.current, {
        onSelectBody: (id) => setSelectedBodyId(id),
        onCameraSnapshot: (snap) => setCameraSnapshot(snap),
        onWebGLInfo: (info) => setWebglInfo(info),
        onCelestialLabels: (labels) => setCelestialLabels(labels),
        onContextState: (state) => {
          if (state === 'lost') {
            showToast('⚠️ 显卡 WebGL 上下文中断，系统正在全力保护与恢复...');
          } else if (state === 'restored') {
            showToast('✨ 3D 渲染管线已恢复！');
          }
        },
      });

      engineRef.current = engine;
      engine.setTimeScale(50.0);

      return () => {
        engine.dispose();
        engineRef.current = null;
      };
    } catch (err: any) {
      console.error('Failed to initialize SolarEngine:', err);
    }
  }, []);

  const handleFlyTo = (id: BodyId) => {
    setSelectedBodyId(id);
    engineRef.current?.executeCameraCommand({ type: 'flyTo', bodyId: id });
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

  const toggleOrbits = () => {
    const next = !showOrbits;
    setShowOrbits(next);
    engineRef.current?.setShowOrbits(next);
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

  const handleRestoreBookmark = (bm: BookmarkItem) => {
    setSelectedBodyId(bm.targetBodyId);
    if (bm.vehicleId) {
      setCurrentVehicleId(bm.vehicleId);
      engineRef.current?.setVehicle(bm.vehicleId);
    }
    setViewCameraMode(bm.viewCameraMode);
    engineRef.current?.setViewCameraMode(bm.viewCameraMode);

    setShowClouds(bm.layers.showClouds);
    engineRef.current?.setShowClouds(bm.layers.showClouds);

    setShowAtmosphere(bm.layers.showAtmosphere);
    engineRef.current?.setShowAtmosphere(bm.layers.showAtmosphere);

    setTeachingLight(bm.layers.teachingLight);
    engineRef.current?.setTeachingLight(bm.layers.teachingLight);

    setShowOrbits(bm.layers.showOrbits);
    engineRef.current?.setShowOrbits(bm.layers.showOrbits);

    setVenusRadarMode(bm.layers.venusRadarMode);
    engineRef.current?.setShowVenusSurface(bm.layers.venusRadarMode);

    engineRef.current?.executeCameraCommand({
      type: 'restoreBookmark',
      targetBodyId: bm.targetBodyId,
      spherical: bm.spherical,
    });
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
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 14,
          right: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          zIndex: 20,
          pointerEvents: 'none',
        }}
      >
        {/* 左端：品牌与科普标识 */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'rgba(8, 14, 24, 0.78)',
            backdropFilter: 'blur(20px)',
            padding: '6px 14px',
            borderRadius: 14,
            border: '1px solid rgba(255, 255, 255, 0.14)',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
            pointerEvents: 'auto',
          }}
        >
          <Compass size={18} color="#38bdf8" />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <h1 style={{ margin: 0, fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', color: '#f8fafc', whiteSpace: 'nowrap' }}>
              太阳系漫游 · 亲子探索
            </h1>
            <div style={{ fontSize: 10, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span
                style={{
                  display: 'inline-block',
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  backgroundColor: '#22c55e',
                }}
              />
              <span style={{ whiteSpace: 'nowrap' }}>恒星 · 八大行星 · 真实物理比例</span>
            </div>
          </div>
        </header>

        {/* 顶部中央：天体快速巡航细条 */}
        <nav
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: 'rgba(8, 14, 24, 0.78)',
            backdropFilter: 'blur(20px)',
            padding: '4px 8px',
            borderRadius: 24,
            border: '1px solid rgba(255, 255, 255, 0.14)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
            maxWidth: 'calc(100vw - 440px)',
            overflowX: 'auto',
            pointerEvents: 'auto',
            scrollbarWidth: 'none',
          }}
        >
          <button
            onClick={handleOverview}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              background: cameraSnapshot?.mode === 'TRANSITION' && selectedBodyId === 'sun'
                ? 'rgba(56, 189, 248, 0.3)'
                : 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 16,
              color: '#38bdf8',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
            }}
            title="俯瞰整个太阳系全景"
          >
            <Eye size={12} />
            <span>全景 Overview</span>
          </button>

          <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.15)', margin: '0 2px' }} />

          {PLANET_ORDER.map((id) => {
            const body = BODIES[id];
            if (!body) return null;
            const isSelected = selectedBodyId === id || (activeBody.parentId === id);

            return (
              <button
                key={id}
                data-testid={`planet-btn-${id}`}
                onClick={() => handleFlyTo(id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '4px 9px',
                  background: isSelected ? 'rgba(56, 189, 248, 0.28)' : 'transparent',
                  border: isSelected ? '1px solid #38bdf8' : '1px solid transparent',
                  borderRadius: 16,
                  color: isSelected ? '#ffffff' : '#cbd5e1',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: isSelected ? 600 : 400,
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease',
                }}
              >
                <div
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    backgroundColor: body.colorHex ? `#${body.colorHex.toString(16).padStart(6, '0')}` : '#fff',
                    boxShadow: isSelected ? '0 0 6px #38bdf8' : 'none',
                  }}
                />
                <span>{body.name}</span>
              </button>
            );
          })}
        </nav>

        {/* 右端：功能与工具栏（机库、书签、音效、全屏、诊断） */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            pointerEvents: 'auto',
          }}
        >
          {/* 航天器机库 */}
          <button
            onClick={() => setShowHangar(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '5px 10px',
              borderRadius: 10,
              background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.22) 0%, rgba(3, 105, 161, 0.4) 100%)',
              border: '1px solid rgba(56, 189, 248, 0.45)',
              color: '#ffffff',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
              boxShadow: '0 2px 8px rgba(56, 189, 248, 0.25)',
              whiteSpace: 'nowrap',
            }}
            title="打开航天器机库选择搭乘载具"
          >
            <Rocket size={13} color="#38bdf8" />
            <span>机库</span>
            <span
              style={{
                fontSize: 9,
                padding: '1px 5px',
                borderRadius: 4,
                backgroundColor: 'rgba(234, 179, 8, 0.25)',
                color: '#fde047',
                border: '1px solid rgba(234, 179, 8, 0.4)',
              }}
            >
              {activeVehicle ? activeVehicle.name : '未登船'}
            </span>
          </button>

          {/* 观察点书签 */}
          <button
            onClick={() => setShowBookmarkModal(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '5px 9px',
              borderRadius: 10,
              background: 'rgba(8, 14, 24, 0.78)',
              backdropFilter: 'blur(16px)',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              color: '#38bdf8',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
            title="打开太阳系观察点与书签库"
          >
            <Bookmark size={13} />
            <span>书签</span>
          </button>

          {/* 音效开关 */}
          <button
            onClick={toggleMute}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '5px 8px',
              borderRadius: 10,
              background: isMuted ? 'rgba(8, 14, 24, 0.78)' : 'rgba(34, 197, 94, 0.2)',
              backdropFilter: 'blur(16px)',
              border: isMuted ? '1px solid rgba(255, 255, 255, 0.15)' : '1px solid rgba(34, 197, 94, 0.45)',
              color: isMuted ? '#94a3b8' : '#86efac',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
            title={isMuted ? '开启深空微波背景音与交互微响' : '静音深空环境音'}
          >
            {isMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
            <span>{isMuted ? '静音' : '音效'}</span>
          </button>

          {/* 全屏模式切换 */}
          <button
            onClick={toggleFullscreen}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '5px 8px',
              borderRadius: 10,
              background: 'rgba(8, 14, 24, 0.78)',
              backdropFilter: 'blur(16px)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: '#cbd5e1',
              cursor: 'pointer',
              fontSize: 11,
              whiteSpace: 'nowrap',
            }}
            title="切换全屏沉浸观测模式"
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

      {/* 卫星次级细条：紧跟在顶部行星栏下方 */}
      {currentMoons.length > 0 && (
        <div
          data-testid="moon-subbar"
          style={{
            position: 'absolute',
            top: 52,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            background: 'rgba(8, 14, 24, 0.88)',
            backdropFilter: 'blur(16px)',
            padding: '4px 12px',
            borderRadius: 16,
            border: '1px solid rgba(56, 189, 248, 0.35)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
            zIndex: 19,
            maxWidth: '90vw',
            overflowX: 'auto',
            scrollbarWidth: 'none',
          }}
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
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  padding: '2px 7px',
                  background: isSelected ? 'rgba(56, 189, 248, 0.35)' : 'rgba(255, 255, 255, 0.05)',
                  border: isSelected ? '1px solid #38bdf8' : '1px solid transparent',
                  borderRadius: 10,
                  color: isSelected ? '#ffffff' : '#94a3b8',
                  fontSize: 10,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease',
                }}
              >
                <span>{sat.name}</span>
              </button>
            );
          })}
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

      {/* 左下角：SpaceX 极简航空风格航行遥测 HUD (CockpitFlightHUD) */}
      <div
        data-testid="flight-telemetry-hud"
        style={{
          position: 'absolute',
          bottom: 16,
          left: 16,
          width: leftHudCollapsed ? 'auto' : 320,
          background: 'rgba(8, 14, 24, 0.75)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.14)',
          borderRadius: 14,
          boxShadow: '0 8px 32px rgba(0,0,0,0.65)',
          zIndex: 15,
          color: '#f8fafc',
          padding: leftHudCollapsed ? '8px 12px' : '12px 14px',
          transition: 'width 0.2s ease, padding 0.2s ease',
        }}
      >
        {leftHudCollapsed ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Rocket size={14} color="#38bdf8" />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: '#e2e8f0', fontFamily: 'ui-monospace, monospace' }}>
              FLIGHT TELEMETRY · {timeScale}x
            </span>
            <button
              onClick={() => setLeftHudCollapsed(false)}
              style={{
                background: 'rgba(56, 189, 248, 0.18)',
                border: '1px solid rgba(56, 189, 248, 0.4)',
                borderRadius: 6,
                color: '#38bdf8',
                fontSize: 10,
                padding: '2px 8px',
                cursor: 'pointer',
              }}
              title="展开航行遥测与图层控制面板"
            >
              展开 +
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* HUD 标题栏 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Rocket size={14} color="#38bdf8" />
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#94a3b8', fontFamily: 'ui-monospace, monospace' }}>
                  FLIGHT TELEMETRY / 航行遥测
                </span>
              </div>
              <button
                onClick={() => setLeftHudCollapsed(true)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  fontSize: 14,
                  padding: '0 4px',
                  lineHeight: 1,
                }}
                title="最小化收起"
              >
                _
              </button>
            </div>

            {/* SpaceX 风格速度与公转倍速遥测 */}
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 10,
                padding: '8px 10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ fontSize: 9, letterSpacing: '0.08em', color: '#94a3b8', textTransform: 'uppercase', fontFamily: 'ui-monospace, monospace' }}>
                  SIM WARP SPEED / 公转倍速
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, color: isPaused ? '#f87171' : '#38bdf8', lineHeight: 1.2, fontFamily: 'ui-monospace, monospace' }}>
                  {isPaused ? 'PAUSED' : `${timeScale}x`}
                </div>
              </div>

              {/* 播放暂停与倍速按钮 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button
                  onClick={togglePause}
                  style={{
                    background: isPaused ? '#ef4444' : '#10b981',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    width: 26,
                    height: 26,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                  title={isPaused ? '继续时间' : '暂停时间'}
                >
                  {isPaused ? <Play size={12} /> : <Pause size={12} />}
                </button>

                {[1, 10, 50, 200, 1000].map((speed) => (
                  <button
                    key={speed}
                    onClick={() => changeSpeed(speed)}
                    style={{
                      background: timeScale === speed ? 'rgba(56, 189, 248, 0.35)' : 'rgba(255, 255, 255, 0.05)',
                      color: timeScale === speed ? '#38bdf8' : '#94a3b8',
                      border: timeScale === speed ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.06)',
                      borderRadius: 4,
                      padding: '3px 5px',
                      cursor: 'pointer',
                      fontSize: 10,
                      fontWeight: 600,
                      fontFamily: 'ui-monospace, monospace',
                    }}
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            </div>

            {/* 飞行视角模式选择 */}
            <div>
              <div style={{ fontSize: 9, letterSpacing: '0.08em', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4, fontFamily: 'ui-monospace, monospace' }}>
                CAMERA PERSPECTIVE / 观测视向
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
                <button
                  onClick={() => handleCameraModeChange('PLANET_OBSERVE')}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 3,
                    padding: '5px 4px',
                    background: viewCameraMode === 'PLANET_OBSERVE' ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                    border: viewCameraMode === 'PLANET_OBSERVE' ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 6,
                    color: viewCameraMode === 'PLANET_OBSERVE' ? '#ffffff' : '#94a3b8',
                    cursor: 'pointer',
                    fontSize: 10,
                  }}
                  title="自由环绕观察当前天体全景"
                >
                  <Eye size={12} />
                  <span>行星全景</span>
                </button>

                <button
                  onClick={() => handleCameraModeChange('VEHICLE_FORMATION')}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 3,
                    padding: '5px 4px',
                    background: viewCameraMode === 'VEHICLE_FORMATION' ? 'rgba(234, 179, 8, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                    border: viewCameraMode === 'VEHICLE_FORMATION' ? '1px solid #eab308' : '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 6,
                    color: viewCameraMode === 'VEHICLE_FORMATION' ? '#fef08a' : '#94a3b8',
                    cursor: 'pointer',
                    fontSize: 10,
                  }}
                  title="飞船在前景右侧伴飞观察"
                >
                  <Rocket size={12} />
                  <span>伴飞视角</span>
                </button>

                <button
                  onClick={() => handleCameraModeChange('VEHICLE_ONBOARD')}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 3,
                    padding: '5px 4px',
                    background: viewCameraMode === 'VEHICLE_ONBOARD' ? 'rgba(34, 197, 94, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                    border: viewCameraMode === 'VEHICLE_ONBOARD' ? '1px solid #22c55e' : '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 6,
                    color: viewCameraMode === 'VEHICLE_ONBOARD' ? '#86efac' : '#94a3b8',
                    cursor: 'pointer',
                    fontSize: 10,
                  }}
                  title="第一人称俯瞰随船视角"
                >
                  <Compass size={12} />
                  <span>随船视角</span>
                </button>
              </div>
            </div>

            {/* 真实天文观测图层传感器开关网格 */}
            <div>
              <div style={{ fontSize: 9, letterSpacing: '0.08em', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4, fontFamily: 'ui-monospace, monospace' }}>
                ASTRONOMICAL SENSORS / 观测图层
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
                <button
                  onClick={toggleOrbits}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '5px 8px',
                    background: showOrbits ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                    border: showOrbits ? '1px solid rgba(56, 189, 248, 0.45)' : '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 6,
                    color: showOrbits ? '#e2e8f0' : '#64748b',
                    cursor: 'pointer',
                    fontSize: 10,
                  }}
                  title="开启或关闭行星公转轨道线"
                >
                  <CircleDot size={11} />
                  <span>公转轨道 ({showOrbits ? '显示' : '隐藏'})</span>
                </button>

                <button
                  onClick={toggleClouds}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '5px 8px',
                    background: showClouds ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                    border: showClouds ? '1px solid rgba(56, 189, 248, 0.45)' : '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 6,
                    color: showClouds ? '#e2e8f0' : '#64748b',
                    cursor: 'pointer',
                    fontSize: 10,
                  }}
                  title="切换地球真实云层"
                >
                  <Cloud size={11} />
                  <span>大气云层 ({showClouds ? '开' : '关'})</span>
                </button>

                <button
                  onClick={toggleAtmosphere}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '5px 8px',
                    background: showAtmosphere ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                    border: showAtmosphere ? '1px solid rgba(56, 189, 248, 0.45)' : '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 6,
                    color: showAtmosphere ? '#e2e8f0' : '#64748b',
                    cursor: 'pointer',
                    fontSize: 10,
                  }}
                  title="切换边缘大气微光散射"
                >
                  <Sparkles size={11} />
                  <span>边缘微光 ({showAtmosphere ? '开' : '关'})</span>
                </button>

                <button
                  onClick={() => setShowLabels(!showLabels)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '5px 8px',
                    background: showLabels ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                    border: showLabels ? '1px solid rgba(56, 189, 248, 0.45)' : '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 6,
                    color: showLabels ? '#e2e8f0' : '#64748b',
                    cursor: 'pointer',
                    fontSize: 10,
                  }}
                  title="在三维场景中显示/隐藏天体悬浮引导标识"
                >
                  <Tag size={11} />
                  <span>天体标识 ({showLabels ? '显示' : '隐藏'})</span>
                </button>

                <button
                  onClick={toggleTeachingLight}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '5px 8px',
                    background: teachingLight ? 'rgba(234, 179, 8, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                    border: teachingLight ? '1px solid rgba(234, 179, 8, 0.45)' : '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 6,
                    color: teachingLight ? '#fde047' : '#64748b',
                    cursor: 'pointer',
                    fontSize: 10,
                  }}
                  title="微量照亮背阴暗部，方便辨识背面地形"
                >
                  <Sun size={11} />
                  <span>教学补光 ({teachingLight ? '开' : '关'})</span>
                </button>

                <button
                  onClick={toggleReduceMotion}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '5px 8px',
                    background: reduceMotion ? 'rgba(168, 85, 247, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                    border: reduceMotion ? '1px solid rgba(168, 85, 247, 0.5)' : '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 6,
                    color: reduceMotion ? '#c084fc' : '#94a3b8',
                    cursor: 'pointer',
                    fontSize: 10,
                  }}
                  title="减弱视角过渡晃动，平稳就位（150ms 快速过渡）"
                >
                  <Activity size={11} />
                  <span>减弱动态 ({reduceMotion ? '已开启' : '已关闭'})</span>
                </button>

                {/* 金星雷达地表穿透切换 */}
                {selectedBodyId === 'venus' && (
                  <button
                    onClick={toggleVenusRadar}
                    style={{
                      gridColumn: 'span 2',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '5px 8px',
                      background: venusRadarMode ? 'rgba(249, 115, 22, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                      border: venusRadarMode ? '1px solid #f97316' : '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 6,
                      color: venusRadarMode ? '#fb923c' : '#94a3b8',
                      cursor: 'pointer',
                      fontSize: 10,
                    }}
                    title="麦哲伦号合成孔径雷达穿透硫酸浓雾测绘"
                  >
                    <Radio size={11} />
                    <span>雷达穿透地表 ({venusRadarMode ? '开' : '关'})</span>
                  </button>
                )}

                {/* 土卫六近红外穿透切换 */}
                {selectedBodyId === 'titan' && (
                  <button
                    onClick={toggleTitanInfrared}
                    style={{
                      gridColumn: 'span 2',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '5px 8px',
                      background: titanInfraredMode ? 'rgba(234, 179, 8, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                      border: titanInfraredMode ? '1px solid #eab308' : '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 6,
                      color: titanInfraredMode ? '#fef08a' : '#94a3b8',
                      cursor: 'pointer',
                      fontSize: 10,
                    }}
                    title="卡西尼号 938nm 近红外穿透观测沙丘与甲烷湖"
                  >
                    <Radio size={11} />
                    <span>近红外穿透地表 ({titanInfraredMode ? '开' : '关'})</span>
                  </button>
                )}
              </div>
            </div>

            {/* 明信片生成入口 */}
            <button
              onClick={handleGeneratePostcard}
              disabled={isGeneratingPostcard}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '7px 10px',
                background: 'linear-gradient(135deg, rgba(2, 132, 199, 0.3) 0%, rgba(14, 165, 233, 0.45) 100%)',
                border: '1px solid rgba(56, 189, 248, 0.5)',
                color: '#38bdf8',
                borderRadius: 8,
                cursor: isGeneratingPostcard ? 'wait' : 'pointer',
                fontSize: 11,
                fontWeight: 600,
                boxShadow: '0 2px 8px rgba(56, 189, 248, 0.2)',
              }}
              title="将当前 3D 观测画面合成为专属探索明信片"
            >
              <Camera size={13} />
              <span>{isGeneratingPostcard ? '正在截帧中...' : '记录发现 · 探索明信片'}</span>
            </button>
          </div>
        )}
      </div>

      {/* 底部中央：SpaceX 极简航空风格动态星际航程与天体相对位置仪表弧 (TrajectoryArcHUD) */}
      <TrajectoryArcHUD
        selectedBodyId={selectedBodyId}
        cameraSnapshot={cameraSnapshot}
        onSelectBody={handleFlyTo}
        timeScale={timeScale}
      />

      {/* 右下角：SpaceX 极简航空风格天体科学遥测 HUD (TargetScienceHUD) */}
      <aside
        data-testid="target-science-hud"
        style={{
          position: 'absolute',
          right: 16,
          bottom: 16,
          width: rightHudCollapsed ? 'auto' : 340,
          background: 'rgba(8, 14, 24, 0.75)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.14)',
          borderRadius: 14,
          boxShadow: '0 8px 32px rgba(0,0,0,0.65)',
          zIndex: 15,
          color: '#f8fafc',
          padding: rightHudCollapsed ? '8px 12px' : '14px 16px',
          transition: 'width 0.2s ease, padding 0.2s ease',
        }}
      >
        {rightHudCollapsed ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: activeBody.colorHex ? `#${activeBody.colorHex.toString(16).padStart(6, '0')}` : '#38bdf8',
              }}
            />
            <span style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0' }}>
              {activeBody.name} · SCIENCE HUD
            </span>
            <button
              onClick={() => setRightHudCollapsed(false)}
              style={{
                background: 'rgba(56, 189, 248, 0.18)',
                border: '1px solid rgba(56, 189, 248, 0.4)',
                borderRadius: 6,
                color: '#38bdf8',
                fontSize: 10,
                padding: '2px 8px',
                cursor: 'pointer',
              }}
              title="展开天体科学遥测数据"
            >
              展开 +
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* 标题栏与天体类别 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#f8fafc', letterSpacing: '0.02em' }}>
                    {activeBody.name}
                  </h2>
                  <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'ui-monospace, monospace' }}>
                    {activeBody.nameEn}
                  </span>
                </div>
                <div style={{ fontSize: 9, letterSpacing: '0.08em', color: '#94a3b8', textTransform: 'uppercase', marginTop: 2, fontFamily: 'ui-monospace, monospace' }}>
                  TARGET TELEMETRY / 天体遥测
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    fontSize: 9,
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: 'rgba(56, 189, 248, 0.15)',
                    color: '#38bdf8',
                    border: '1px solid rgba(56, 189, 248, 0.3)',
                    fontFamily: 'ui-monospace, monospace',
                  }}
                >
                  {activeBody.type === 'star' ? '恒星 STAR' : activeBody.type === 'planet' ? '行星 PLANET' : '卫星 MOON'}
                </span>
                <button
                  onClick={() => setRightHudCollapsed(true)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    fontSize: 14,
                    padding: '0 4px',
                    lineHeight: 1,
                  }}
                  title="最小化收起"
                >
                  _
                </button>
              </div>
            </div>

            {/* SpaceX 极简 2x2 物理遥测指标网格 */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 6,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              }}
            >
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 8,
                  padding: '6px 8px',
                }}
              >
                <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  RADIUS / 半径
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc', marginTop: 1 }}>
                  {activeBody.radiusKm.toLocaleString()} <span style={{ fontSize: 10, color: '#64748b' }}>km</span>
                </div>
              </div>

              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 8,
                  padding: '6px 8px',
                }}
              >
                <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  ORBIT / 轨道距离
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc', marginTop: 1 }}>
                  {activeBody.orbitSemiMajorAxisKm > 0
                    ? activeBody.orbitSemiMajorAxisKm >= 149598023
                      ? `${(activeBody.orbitSemiMajorAxisKm / 149598023).toFixed(2)} AU`
                      : `${(activeBody.orbitSemiMajorAxisKm / 10000).toFixed(0)} 万km`
                    : '--'}
                </div>
              </div>

              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 8,
                  padding: '6px 8px',
                }}
              >
                <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  PERIOD / 公转周期
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc', marginTop: 1 }}>
                  {activeBody.orbitPeriodDays > 0
                    ? activeBody.orbitPeriodDays >= 365.25
                      ? `${(activeBody.orbitPeriodDays / 365.25).toFixed(1)} 年`
                      : `${activeBody.orbitPeriodDays} 天`
                    : '--'}
                </div>
              </div>

              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 8,
                  padding: '6px 8px',
                }}
              >
                <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  ROTATION / 自转
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc', marginTop: 1 }}>
                  {activeBody.rotationPeriodHours !== 0
                    ? `${Math.abs(activeBody.rotationPeriodHours)} h`
                    : '--'}
                </div>
              </div>
            </div>

            {/* 观察发现 */}
            <div
              style={{
                background: 'rgba(30, 41, 59, 0.65)',
                borderLeft: '3px solid #38bdf8',
                padding: '6px 10px',
                borderRadius: 6,
                fontSize: 11,
                lineHeight: 1.45,
                color: '#e2e8f0',
              }}
            >
              💡 <strong>观察发现：</strong>{activeBody.observationTip}
            </div>

            {/* 趣味冷知识 */}
            {activeBody.funFact && (
              <div
                style={{
                  background: 'rgba(234, 179, 8, 0.12)',
                  borderLeft: '3px solid #eab308',
                  padding: '6px 10px',
                  borderRadius: 6,
                  fontSize: 11,
                  lineHeight: 1.45,
                  color: '#fef08a',
                }}
              >
                ✨ <strong>趣味冷知识：</strong>{activeBody.funFact}
              </div>
            )}

            {/* 飞往这里按钮 */}
            <button
              data-testid="fly-to-button"
              onClick={() => handleFlyTo(activeBody.id)}
              style={{
                width: '100%',
                padding: '9px 0',
                backgroundColor: '#0284c7',
                color: '#ffffff',
                border: 'none',
                borderRadius: 8,
                fontWeight: 600,
                fontSize: 12,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                boxShadow: '0 2px 12px rgba(2, 132, 199, 0.45)',
                transition: 'background-color 0.2s ease',
              }}
            >
              <span>飞往这里 (Fly To {activeBody.name})</span>
            </button>

            {/* 家长展开科学数据与来源 */}
            <div style={{ paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <button
                onClick={() => setShowDetails(!showDetails)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  fontSize: 10,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: 0,
                }}
              >
                <Info size={11} />
                <span>{showDetails ? '收起科学来源' : '展开科学数据与来源'}</span>
              </button>

              {showDetails && (
                <div style={{ marginTop: 6, fontSize: 10, color: '#94a3b8', lineHeight: 1.5 }}>
                  <div>平均物理半径: <span style={{ color: '#e2e8f0' }}>{activeBody.radiusKm.toLocaleString()} km</span></div>
                  {activeBody.rotationPeriodHours !== 0 && (
                    <div>自转周期: <span style={{ color: '#e2e8f0' }}>{activeBody.rotationPeriodHours} 小时</span></div>
                  )}
                  {activeBody.orbitPeriodDays > 0 && (
                    <div>公转周期: <span style={{ color: '#e2e8f0' }}>{activeBody.orbitPeriodDays} 天</span></div>
                  )}
                  {activeBody.orbitSemiMajorAxisKm > 0 && (
                    <div>轨道距离: <span style={{ color: '#e2e8f0' }}>{(activeBody.orbitSemiMajorAxisKm / 10000).toFixed(0)} 万公里 ({(activeBody.orbitSemiMajorAxisKm / 149598023).toFixed(2)} AU)</span></div>
                  )}
                  <div>数据与贴图来源: <span style={{ color: '#38bdf8' }}>{activeBody.sourceRef}</span></div>
                  <p style={{ margin: '4px 0 0 0', color: '#cbd5e1', fontSize: 10 }}>{activeBody.description}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </aside>

      {/* 航天器机库全屏模态窗口 */}
      {showHangar && (
        <HangarModal
          currentVehicleId={currentVehicleId}
          onSelectVehicle={handleSelectVehicle}
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
        currentSnapshot={cameraSnapshot}
        currentBodyId={selectedBodyId}
        currentVehicleId={currentVehicleId}
        currentViewCameraMode={viewCameraMode}
        currentLayers={{
          showClouds,
          showAtmosphere,
          teachingLight,
          showOrbits,
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
